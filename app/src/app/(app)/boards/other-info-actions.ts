"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { createRequestBoards } from "@/lib/boards/server";
import { loadPermGuard } from "@/lib/perm/guard";
import {
  parseOtherInfoValue,
} from "@/lib/boards/structured-field";
import type { OtherInfoSaveState } from "./other-info-action-state";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function errorState(previous: OtherInfoSaveState, requestId: string, message: string): OtherInfoSaveState {
  return { ok: false, message, requestId, attempt: previous.attempt + 1 };
}

export async function saveOtherInfoAction(
  previous: OtherInfoSaveState,
  formData: FormData,
): Promise<OtherInfoSaveState> {
  const requestId = text(formData, "requestId");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(requestId)) {
    return errorState(previous, requestId, "저장 요청을 다시 시작해 주세요.");
  }
  const boardId = text(formData, "boardId");
  const itemId = text(formData, "itemId");
  const fieldKey = text(formData, "fieldKey");
  if (!boardId || !itemId || !fieldKey) return errorState(previous, requestId, "저장 대상을 찾을 수 없어요.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text(formData, "value"));
  } catch {
    return errorState(previous, requestId, "기타정보 저장 형식이 올바르지 않아요.");
  }
  const value = parseOtherInfoValue(parsed);
  if (!value) return errorState(previous, requestId, "다섯 항목을 모두 확인해 주세요.");

  try {
    const ctx = await getSession();
    const permission = await loadPermGuard(ctx.org.id, "work.item_upsert");
    if (permission.kind !== "allowed") {
      return errorState(
        previous,
        requestId,
        permission.reason === "permission" ? "이 항목을 수정할 권한이 없어요." : "권한을 확인하지 못했어요.",
      );
    }
    const { service } = await createRequestBoards();
    const [detail, current] = await Promise.all([
      service.getBoardDetail(ctx, boardId),
      service.getItem(ctx, boardId, itemId),
    ]);
    const column = detail.columns.find((candidate) => candidate.key === fieldKey);
    if (!column || column.type !== "other_info") {
      return errorState(previous, requestId, "기타정보 컬럼을 찾을 수 없어요.");
    }
    const currentValue = parseOtherInfoValue(current.values[fieldKey] ?? null);
    if (!currentValue || JSON.stringify(currentValue) !== JSON.stringify(value)) {
      const result = await service.setCells(ctx, boardId, itemId, { [fieldKey]: value });
      const failure = result.errors.find((candidate) => candidate.key === fieldKey);
      if (failure) return errorState(previous, requestId, failure.message);
    }
    revalidatePath(`/boards/${boardId}`);
    return { ok: true, message: "저장됐어요.", requestId, attempt: previous.attempt + 1 };
  } catch (cause) {
    console.error("[other info save]", boardId, itemId, cause);
    return errorState(previous, requestId, "저장하지 못했어요. 입력은 그대로 두었으니 다시 시도해 주세요.");
  }
}
