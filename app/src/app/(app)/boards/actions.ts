"use server";

/**
 * 임의 보드 서버 액션 (T02b · ADR-0003).
 * 로컬 스토어가 서버 인메모리(globalThis)라 서버 액션으로 직접 조작하고 revalidate 한다.
 * (Supabase 연결 후에도 동일 서비스 호출 — 어댑터만 교체)
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth/session";
import { loadPermGuard } from "@/lib/perm/guard";
import { recordRiskyAction } from "@/lib/perm/server";
import { NotFoundError } from "@/lib/boards";
import { createRequestBoards } from "@/lib/boards/server";
import { COLUMN_DELETE_CONFIRM, parseNewBoard, parseNewColumn, parseNewItem, isFieldType } from "@/lib/boards/validation";
import type { Ctx, FieldOption } from "@/lib/types";
import type { ItemWithValues } from "@/lib/boards/types";
import { boardCellValueFromFormData } from "@/lib/boards/form-values";
import type { CellError } from "@/lib/boards/service";
import type { ItemPatch } from "@/lib/boards/store";
import { clampWidth, groupKeyOf } from "@/components/board/layout";
import { setGroupColumnOrder } from "./groupLayout";
import {
  CELL_FLASH_COOKIE,
  CELL_FLASH_MAX_AGE,
  encodeCellFlash,
} from "@/lib/boards/cellFlash";
import {
  BOARD_ACTION_FLASH_COOKIE,
  BOARD_ACTION_FLASH_MAX_AGE,
  encodeBoardActionFlash,
  UserFacingActionError,
  userFacingMessage,
} from "@/lib/boards/boardActionFlash";
import { encodeNoticeFile, NOTICE_FILE_VALUE_PREFIX } from "@/lib/notices/official-file";
import { NOTICE_KEYS } from "@/lib/notices/types";
import { NOTICE_TAB_SOURCE } from "@/lib/default-tabs/types";
import { notifyBoardItemMoved } from "@/lib/notify/board-actions";
import {
  detailKeyFromLabel,
  normalizeDetailLayout,
  resolveDetailLayout,
  type DetailLayoutEntry,
} from "@/lib/boards/detail-layout";
import { advanceNewLeadToContact, NewLeadAdvanceError } from "@/lib/new-lead/advance";

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

function moveEventKey(formData: FormData): string {
  const value = str(formData, "eventKey");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : crypto.randomUUID();
}

async function boardsService() {
  return (await createRequestBoards()).service;
}

async function requirePermission(ctx: Ctx, scopeKey: string, riskKey?: "danger.bulk_edit_delete"): Promise<void> {
  const permission = await loadPermGuard(ctx.org.id, scopeKey);
  // ★ 「권한이 없다」와 「권한을 확인하지 못했다」는 사용자에게 다른 사실이다(BBE-204 와 같은 족보).
  //   여기서 문장을 나눠 만들어 두고 호출부가 그걸 화면에 쓴다.
  if (permission.kind !== "allowed") {
    throw new UserFacingActionError(
      permission.reason === "permission" ? "이 업무를 실행할 권한이 없어요." : "권한을 확인하지 못했어요.",
    );
  }
  if (riskKey && !(await recordRiskyAction(ctx.org.id, riskKey, { operation: scopeKey })).ok) {
    throw new UserFacingActionError("위험 작업 기록을 남기지 못해 실행하지 않았어요.");
  }
}

/**
 * 1회성 플래시 쿠키를 즉시 지운다 (BBE-201).
 *
 * ★ 성공은 «이전 실패» 를 지워야 한다. TTL 로 스스로 사라지길 기다리면,
 *   사용자가 오류를 보고 고쳐서 다시 누르는 «10초 안» 에 성공했는데도
 *   방금 전 오류가 화면에 다시 그려진다. 그게 총괄이 겪는 시나리오다.
 */
async function clearFlashCookie(name: string): Promise<void> {
  (await cookies()).set(name, "", { path: "/", maxAge: 0 });
}

/**
 * 보드 단위 실패를 다음 렌더에 알린다(1회성 쿠키).
 *
 * 이것이 없으면 서버 액션의 throw 가 Next 오류 경계로 올라가 **화면이 통째로 덮인다**
 * ("This page couldn't load"). 사용자는 무엇이 왜 안 됐는지 모르고 입력하던 것도 잃는다.
 */
/**
 * Next 의 redirect()/notFound() 는 «예외로 구현된 제어 흐름» 이다 (BBE-213).
 *
 * ★ catch 로 삼키면 로그인 이동·페이지 이동이 죽는다. 반드시 그대로 올려보낸다.
 *   BBE-201 에서는 getSession() 을 try 밖에 두는 방식으로 피했는데, 그러면
 *   «밖에 둔 줄» 이 무방비로 남는다(총괄이 본 흰 화면이 그 자리였다).
 *   제어 흐름을 «알아보고 되던지는» 쪽이 안전하다 — 밖에 둘 이유가 없어진다.
 */
function isNextControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null | undefined)?.digest;
  return typeof digest === "string"
    && (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND");
}

