"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { createRequestBoards } from "@/lib/boards/server";
import { loadPermGuard } from "@/lib/perm/guard";
import {
  parseBoardSummarySettingsRequest,
  type BoardSummarySettingsRequest,
} from "@/lib/boards/summary-settings";
import type { BoardSummaryMetricConfig } from "@/lib/boards/summary";

export type SaveBoardSummaryResult =
  | { ok: true; requestId: string; config: BoardSummaryMetricConfig[]; replayed: boolean }
  | { ok: false; requestId: string; error: string };

export async function saveBoardSummarySettingsAction(
  boardId: string,
  requestValue: BoardSummarySettingsRequest,
): Promise<SaveBoardSummaryResult> {
  const fallbackRequestId = typeof requestValue?.requestId === "string" ? requestValue.requestId : "";
  try {
    const request = parseBoardSummarySettingsRequest(requestValue);
    const ctx = await getSession();
    const permission = await loadPermGuard(ctx.org.id, "structure.tab_manage");
    if (permission.kind !== "allowed") {
      return {
        ok: false,
        requestId: request.requestId,
        error: permission.reason === "unavailable"
          ? "요약 설정 권한을 확인하지 못했습니다. 다시 시도해 주세요."
          : "요약 설정을 변경할 권한이 없습니다.",
      };
    }
    const { service } = await createRequestBoards();
    const result = await service.applyBoardSummarySettings(ctx, boardId, request);
    revalidatePath(`/boards/${boardId}`);
    return { ok: true, requestId: request.requestId, config: result.config, replayed: result.replayed };
  } catch (error) {
    console.error("[board summary] settings save failed", error);
    return { ok: false, requestId: fallbackRequestId, error: "요약 설정을 저장하지 못했습니다. 입력을 확인하고 다시 시도해 주세요." };
  }
}
