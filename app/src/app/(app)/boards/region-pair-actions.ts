"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { loadPermGuard } from "@/lib/perm/guard";
import { createClient } from "@/lib/supabase/server";
import { updateCanonicalNewLead, NewLeadMutationError } from "@/lib/new-lead/mutations";
import { validateRegionPair } from "@/lib/new-lead/region-pair";
import { createRequestBoards } from "@/lib/boards/server";
import { userFacingMessage } from "@/lib/boards/boardActionFlash";
import { isRegionSidoKey, isRegionSigunguKey } from "@/lib/new-lead/region-pair";
import { isSourceEditable } from "@/lib/field/source";
import { NotFoundError } from "@/lib/boards/service";

export type RegionPairActionResult = Readonly<{ ok: boolean; message: string; requiresReload?: boolean; sido?: string | null; sigungu?: string | null }>;

/**
 * 연결된 신규리드 지역 쌍 원자 저장 — updateCanonicalNewLead 두 필드 patch 1회.
 * 단일필드 액션을 두 번 호출해 중간 잘못된 조합을 남기지 않는다.
 *
 * 서버가 클라이언트 dealId를 그대로 믿지 않는다: 권한 확인 뒤 인가된 board/item을
 * 먼저 읽어 board·item 소속과 실제 canonical deal lineage를 묶고, 클라이언트 ID가
 * 다르면 거부한다. 두 지역 컬럼이 실제로 있고 일반 경로와 같은 편집가능
 * 판정(readonly·source)을 통과해야 RPC로 간다 — UI readonly만으로는 막지 못한다.
 * 원본 필드 매핑(region_sido/region_sigungu)은 그대로 둔다.
 */
export async function updateNewLeadRegionPairAction(input: {
  boardId: string;
  itemId: string;
  dealId: string;
  sido: string;
  sigungu: string;
}): Promise<RegionPairActionResult> {
  const validated = validateRegionPair({ sido: input.sido, sigungu: input.sigungu });
  if (!validated.ok) {
    return { ok: false, message: validated.message };
  }
  if (!input.boardId || !input.itemId || !input.dealId) {
    return { ok: false, message: "지역을 저장할 대상을 확인해 주세요. 입력은 유지됩니다." };
  }
  try {
    const ctx = await getSession();
    const permission = await loadPermGuard(ctx.org.id, "work.item_upsert");
    if (permission.kind !== "allowed") {
      return {
        ok: false,
        message: permission.reason === "permission" ? "이 지역을 저장할 권한이 없습니다." : "권한을 확인하지 못했습니다.",
      };
    }
    // 인가된 board/item을 먼저 읽는다 — board/item 소속과 실제 deal lineage를 묶는다.
    const graph = await createRequestBoards();
    let authoritativeItem;
    try {
      authoritativeItem = await graph.service.getItem(ctx, input.boardId, input.itemId);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return { ok: false, message: "지역을 저장할 대상을 확인해 주세요. 입력은 유지됩니다." };
      }
      throw error;
    }
    // 클라이언트 dealId를 믿지 않고 실제 canonical lineage에 묶는다.
    // item.deal_id가 곧 canonical deal/company lineage다(회사는 deal을 통해 묶인다).
    const actualDealId = authoritativeItem.deal_id;
    if (!actualDealId || actualDealId !== input.dealId) {
      return { ok: false, message: "지역을 저장할 대상을 확인해 주세요. 입력은 유지됩니다." };
    }
    // 두 지역 컬럼이 실제로 있고 일반 경로와 같은 편집가능 판정을 통과해야 한다.
    let detail;
    try {
      detail = await graph.service.getBoardDetail(ctx, input.boardId);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return { ok: false, message: "지역을 저장할 대상을 확인해 주세요. 입력은 유지됩니다." };
      }
      throw error;
    }
    const sidoCol = detail.columns.find((column) => isRegionSidoKey(column.key)) ?? null;
    const sigunguCol = detail.columns.find((column) => isRegionSigunguKey(column.key)) ?? null;
    if (!sidoCol || !sigunguCol) {
      return { ok: false, message: "시도·시군구 컬럼 구성을 확인해 주세요. 입력은 유지됩니다." };
    }
    for (const column of [sidoCol, sigunguCol]) {
      if (column.is_readonly === true) {
        return { ok: false, message: `${column.label}: 자동 계산되는 칸이라 손으로 고칠 수 없습니다. 입력은 유지됩니다.` };
      }
      if (!isSourceEditable(column.source)) {
        return { ok: false, message: `${column.label}: 자동으로 채워지는 칸은 직접 바꿀 수 없습니다. 입력은 유지됩니다.` };
      }
    }
    await updateCanonicalNewLead(await createClient(), {
      orgId: ctx.org.id,
      dealId: actualDealId,
      requestId: crypto.randomUUID(),
      patch: { region_sido: validated.sido, region_sigungu: validated.sigungu },
      valueSource: "manual",
    });
    revalidatePath(`/boards/${input.boardId}`);
    revalidatePath("/newcust");
    return { ok: true, message: "✓ 자동 저장됨", sido: validated.sido, sigungu: validated.sigungu };
  } catch (error) {
    return {
      ok: false,
      message: `${error instanceof NewLeadMutationError ? error.message : userFacingMessage(error)} 입력은 유지됩니다.`,
    };
  }
}