/**
 * 모든 보드 서버 액션의 «단일 출구» (BBE-213).
 *
 * ★ 던지면 Next 오류 경계가 화면을 통째로 덮는다("This page couldn't load").
 *   사용자는 무엇이 왜 안 됐는지 모르고 입력하던 것까지 잃는다.
 *
 * ★ 분기마다 try/catch 를 손으로 넣지 않는다. BBE-201 이 19개 중 2개만 덮었고
 *   그 2개도 일부만 덮여 있었다 — 손으로 넣으면 다음 액션에서 또 빠진다.
 *   액션 본문 전체가 이 한 곳을 지나게 해서 «빠뜨릴 자리» 를 없앤다.
 */
async function runBoardAction(formData: FormData, run: () => Promise<void>): Promise<void> {
  // ★ «이전 실패» 를 먼저 지운다 — 경로를 나누지 않는다 (BBE-220).
  //
  //   전에는 run() «뒤» 에서 지웠다. 그러면 성공 시 redirect() 를 던지는 액션
  //   (deleteBoardAction · createBoardAction 등)은 그 줄에 **도달하지 못한다** —
  //   redirect 는 예외로 구현된 제어 흐름이라 아래 catch 로 빠져 되던져지기 때문이다.
  //   즉 「성공하면 이전 실패를 지운다」가 리다이렉트하는 액션에서는 성립하지 않았다.
  //
  //   ★ 그런데 테스트는 초록이었다. 그 테스트가 redirect 를 목으로 바꿔 «던지지 않는 세계»
  //     에서 쟀기 때문이다 — 목이 운영보다 좁았다(BBE-200 에서 겪은 것과 같은 모양).
  //
  //   여기서 지우면 성공·실패·리다이렉트 어느 경로든 지워진다. 실패는 아래 catch 가
  //   다시 쓰므로 사유는 그대로 남는다. **예외 경로를 하나 더 막는 대신 경로를 안 나눈다** —
  //   앞엣것은 새 종료 경로가 생기면 또 빠진다.
  await clearFlashCookie(BOARD_ACTION_FLASH_COOKIE);
  try {
    await run();
  } catch (error) {
    if (isNextControlFlow(error)) throw error;
    const boardId = str(formData, "boardId");
    await flashBoardActionError(boardId, error);
    revalidatePath(`/boards/${boardId}`);
  }
}

async function flashBoardActionError(boardId: string, error: unknown): Promise<void> {
  // 원인 자체는 서버 로그에 남긴다 — 화면에서 감춘다고 조사까지 못 하게 하면 안 된다.
  console.error("[board action]", boardId, error);
  const encoded = encodeBoardActionFlash({ boardId, message: userFacingMessage(error) });
  if (!encoded) return;
  const jar = await cookies();
  jar.set(BOARD_ACTION_FLASH_COOKIE, encoded, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: BOARD_ACTION_FLASH_MAX_AGE,
  });
}

/**
 * 저장되지 못한 셀을 다음 렌더에 알린다(1회성 쿠키).
 *
 * setCells 는 관대 정책이라 **틀린 셀만 빼고 나머지는 저장**한 뒤 사유를 돌려준다.
 * 그 사유를 여기서 흘려버리면 사용자에겐 "아무 일도 안 일어난" 것으로 보인다 —
 * 조용한 실패를 없애려고 이 화면(서버 렌더 폼)에서 쓸 수 있는 방식으로 넘긴다.
 */
async function flashCellErrors(itemId: string, errors: CellError[]): Promise<void> {
  const encoded = encodeCellFlash({ itemId, errors });
  // ★ 담을 것이 없다 = 이번엔 성공했다. 그러면 «이전 실패» 를 지워야 한다(BBE-201).
  //   그냥 return 하면 직전 오류 쿠키가 TTL 동안 살아남아, 성공한 뒤에도 화면이
  //   「권한이 없어요」를 다시 그린다 — 판정은 성공인데 표현은 실패다.
  if (!encoded) {
    await clearFlashCookie(CELL_FLASH_COOKIE);
    return;
  }
  const jar = await cookies();
  jar.set(CELL_FLASH_COOKIE, encoded, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: CELL_FLASH_MAX_AGE,
  });
}

/** "높음,보통,낮음" → FieldOption[] (id 는 안정적으로 파생). */
function parseOptionsCsv(csv: string): FieldOption[] {
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map((label, i) => ({ id: `opt-${i + 1}-${label.replace(/\s+/g, "")}`, label, order: i }));
}

/**
 * 새 보드 만들기.
 *
 * ★ 이 액션만 runBoardAction 을 «일부러» 안 쓴다 — 빠뜨린 게 아니다.
 *   래퍼는 실패 사유를 `/boards/{boardId}` 화면에 붙이는데, 여기는 보드를 «만드는 중» 이라
 *   붙일 boardId 자체가 없다. 지금은 실패하면 전면 오류가 난다.
 *   제대로 고치려면 보드 «목록» 화면에 붙이는 자리가 따로 필요하다(후속 카드).
 *   actions.guard.test.ts 의 예외 목록에 같은 이유가 적혀 있고, 그 목록은 개수까지 고정돼 있다.
 */
