"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { loadPermGuard } from "@/lib/perm/guard";
import { createRequestBoards, requireRequestClient } from "@/lib/boards/server";
import { BOARD_COLUMN_RPC, boardColumnErrorMessage, type BoardColumnTypeDryRun } from "@/lib/boards/column-metadata-contract";
import { isFieldType } from "@/lib/boards/validation";
import type { ColumnCommandState } from "./column-command-state";

function required(data: FormData, key: string): string {
  const value = String(data.get(key) ?? "").trim();
  if (!value) throw Object.assign(new Error("invalid column command"), { code: "22023" });
  return value;
}

function failure(error: unknown): string {
  console.error("[BBE-177 column command]", error);
  return boardColumnErrorMessage((error as { code?: string } | null)?.code);
}

export async function runColumnCommandAction(
  _previous: ColumnCommandState,
  data: FormData,
): Promise<ColumnCommandState> {
  const boardId = required(data, "boardId");
  const operation = required(data, "operation");
  try {
    const ctx = await getSession();
    const guard = await loadPermGuard(ctx.org.id, "structure.column_manage");
    if (guard.kind !== "allowed") throw Object.assign(new Error("column structure permission denied"), { code: "42501" });
    const { client, service } = await createRequestBoards();
    const detail = await service.getBoardDetail(ctx, boardId);
    const columnId = String(data.get("columnId") ?? "").trim() || null;
    if (columnId && !detail.columns.some((column) => column.id === columnId) && operation !== "restore") {
      throw Object.assign(new Error("column not found"), { code: "P0002" });
    }
    const rpc = requireRequestClient(client, "컬럼 구조 변경");
    const requestId = required(data, "requestId");
    let payload: Record<string, unknown> = {};
    let dryRun: BoardColumnTypeDryRun | undefined;

    if (operation === "duplicate") {
      const source = detail.columns.find((column) => column.id === columnId)!;
      payload = { position: source.sort_order + 1, label: `${source.label} 복사본` };
    } else if (operation === "create_at") {
      const source = detail.columns.find((column) => column.id === columnId)!;
      payload = { position: source.sort_order + 1, label: required(data, "label"), type: required(data, "type"), source: "in" };
    } else if (operation === "rename") {
      payload = { label: required(data, "label") };
    } else if (operation === "type_commit") {
      const targetType = required(data, "targetType");
      if (!isFieldType(targetType)) throw Object.assign(new Error("invalid type"), { code: "22023" });
      const preview = await rpc.rpc(BOARD_COLUMN_RPC.typeDryRun, {
        p_org_id: ctx.org.id, p_board_id: boardId, p_column_id: columnId!, p_target_type: targetType,
      });
      if (preview.error) throw preview.error;
      dryRun = preview.data as BoardColumnTypeDryRun;
      if (!dryRun.safe) return { ok: false, message: `${dryRun.invalidValues}개 값은 변환할 수 없어 유형을 바꾸지 않았습니다.`, dryRun };
      payload = { targetType, fingerprint: dryRun.fingerprint };
    } else if (operation === "restore") {
      payload = { position: detail.columns.length };
    } else if (operation !== "archive") {
      throw Object.assign(new Error("unsupported column operation"), { code: "22023" });
    }

    const result = await rpc.rpc(BOARD_COLUMN_RPC.command, {
      p_org_id: ctx.org.id,
      p_board_id: boardId,
      p_column_id: columnId,
      p_operation: operation,
      p_request_id: requestId,
      p_payload: payload,
      ...(operation === "duplicate" ? { p_copy_values: data.get("copyValues") === "true" } : {}),
    });
    if (result.error) throw result.error;
    // Archive keeps the current client tree alive long enough to hand its id to
    // the board-level undo surface. Every other operation can refresh at once.
    if (operation !== "archive") revalidatePath(`/boards/${boardId}`);
    return {
      ok: true,
      message: operation === "archive" ? "컬럼을 휴지통으로 옮겼습니다. 복구할 수 있습니다." : "컬럼 변경을 저장했습니다.",
      archivedColumnId: operation === "archive" ? columnId ?? undefined : undefined,
      dryRun,
    };
  } catch (error) {
    return { ok: false, message: failure(error) };
  }
}
