"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { loadPermGuard } from "@/lib/perm/guard";
import { createClient } from "@/lib/supabase/server";
import { normalizeLabelDisplay } from "@/lib/boards/label-options";

export type AddLabelOptionInput = Readonly<{
  boardId: string;
  columnId: string;
  /** 만들고 싶은 라벨 — 앞뒤 공백은 정리된다. 쿼리는 화면이 들고 있다. */
  label: string;
  /** 멱등 열쇠 — 155 원장에 묶인다. 비어 있으면 거절한다. */
  requestId: string;
}>;

export type AddLabelOptionResult = Readonly<{
  ok: boolean;
  message: string;
  /** 저장(또는 이미 있던) 선택지 id. 충돌이어도 돌려준다 — 화면이 바로 고를 수 있게. */
  optionId?: string;
  /** 이미 있던 값이면 true — 화면이 쿼리를 지우지 않고 기존값을 고른다. */
  conflict?: boolean;
}>;

function value(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function failure(message: string): AddLabelOptionResult {
  return { ok: false, message };
}

/** 155가 아직 적용되지 않은 환경 — 함수가 없다는 뜻. fail-closed로 끝내고 쓰지 않는다. */
function isMissingFunction(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as { code?: unknown; message?: unknown };
  if (record.code === "PGRST202" || record.code === "42883") return true;
  return typeof record.message === "string"
    && /Could not find the function|does not exist/i.test(record.message);
}

function messageForRpc(error: { code?: string; message?: string }): string {
  if (error.code === "42501") return "라벨 만들기는 컬럼을 관리할 수 있는 사람만 할 수 있어요.";
  if (typeof error.message === "string") {
    if (/idempotency key reuse/.test(error.message)) {
      return "같은 요청으로 다른 값을 보내고 있어요. 화면을 새로고침한 뒤 다시 시도해 주세요.";
    }
    if (/protected column|not creatable/.test(error.message)) {
      return "이 칸에서는 새 값을 만들 수 없습니다.";
    }
    if (/column unavailable|input required/.test(error.message)) {
      return "필요한 값이 빠졌어요. 다시 시도해 주세요.";
    }
  }
  return "저장 결과를 확인하지 못했어요. 같은 라벨로 다시 시도해 결과를 확인해 주세요.";
}

/**
 * 2026-09-27 엣지 — 셀 드롭다운의 «라벨 만들기».
 *
 * ★ 저장은 155 `append_board_column_label_option` 뿐이다. 호출자가 읽은
 *   스냅샷을 쓰기 경로에 쓰지 않는다 — 서버가 컬럼 잠금 아래 다시 읽고 덧붙인다.
 *   같은 라벨의 경합은 같은 답으로 수렴하고, 다른 라벨의 경합은 둘 다 산다.
 *   요청 원장에 (actor·내용)이 묶이므로 잃어버린 응답의 재시도도 같은 답이다.
 *   155 배포가 앱보다 먼저다 — RPC가 없으면 fail-closed로 끝내고 쓰지 않는다.
 *
 * ★ 권한을 완화하지 않는다 — 만들기는 «컬럼 관리» 가 허용된 사람만 노출한다
 *   (화면이 `canManageColumns` 일 때만 만들기 행을 보여준다). 일반 편집자는
 *   검색·선택만 된다. RPC 안에서도 DB 경계에서 다시 본다.
 *
 * ★ 보호 컬럼(전이·승인·단계·이동규칙·지역·읽기전용·수식·연동)은 RPC 안의
 *   정책 가드가 막는다 — 워크플로 의미와 정본 taxonomy 를 그대로 둔다.
 *
 * ★ 예전 읽기-합치기-쓰기 예비책은 없다. `getBoardDetail → merge → updateColumn`
 *   전체 교체는 동시 라벨을 잃는다 — 155 없이 쓸 수 없어 fail-closed다.
 *   입력·요청 식별(boardId·columnId·requestId)은 그대로 둔다.
 */
export async function addBoardLabelOptionAction(input: AddLabelOptionInput): Promise<AddLabelOptionResult> {
  const boardId = value(input.boardId);
  const columnId = value(input.columnId);
  const requestId = value(input.requestId);
  const display = normalizeLabelDisplay(input.label ?? "");
  if (!boardId || !columnId || !requestId) return failure("필요한 값이 빠졌어요. 다시 시도해 주세요.");
  if (display === "") return failure("만들 라벨을 입력해 주세요.");

  let ctx: Awaited<ReturnType<typeof getSession>>;
  try {
    ctx = await getSession();
  } catch (error) {
    console.error("[label option] session failed", { boardId, columnId, requestId, error });
    return failure("로그인을 확인한 뒤 다시 시도해 주세요.");
  }

  // ★ 만들기 문턱은 «컬럼 관리» 다 — 낱개 셀 편집(`work.item_upsert`)과 다르다.
  try {
    const guard = await loadPermGuard(ctx.org.id, "structure.column_manage");
    if (guard.kind !== "allowed") {
      return failure("라벨 만들기는 컬럼을 관리할 수 있는 사람만 할 수 있어요.");
    }
  } catch (error) {
    console.error("[label option] guard failed", { boardId, columnId, requestId, error });
    return failure("저장 결과를 확인하지 못했어요. 같은 라벨로 다시 시도해 결과를 확인해 주세요.");
  }

  // 정본 — 155 원자 추가뿐이다. 스냅샷을 보내지 않고 라벨 문자열만 보낸다.
  // 155가 없으면 fail-closed로 끝낸다 — 예전 전체 교체는 동시 라벨을 잃으므로 쓰지 않는다.
  try {
    const client = await createClient();
    const { data, error } = await client.rpc("append_board_column_label_option", {
      p_org_id: ctx.org.id,
      p_board_id: boardId,
      p_column_id: columnId,
      p_request_id: requestId,
      p_label: display,
    });
    if (!error) {
      const row = (Array.isArray(data) ? data[0] : data) as
        | { option_id?: unknown; created?: unknown }
        | undefined;
      if (row && typeof row.option_id === "string") {
        revalidatePath(`/boards/${boardId}`);
        if (row.created === false) {
          return {
            ok: false,
            conflict: true,
            optionId: row.option_id,
            message: `«${row.option_id}»(으)로 이미 있어요. 그대로 씁니다.`,
          };
        }
        return { ok: true, optionId: row.option_id, message: `«${display}»(을)를 만들었어요.` };
      }
      console.error("[label option] unexpected rpc shape", { boardId, columnId, requestId });
      return failure("저장 결과를 확인하지 못했어요. 같은 라벨로 다시 시도해 결과를 확인해 주세요.");
    }
    if (isMissingFunction(error)) {
      console.error("[label option] rpc missing — fail closed, no writes", { boardId, columnId, requestId, error });
      return failure("라벨 만들기 기능을 지금 사용할 수 없어요. 관리자에게 문의해 주세요.");
    }
    console.error("[label option] rpc failed", { boardId, columnId, requestId, error });
    return failure(messageForRpc(error));
  } catch (error) {
    console.error("[label option] rpc failed", { boardId, columnId, requestId, error });
    return failure("저장 결과를 확인하지 못했어요. 같은 라벨로 다시 시도해 결과를 확인해 주세요.");
  }
}