export async function createBoardAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  await requirePermission(ctx, "structure.tab_manage");
  const input = parseNewBoard({
    name: str(formData, "name"),
    description: str(formData, "description"),
    icon: str(formData, "icon"),
  });
  const detail = await (await boardsService()).createBoard(ctx, input, str(formData, "requestId") || crypto.randomUUID());
  revalidatePath("/boards");
  redirect(`/boards/${detail.board.id}`);
}

export async function reorderBoardsAction(formData: FormData): Promise<void> {
  return runBoardAction(formData, async () => {
    const ctx = await getSession();
    await requirePermission(ctx, "structure.tab_manage");
    const boardIds = formData.getAll("boardId").flatMap((value) => typeof value === "string" && value ? [value] : []);
    await (await boardsService()).reorderBoards(ctx, boardIds, str(formData, "requestId") || crypto.randomUUID());
    revalidatePath("/boards");
  });
}

export async function deleteBoardAction(formData: FormData): Promise<void> {
  return runBoardAction(formData, async () => {
    const ctx = await getSession();
    await requirePermission(ctx, "danger.bulk_edit_delete", "danger.bulk_edit_delete");
    await (await boardsService()).deleteBoard(ctx, str(formData, "boardId"));
    revalidatePath("/boards");
    redirect("/boards");
  });
}

export async function addColumnAction(formData: FormData): Promise<void> {
  return runBoardAction(formData, async () => {
    const ctx = await getSession();
    await requirePermission(ctx, "structure.column_manage");
    const boardId = str(formData, "boardId");
    const type = str(formData, "type");
    if (!isFieldType(type)) throw new Error("지원하지 않는 필드 타입입니다");
    const optionsCsv = str(formData, "options");
    const input = parseNewColumn({
      label: str(formData, "label"),
      type,
      options: optionsCsv ? parseOptionsCsv(optionsCsv) : undefined,
    });
    await (await boardsService()).addColumn(ctx, boardId, input);
    revalidatePath(`/boards/${boardId}`);
  });
}

/**
 * 컬럼 삭제 — 확인 단계를 서버가 강제한다 (BBE-177).
 *
 * 확인을 화면에서만 두면 폼을 직접 만들어 보내는 것으로 그냥 우회된다. 컬럼 삭제는
 * 그 열을 표에서 없애는 조작이고 되돌리는 화면이 아직 없으므로, `confirm=delete` 가
 * 실린 요청만 받는다.
 *
 * 셀 값은 더 이상 지우지 않는다 — 근거는 `SupabaseBoardsRepo.deleteColumn` 주석.
 */
// ★ 이 액션의 호출부를 늘리면 confirm 을 «반드시» 실어라.
//    확인 관문은 래퍼 «밖» 에서 던진다 — UI 를 거친 요청은 항상 confirm 을 싣기 때문이다
//    (ColumnEditor.tsx · ColumnEditor.test.tsx:80,88-89 가 그 결합을 못 박는다).
//    confirm 없이 부르는 호출부가 생기면 «정당한 사용자» 가 전면 오류 화면을 본다 — BBE-201 재발.
export async function deleteColumnAction(formData: FormData): Promise<void> {
  // ★ 확인 관문은 래퍼 «밖» 이다 (BBE-177 + BBE-213 병합).
  //   BBE-213 의 runBoardAction 은 실패를 «배너» 로 바꾼다(다시 던지지 않는다). 그런데 이 검사는
  //   «사용자의 조작 실패» 가 아니라 «확인 단계를 건너뛴 요청» 이다 — 화면을 거친 사용자에게는
  //   애초에 일어나지 않고, 폼을 직접 만들어 보낼 때만 걸린다. 배너로 접으면 그 우회가
  //   «조용히 거절» 되어 서버 로그 말고는 흔적이 없다. 그래서 던진다.
  //   그리고 반드시 서비스 호출 «앞» 이다 — 뒤로 옮기면 이미 지운 뒤가 된다(M5 가 이것을 잡는다).
  if (str(formData, "confirm") !== COLUMN_DELETE_CONFIRM) {
    throw new Error("컬럼 삭제는 확인 단계를 거쳐야 합니다");
  }
  return runBoardAction(formData, async () => {
    const ctx = await getSession();
    await requirePermission(ctx, "structure.column_manage");
    const boardId = str(formData, "boardId");
    await (await boardsService()).deleteColumn(ctx, boardId, str(formData, "columnId"));
    revalidatePath(`/boards/${boardId}`);
  });
}

/**
 * 컬럼 폭 조절(D12) — 머리글 경계 드래그·두 번 눌러 초기화.
 * `width` 가 빈 문자열이면 초기화(null = 컬럼 최소폭으로 되돌아감). 값이 있으면
 * 클라이언트가 이미 clampWidth 를 거쳤어도 여기서 한 번 더 좁힌다(직접 폼 제출 방어).
 */
export async function setColumnWidthAction(formData: FormData): Promise<void> {
  return runBoardAction(formData, async () => {
    const ctx = await getSession();
    await requirePermission(ctx, "structure.column_manage");
    const boardId = str(formData, "boardId");
    const columnId = str(formData, "columnId");
    const raw = str(formData, "width");
    const width = raw === "" ? null : clampWidth(Number(raw));
    await (await boardsService()).updateColumn(ctx, boardId, columnId, { width });
    revalidatePath(`/boards/${boardId}`);
  });
}

