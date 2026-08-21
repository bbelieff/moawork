"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { loadPermGuard } from "@/lib/perm/guard";
import { createRequestBoards, requireRequestClient } from "@/lib/boards/server";
import { BOARD_COLUMN_RPC, boardColumnErrorMessage } from "@/lib/boards/column-metadata-contract";

export type ColumnScheduleRow = {
  id: string;
  itemId: string;
  targetUserId: string;
  kind: "notification" | "deadline" | "reminder";
  scheduledFor: string;
  status: "scheduled" | "claimed" | "fired" | "cancelled";
};

export type ColumnSettingsResult = { ok: boolean; message: string; schedules?: ColumnScheduleRow[] };

function value(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

async function runtime(boardId: string, columnId: string) {
  if (!boardId || !columnId) throw Object.assign(new Error("invalid column settings"), { code: "22023" });
  const ctx = await getSession();
  const guard = await loadPermGuard(ctx.org.id, "structure.column_manage");
  if (guard.kind !== "allowed") throw Object.assign(new Error("column settings permission denied"), { code: "42501" });
  const { client, service } = await createRequestBoards();
  const detail = await service.getBoardDetail(ctx, boardId);
  const column = detail.columns.find((candidate) => candidate.id === columnId);
  if (!column) throw Object.assign(new Error("column not found"), { code: "P0002" });
  return { ctx, client: requireRequestClient(client, "컬럼 설정"), column };
}

function failure(error: unknown): ColumnSettingsResult {
  console.error("[BBE-178 column settings]", error);
  return { ok: false, message: boardColumnErrorMessage((error as { code?: string } | null)?.code) };
}

export async function saveColumnSettingsAction(input: {
  boardId: string;
  columnId: string;
  requestId: string;
  description: string;
  editPolicy: "all" | "managers";
  viewPolicy: "all" | "managers";
  summaryHidden: boolean;
  wrapMode: "single" | "wrap";
  dateSettings?: {
    includeTime: boolean;
    displayFormat: "yyyy-MM-dd" | "yyyy.MM.dd" | "MM/dd/yyyy";
    notificationOffsetMinutes?: number;
    deadline: boolean;
    reminderOffsetsMinutes: number[];
  };
}): Promise<ColumnSettingsResult> {
  try {
    const { ctx, client } = await runtime(value(input.boardId), value(input.columnId));
    const result = await client.rpc(BOARD_COLUMN_RPC.command, {
      p_org_id: ctx.org.id,
      p_board_id: input.boardId,
      p_column_id: input.columnId,
      p_operation: "settings",
      p_request_id: value(input.requestId),
      p_payload: {
        description: input.description.trim(),
        editPolicy: input.editPolicy === "managers" ? { roles: ["owner", "admin"] } : {},
        viewPolicy: input.viewPolicy === "managers" ? { roles: ["owner", "admin"] } : {},
        summaryHidden: Boolean(input.summaryHidden),
        wrapMode: input.wrapMode,
        ...(input.dateSettings ? { dateSettings: input.dateSettings } : {}),
      },
      p_copy_values: false,
    });
    if (result.error) throw result.error;
    revalidatePath(`/boards/${input.boardId}`);
    return { ok: true, message: "컬럼 설정을 저장했습니다." };
  } catch (error) {
    return failure(error);
  }
}

export async function loadColumnSchedulesAction(boardId: string, columnId: string): Promise<ColumnSettingsResult> {
  try {
    const { ctx, client } = await runtime(value(boardId), value(columnId));
    const result = await client.from("board_column_date_schedules")
      .select("id,item_id,target_user_id,kind,scheduled_for,status")
      .eq("org_id", ctx.org.id).eq("board_id", boardId).eq("column_id", columnId)
      .order("scheduled_for", { ascending: true });
    if (result.error) throw result.error;
    return {
      ok: true,
      message: "예약 상태를 불러왔습니다.",
      schedules: (result.data ?? []).map((row) => ({
        id: String(row.id), itemId: String(row.item_id), targetUserId: String(row.target_user_id),
        kind: row.kind as ColumnScheduleRow["kind"], scheduledFor: String(row.scheduled_for), status: row.status as ColumnScheduleRow["status"],
      })),
    };
  } catch (error) {
    return failure(error);
  }
}

export async function setColumnScheduleAction(input: {
  boardId: string; columnId: string; itemId: string; targetUserId: string;
  kind: ColumnScheduleRow["kind"]; scheduledFor: string; requestId: string;
}): Promise<ColumnSettingsResult> {
  try {
    const { ctx, client } = await runtime(value(input.boardId), value(input.columnId));
    const result = await client.rpc("set_board_column_date_schedule", {
      p_org_id: ctx.org.id, p_board_id: input.boardId, p_column_id: input.columnId,
      p_item_id: value(input.itemId), p_target_user_id: value(input.targetUserId), p_kind: input.kind,
      p_scheduled_for: value(input.scheduledFor), p_request_id: value(input.requestId),
      p_payload: { timezone: "Asia/Seoul", recipientSelection: "explicit" },
    });
    if (result.error) throw result.error;
    return { ok: true, message: "예약을 저장했습니다." };
  } catch (error) {
    return failure(error);
  }
}

export async function cancelColumnScheduleAction(boardId: string, columnId: string, scheduleId: string, requestId: string): Promise<ColumnSettingsResult> {
  try {
    const { ctx, client } = await runtime(value(boardId), value(columnId));
    const result = await client.rpc("cancel_board_column_date_schedule", {
      p_org_id: ctx.org.id, p_schedule_id: value(scheduleId), p_request_id: value(requestId),
    });
    if (result.error) throw result.error;
    return { ok: true, message: "예약을 취소했습니다." };
  } catch (error) {
    return failure(error);
  }
}