/**
 * 일반보드 지역 쌍 원자 저장 — 실제 컬럼 키 두 값을 setCellsStrict 1회에 함께 저장한다.
 * 시도 변경+시군구 초기화를 하나의 서버 요청으로 닫는다.
 * 첫 쓰기 전 모든 검사가 끝나고 하나라도 실패하면 둘 다 쓰지 않는다.
 */
export async function updateBoardRegionPairAction(input: {
  boardId: string;
  itemId: string;
  sidoKey: string;
  sigunguKey: string;
  sido: string;
  sigungu: string;
}): Promise<RegionPairActionResult> {
  const validated = validateRegionPair({ sido: input.sido, sigungu: input.sigungu });
  if (!validated.ok) {
    return { ok: false, message: validated.message };
  }
  if (!input.boardId || !input.itemId || !input.sidoKey || !input.sigunguKey) {
    return { ok: false, message: "지역을 저장할 대상을 확인해 주세요. 입력은 유지됩니다." };
  }
  if (input.sidoKey === input.sigunguKey) {
    return { ok: false, message: "시도·시군구 컬럼을 확인해 주세요. 입력은 유지됩니다." };
  }
  try {
    const ctx = await getSession();
    const permission = await loadPermGuard(ctx.org.id, "work.item_upsert");
    if (permission.kind !== "allowed") {
      return {
        ok: false,
        message: permission.reason === "permission" ? "이 지역을 저장할 권한이 없습니다." : "권한을 확인하지 못했습니다.",
      };
    }
    const graph = await createRequestBoards();
    const result = await graph.service.setCellsStrict(
      ctx,
      input.boardId,
      input.itemId,
      {
        [input.sidoKey]: validated.sido,
        [input.sigunguKey]: validated.sigungu,
      },
      crypto.randomUUID(),
      [input.sidoKey, input.sigunguKey],
    );
    if (result.errors.length > 0) {
      // committed:"unknown"은 저장 거부가 아니라 post-commit 확인불가다 —
      // "아무것도 안 저장됐다"고 꾸미지 않고, 성공으로 꾸미지도 않는다.
      // 초안을 보존한 채 재조회 뒤 재시도해야 하므로 중복 쓰기를 막는 안내를 붙인다.
      const kept =
        result.committed === "none"
          ? "입력은 유지됩니다."
          : result.committed === "unknown"
            ? "입력은 유지됩니다. 화면을 새로고침해 실제 저장값을 확인한 뒤 다시 시도해 주세요(확인 전에는 다시 저장하지 마세요)."
            : "화면을 새로고침해 실제 저장값을 확인해 주세요.";
      return {
        ok: false,
        message: `${result.errors.map((error) => error.message).join(" · ")} ${kept}`,
        requiresReload: result.committed !== "none",
      };
    }
    revalidatePath(`/boards/${input.boardId}`);
    return { ok: true, message: "✓ 자동 저장됨", sido: validated.sido, sigungu: validated.sigungu };
  } catch (error) {
    return { ok: false, message: `${userFacingMessage(error)} 입력은 유지됩니다.` };
  }
}