/**
 * 새 항목 추가 (BBE-201).
 *
 * ★ 여기서 던지면 Next 오류 경계가 화면을 통째로 덮는다 — 사용자는 무엇이 왜 안 됐는지
 *   모르고 입력하던 것도 잃는다. 권한 없음·확인 불가·입력 오류·저장 실패는 «서로 다른
 *   사실» 이므로 각각 화면 안에서 말한다.
 *
 * ★ getSession() 은 try 밖에 둔다. 미인증이면 그 안에서 redirect() 가 일어나는데,
 *   Next 의 redirect 는 «예외로 구현된 제어 흐름» 이라 catch 로 삼키면 로그인 이동이 죽는다.
 */
export async function addItemAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  const boardId = str(formData, "boardId");
  try {
    await requirePermission(ctx, "work.item_upsert");
    const groupId = str(formData, "groupId");
    const input = parseNewItem({
      title: str(formData, "title"),
      group_id: groupId === "" ? null : groupId,
    });
    await (await boardsService()).createItem(ctx, boardId, input);
    // 성공했으면 직전 실패를 지운다 — 안 지우면 고쳐서 성공한 뒤에도 옛 오류가 다시 그려진다.
    await clearFlashCookie(BOARD_ACTION_FLASH_COOKIE);
  } catch (error) {
    await flashBoardActionError(boardId, error);
  }
  revalidatePath(`/boards/${boardId}`);
}

/**
 * 공지사항 한정 삭제 예외(BBE-239) — 작성자는 role 권한 없이도 «자기 글» 을 지울 수 있다.
 * 다른 보드에는 적용하지 않는다(보드 source 로 좁힘). 조회 실패는 전부 false 로 수렴한다
 * — 예외를 못 확인하면 기존 role 권한 판정 그대로 막힌다(모르면 닫는다).
 */
async function canDeleteAsNoticeAuthor(
  ctx: Ctx,
  svc: Awaited<ReturnType<typeof boardsService>>,
  boardId: string,
  itemId: string,
): Promise<boolean> {
  try {
    const detail = await svc.getBoardDetail(ctx, boardId);
    if (detail.board.source !== NOTICE_TAB_SOURCE) return false;
    const item = await svc.getItem(ctx, boardId, itemId);
    return item.values[NOTICE_KEYS.author] === ctx.user.id;
  } catch {
    return false;
  }
}

export async function deleteItemAction(formData: FormData): Promise<void> {
  return runBoardAction(formData, async () => {
    const ctx = await getSession();
    const boardId = str(formData, "boardId");
    const itemId = str(formData, "itemId");
    const svc = await boardsService();
    const permission = await loadPermGuard(ctx.org.id, "work.item_delete");
    if (permission.kind !== "allowed" && !(await canDeleteAsNoticeAuthor(ctx, svc, boardId, itemId))) {
      throw new UserFacingActionError(
        permission.reason === "permission" ? "이 업무를 실행할 권한이 없어요." : "권한을 확인하지 못했어요.",
      );
    }
    await svc.deleteItem(ctx, boardId, itemId);
    revalidatePath(`/boards/${boardId}`);
  });
}

/** 셀 인라인 편집 — 값 정규화·선택지 검증은 서비스가 수행. */
export async function setCellAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  const boardId = str(formData, "boardId");
  const itemId = str(formData, "itemId");
  const columnKey = str(formData, "columnKey");
  // 권한 없음·확인 불가도 화면 안에서 말한다(BBE-201). 셀이 특정되므로 셀 아래에 붙인다.
  //
  // ★ BBE-213 — createRequestBoards() 가 이 try «밖» 에 있어서 전면 오류가 났다.
  //   그 함수는 createClient() 를 부르고, 그게 던지면 Next 오류 경계로 곧장 올라갔다.
  //   BBE-201 이 «저장 실패» 는 덮었는데 «클라이언트를 만들다 실패» 는 못 덮고 있었다.
  //   총괄이 운영에서 본 흰 화면이 이 자리다.
  let graph: Awaited<ReturnType<typeof createRequestBoards>>;
  try {
    await requirePermission(ctx, "work.item_upsert");
    graph = await createRequestBoards();
  } catch (error) {
    console.error("[board cell]", boardId, itemId, columnKey, error);
    await flashCellErrors(itemId, [{ key: columnKey, label: columnKey, message: userFacingMessage(error) }]);
    revalidatePath(`/boards/${boardId}`);
    return;
  }
  // 체크박스 미체크와 담당자 미배정을 각 타입의 빈 값으로 정규화한다.
  const svc = graph.service;
  const raw = formData.get("value");
  const requestsContactMove =
    (columnKey === "contact_move" && raw === "컨택 이동") ||
    (columnKey === "consult_status" && raw === "리드컨택으로 넘기기");
  if (requestsContactMove) {
    const moveLabel = columnKey === "consult_status" ? "상담 상황" : "컨택 이동";
    const suppliedRequestId = str(formData, "requestId");
    const requestId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suppliedRequestId)
      ? suppliedRequestId
      : crypto.randomUUID();
    try {
      // 로컬 시드에는 원본 Supabase 클라이언트가 없다. 조용히 넘기면 「눌렀는데 아무 일도 안 일어남」이 된다(BBE-209).
      if (!graph.client) throw new Error("컨택 이동: 이 동작은 연결된 워크스페이스가 필요합니다.");
      const result = await advanceNewLeadToContact(graph.client, { itemId, requestId });
      if (result.status !== "committed") {
        await flashCellErrors(itemId, [{
          key: columnKey,
          label: moveLabel,
          message: result.reason ?? "컨택 이동이 차단되었습니다.",
        }]);
        revalidatePath(`/boards/${boardId}`);
        return;
      }
    } catch (error) {
      await flashCellErrors(itemId, [{
        key: columnKey,
        label: moveLabel,
        message: error instanceof NewLeadAdvanceError
          ? error.message
          : "컨택 이동을 완료하지 못했습니다. 다시 시도해 주세요.",
      }]);
      revalidatePath(`/boards/${boardId}`);
      return;
    }
    revalidatePath(`/boards/${boardId}`);
    revalidatePath("/contract");
    redirect("/contract");
  }
  // ★ 여기서부터는 던지지 않는다(BBE-201). 저장 실패는 «그 셀 아래» 사유로 보여준다 —
  //   던지면 Next 오류 경계가 화면을 통째로 덮어 사용자가 입력하던 것까지 잃는다.
  //   (위 contact_move 분기는 자체 try/catch 와 redirect 를 갖고 있어 건드리지 않는다.
  //    redirect 는 예외로 구현된 제어 흐름이라 catch 로 삼키면 이동이 죽는다.)
  try {
    if (raw instanceof File && raw.size > 0) {
      const column = (await svc.getBoardDetail(ctx, boardId)).columns.find((candidate) => candidate.key === columnKey);
      if (column?.type !== "file") throw new UserFacingActionError("파일 컬럼이 아니에요.");
      const item = await graph.repo.getItem(ctx, itemId);
      if (!item || item.board_id !== boardId) throw new NotFoundError("아이템을 찾을 수 없습니다");
      const stored = await encodeNoticeFile(
        raw,
        graph.client ? { client: graph.client, orgId: ctx.org.id, boardId, itemId } : undefined,
      );
      await graph.repo.setValues(ctx, itemId, { [columnKey]: stored.id, [`${NOTICE_FILE_VALUE_PREFIX}${columnKey}`]: JSON.stringify(stored) });
      revalidatePath(`/boards/${boardId}`);
      return;
    }
    const normalized = boardCellValueFromFormData(formData);
    if (graph.client) {
      const column = (await svc.getBoardDetail(ctx, boardId)).columns.find((candidate) => candidate.key === columnKey);
      if (!column) throw new UserFacingActionError("기록 항목을 찾을 수 없어요.");
      if (column.type === "person" || column.type === "people") {
        const ids = (Array.isArray(normalized) ? normalized : normalized ? [normalized] : [])
          .filter((value): value is string => typeof value === "string");
        if (ids.length > 0) {
          const members = await graph.client.from("org_members").select("user_id")
            .eq("org_id", ctx.org.id).eq("status", "active").in("user_id", ids);
          if (members.error || new Set((members.data ?? []).map((member) => member.user_id)).size !== new Set(ids).size) {
            throw new UserFacingActionError("현재 회사의 활성 멤버만 선택할 수 있어요.");
          }
        }
      }
    }
    const patch: Record<string, import("@/lib/boards/types").CellValue> = { [columnKey]: normalized };
    const { errors } = await svc.setCells(ctx, boardId, itemId, patch);
    await flashCellErrors(itemId, errors);
  } catch (error) {
    console.error("[board cell]", boardId, itemId, columnKey, error);
    await flashCellErrors(itemId, [{ key: columnKey, label: columnKey, message: userFacingMessage(error) }]);
  }
  revalidatePath(`/boards/${boardId}`);
}

/** 아이템 제목 수정. */
export async function renameItemAction(formData: FormData): Promise<void> {
  return runBoardAction(formData, async () => {
    const ctx = await getSession();
    await requirePermission(ctx, "work.item_upsert");
    const boardId = str(formData, "boardId");
    await (await boardsService()).updateItem(ctx, boardId, str(formData, "itemId"), {
      title: str(formData, "title"),
    });
    revalidatePath(`/boards/${boardId}`);
  });
}

/**
 * 칸반 레인 이동. groupBy 가 select 컬럼이면 그 셀 값을, 아니면 group_id 를 바꾼다.
 * (dnd 라이브러리 도입 전까지 폼 기반 이동 — 결과는 동일)
 */
export async function moveItemAction(formData: FormData): Promise<void> {
  return runBoardAction(formData, async () => {
    const ctx = await getSession();
    await requirePermission(ctx, "work.item_upsert");
    const boardId = str(formData, "boardId");
    const itemId = str(formData, "itemId");
    const lane = str(formData, "lane");
    const groupBy = str(formData, "groupBy");
    const graph = await createRequestBoards();
    const svc = graph.service;
    if (groupBy) {
      const { errors } = await svc.setCells(ctx, boardId, itemId, {
        [groupBy]: lane === "" ? null : lane,
      });
      await flashCellErrors(itemId, errors);
    } else {
      await svc.updateItem(ctx, boardId, itemId, { group_id: lane === "" ? null : lane });
    }
    // 이동 «알림» 은 연결된 워크스페이스에서만 존재한다(BBE-209).
    //   notify_board_item_moved 는 Supabase RPC 이고 수신자·중복방지 판정을 DB 가 소유한다.
    //   로컬 시드에는 그 저장소가 «없으므로» 보낼 알림도 있을 수 없다 — /api/tab-views 와 같은 사실이다.
    //   ★ 여기서 던지면 안 된다. 위의 이동 쓰기(setCells/updateItem)가 «이미 커밋됐다» —
    //     던지는 순간 실제로 이동은 됐는데 화면은 오류 경계로 덮인다. 성공을 실패로 표시하는 것이고
    //     BBE-183·BBE-193·BBE-201 이 반복해서 잡아 온 바로 그 결함이다.
    //   공지 읽음 표시와 같은 분류다 — «쓰기 부작용이고 표시되는 것이 아니다».
    if (graph.client) {
      await notifyBoardItemMoved(graph.client, ctx, {
        boardId,
        itemId,
        eventKey: moveEventKey(formData),
      });
    }
    revalidatePath(`/boards/${boardId}`);
  });
}

export async function addGroupAction(formData: FormData): Promise<void> {
  return runBoardAction(formData, async () => {
    const ctx = await getSession();
    await requirePermission(ctx, "structure.section_manage");
    const boardId = str(formData, "boardId");
    await (await boardsService()).addGroup(ctx, boardId, { name: str(formData, "name") });
    revalidatePath(`/boards/${boardId}`);
  });
}

export async function reorderGroupsAction(formData: FormData): Promise<void> {
  return runBoardAction(formData, async () => {
    const ctx = await getSession();
    await requirePermission(ctx, "structure.section_manage");
    const boardId = str(formData, "boardId");
    let groupIds: string[];
    try {
      const parsed: unknown = JSON.parse(str(formData, "groupIds"));
      if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== "string" || id.length === 0)) throw new Error();
      groupIds = parsed;
    } catch {
      throw new UserFacingActionError("그룹 순서를 읽지 못했어요. 새로고침 후 다시 시도해 주세요.");
    }
    await (await boardsService()).reorderGroups(ctx, boardId, groupIds);
    revalidatePath(`/boards/${boardId}`);
  });
}

/**
 * 행 드래그 — 그룹 내 상하 이동과 그룹 간 이동을 **한 경로**로 처리한다 (PLAN-002 WO-2 ⓒ).
 *
 * 두 동작을 나누지 않은 이유: 그룹을 바꾸는 이동도 결국 "대상 그룹의 N번째 자리에 꽂는 것"
 * 이고, 나누면 같은 재색인 규칙이 두 벌 생긴다.
 *
 * 재색인은 **대상 그룹 전체**를 0..n-1 로 다시 매긴다. 삽입 위치에만 소수 sort_order 를
 * 끼워 넣는 방식은 반복하면 정밀도가 무너져 순서가 뒤섞인다(무증상 파손) — 그래서 매번
 * 정수로 다시 세운다. 그룹당 행 수 규모에서는 이 비용이 문제되지 않는다.
 */
export async function moveRowAction(formData: FormData): Promise<void> {
  return runBoardAction(formData, async () => {
    const ctx = await getSession();
    await requirePermission(ctx, "work.item_upsert");
    const boardId = str(formData, "boardId");
    const itemId = str(formData, "itemId");
    const rawGroup = str(formData, "groupId");
    const groupId = rawGroup === "" ? null : rawGroup;
    const requested = Number.parseInt(str(formData, "index"), 10);

    const graph = await createRequestBoards();
    const svc = graph.service;
    const items = await svc.listItems(ctx, boardId);
    const moving = items.find((i) => i.id === itemId);
    if (!moving) throw new NotFoundError("아이템을 찾을 수 없습니다");

    const targetKey = groupKeyOf(groupId);
    const siblings: ItemWithValues[] = items
      .filter((i) => i.id !== itemId && groupKeyOf(i.group_id) === targetKey)
      .sort((a, b) => a.sort_order - b.sort_order);

    const at = Number.isNaN(requested)
      ? siblings.length
      : Math.max(0, Math.min(requested, siblings.length));
    siblings.splice(at, 0, moving);

    await Promise.all(siblings.map(async (item, index) => {
      const patch: ItemPatch = { sort_order: index };
      // 그룹이 실제로 바뀐 행에만 group_id 를 싣는다(불필요한 쓰기 금지).
      if (item.id === itemId && groupKeyOf(item.group_id) !== targetKey) patch.group_id = groupId;
      await svc.updateItem(ctx, boardId, item.id, patch);
    }));

    // 이동 «알림» 은 연결된 워크스페이스에서만 존재한다(BBE-209).
    //   notify_board_item_moved 는 Supabase RPC 이고 수신자·중복방지 판정을 DB 가 소유한다.
    //   로컬 시드에는 그 저장소가 «없으므로» 보낼 알림도 있을 수 없다 — /api/tab-views 와 같은 사실이다.
    //   ★ 여기서 던지면 안 된다. 위의 이동 쓰기(setCells/updateItem)가 «이미 커밋됐다» —
    //     던지는 순간 실제로 이동은 됐는데 화면은 오류 경계로 덮인다. 성공을 실패로 표시하는 것이고
    //     BBE-183·BBE-193·BBE-201 이 반복해서 잡아 온 바로 그 결함이다.
    //   공지 읽음 표시와 같은 분류다 — «쓰기 부작용이고 표시되는 것이 아니다».
    if (graph.client) {
      await notifyBoardItemMoved(graph.client, ctx, {
        boardId,
        itemId,
        eventKey: moveEventKey(formData),
      });
    }

    revalidatePath(`/boards/${boardId}`);
  });
}

/**
 * 그룹별 컬럼 배치 저장 (PLAN-002 WO-2 ⓑ).
 *
 * 저장하는 것은 **배치뿐**이다 — 컬럼을 만들거나 지우지 않으므로 셀 값(EAV)은 영향받지 않고,
 * 다른 그룹의 배치도 건드리지 않는다("그룹 간 독립 배치").
 *
 * 인가: 저장소 자체는 권한을 모른다. 여기서 `getBoardDetail` 을 먼저 호출해 이 세션이
 * 그 보드를 볼 수 있는지 확인하고(없으면 NotFoundError), 통과한 조직 id 로만 키를 만든다.
 */
export async function setGroupColumnOrderAction(formData: FormData): Promise<void> {
  return runBoardAction(formData, async () => {
    const ctx = await getSession();
    await requirePermission(ctx, "structure.column_manage");
    const boardId = str(formData, "boardId");
    const groupKey = str(formData, "groupKey");

    // 접근 권한 확인 겸 유효 컬럼 목록 확보.
    const graph = await createRequestBoards();
    const { columns } = await graph.service.getBoardDetail(ctx, boardId);
    const valid = new Set(columns.map((c) => c.key));

    const order = str(formData, "order")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "" && valid.has(s));

    await setGroupColumnOrder(graph.repo, ctx, boardId, groupKey, order);
    revalidatePath(`/boards/${boardId}`);
  });
}

function layoutFromFormData(formData: FormData): DetailLayoutEntry[] {
  try {
    return normalizeDetailLayout(JSON.parse(str(formData, "layout")));
  } catch {
    throw new Error("상세 필드 배치 형식이 올바르지 않습니다.");
  }
}

/** 보드 기본 또는 그룹(제품 아이템) 오버라이드를 저장한다. 값 EAV는 전혀 변경하지 않는다. */
export async function saveDetailLayoutAction(formData: FormData): Promise<void> {
  return runBoardAction(formData, async () => {
    const ctx = await getSession();
    await requirePermission(ctx, "structure.column_manage");
    const boardId = str(formData, "boardId");
    const groupId = str(formData, "groupId");
    const graph = await createRequestBoards();
    const detail = await graph.service.getBoardDetail(ctx, boardId);
    const columnKeys = new Set(detail.columns.map((column) => column.key));
    const layout = layoutFromFormData(formData).filter(
      (entry) => entry.source === "detail" || columnKeys.has(entry.key),
    );
    if (groupId) {
      if (!detail.groups.some((group) => group.id === groupId)) throw new NotFoundError("아이템을 찾을 수 없습니다.");
      await graph.repo.setGroupDetailLayout(ctx, groupId, layout);
    } else {
      await graph.repo.setBoardDetailLayout(ctx, boardId, layout);
    }
    revalidatePath(`/boards/${boardId}`);
  });
}

export async function resetGroupDetailLayoutAction(formData: FormData): Promise<void> {
  return runBoardAction(formData, async () => {
    const ctx = await getSession();
    await requirePermission(ctx, "structure.column_manage");
    const boardId = str(formData, "boardId");
    const groupId = str(formData, "groupId");
    const graph = await createRequestBoards();
    const detail = await graph.service.getBoardDetail(ctx, boardId);
    if (!detail.groups.some((group) => group.id === groupId)) throw new NotFoundError("아이템을 찾을 수 없습니다.");
    await graph.repo.setGroupDetailLayout(ctx, groupId, null);
    revalidatePath(`/boards/${boardId}`);
  });
}

export async function addDetailFieldAction(formData: FormData): Promise<void> {
  return runBoardAction(formData, async () => {
    const ctx = await getSession();
    await requirePermission(ctx, "structure.column_manage");
    const boardId = str(formData, "boardId");
    const groupId = str(formData, "groupId");
    const label = str(formData, "label").trim();
    const type = str(formData, "type") || "text";
    if (!label || !isFieldType(type)) throw new Error("상세 필드 이름과 타입을 확인해 주세요.");
    const graph = await createRequestBoards();
    const detail = await graph.service.getBoardDetail(ctx, boardId);
    const group = groupId ? detail.groups.find((candidate) => candidate.id === groupId) : undefined;
    if (groupId && !group) throw new NotFoundError("아이템을 찾을 수 없습니다.");
    const current = resolveDetailLayout(detail.board.detail_layout_jsonb, group?.detail_layout_jsonb).entries;
    const occupied = new Set([...detail.columns.map((column) => column.key), ...current.map((entry) => entry.key)]);
    const base = detailKeyFromLabel(label);
    let key = base;
    for (let suffix = 2; occupied.has(key); suffix += 1) key = `${base}_${suffix}`.slice(0, 80);
    const next = [...current, { key, source: "detail" as const, label, type }];
    if (group) await graph.repo.setGroupDetailLayout(ctx, group.id, next);
    else await graph.repo.setBoardDetailLayout(ctx, boardId, next);
    revalidatePath(`/boards/${boardId}`);
  });
}

/** 상세 전용 값은 현재 유효한 배치에 존재할 때만 쓴다. assigned scope는 getItem/RLS가 재검증한다. */
export async function setDetailValueAction(formData: FormData): Promise<void> {
  return runBoardAction(formData, async () => {
    const ctx = await getSession();
    await requirePermission(ctx, "work.item_upsert");
    const boardId = str(formData, "boardId");
    const itemId = str(formData, "itemId");
    const key = str(formData, "fieldKey");
    const graph = await createRequestBoards();
    const [detail, item] = await Promise.all([
      graph.service.getBoardDetail(ctx, boardId),
      graph.repo.getItem(ctx, itemId),
    ]);
    if (!item || item.board_id !== boardId) throw new NotFoundError("아이템을 찾을 수 없습니다.");
    const group = item.group_id ? detail.groups.find((candidate) => candidate.id === item.group_id) : undefined;
    const entry = resolveDetailLayout(detail.board.detail_layout_jsonb, group?.detail_layout_jsonb).entries
      .find((candidate) => candidate.key === key && candidate.source === "detail");
    if (!entry) throw new Error("현재 상세 배치에 없는 필드입니다.");
    await graph.repo.setValues(ctx, itemId, { [key]: str(formData, "value") });
    revalidatePath(`/boards/${boardId}`);
  });
}

/** 미배치 값의 키를 현재 그룹 배치에 다시 올린다. 값 자체는 읽기만 하며 그대로 보존한다. */
export async function addUnplacedDetailEntryAction(formData: FormData): Promise<void> {
  return runBoardAction(formData, async () => {
    const ctx = await getSession();
    await requirePermission(ctx, "structure.column_manage");
    const boardId = str(formData, "boardId");
    const groupId = str(formData, "groupId");
    const key = str(formData, "fieldKey");
    const graph = await createRequestBoards();
    const detail = await graph.service.getBoardDetail(ctx, boardId);
    const group = groupId ? detail.groups.find((candidate) => candidate.id === groupId) : undefined;
    if (groupId && !group) throw new NotFoundError("아이템을 찾을 수 없습니다.");
    const current = resolveDetailLayout(detail.board.detail_layout_jsonb, group?.detail_layout_jsonb).entries;
    if (current.some((entry) => entry.key === key)) return;
    const column = detail.columns.find((candidate) => candidate.key === key);
    const next: DetailLayoutEntry[] = [
      ...current,
      column
        ? { key, source: "column", label: column.label, type: column.type }
        : { key, source: "detail", label: key, type: "text" },
    ];
    if (group) await graph.repo.setGroupDetailLayout(ctx, group.id, next);
    else await graph.repo.setBoardDetailLayout(ctx, boardId, next);
    revalidatePath(`/boards/${boardId}`);
  });
}

/** 같은 EAV key로 표 컬럼을 만들기 때문에 승격 전후 값은 이동·복사 없이 유지된다. */
export async function promoteDetailFieldAction(formData: FormData): Promise<void> {
  return runBoardAction(formData, async () => {
    const ctx = await getSession();
    await requirePermission(ctx, "structure.column_manage");
    const boardId = str(formData, "boardId");
    const key = str(formData, "fieldKey");
    const graph = await createRequestBoards();
    const detail = await graph.service.getBoardDetail(ctx, boardId);
    const layouts = [normalizeDetailLayout(detail.board.detail_layout_jsonb), ...detail.groups
      .filter((group) => group.detail_layout_jsonb !== null && group.detail_layout_jsonb !== undefined)
      .map((group) => normalizeDetailLayout(group.detail_layout_jsonb))];
    const entry = layouts.flat().find((candidate) => candidate.key === key && candidate.source === "detail");
    if (!entry) throw new Error("승격할 상세 전용 필드를 찾을 수 없습니다.");
    if (!detail.columns.some((column) => column.key === key)) {
      await graph.repo.createColumn(ctx, boardId, {
        key,
        label: entry.label ?? key,
        type: entry.type && isFieldType(entry.type) ? entry.type : "text",
      });
    }
    const promote = (layout: readonly DetailLayoutEntry[]) => layout.map((candidate) =>
      candidate.key === key ? { ...candidate, source: "column" as const } : candidate,
    );
    await graph.repo.setBoardDetailLayout(ctx, boardId, promote(normalizeDetailLayout(detail.board.detail_layout_jsonb)));
    await Promise.all(detail.groups.map(async (group) => {
      if (group.detail_layout_jsonb === null || group.detail_layout_jsonb === undefined) return;
      await graph.repo.setGroupDetailLayout(ctx, group.id, promote(normalizeDetailLayout(group.detail_layout_jsonb)));
    }));
    revalidatePath(`/boards/${boardId}`);
  });
}
