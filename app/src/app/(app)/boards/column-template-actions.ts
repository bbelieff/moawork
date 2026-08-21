"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { createRequestBoards, requireRequestClient } from "@/lib/boards/server";
import { loadPermGuard } from "@/lib/perm/guard";
import type { Ctx } from "@/lib/types";
import {
  ColumnTemplateRepo,
  columnTemplatePayload,
  type ColumnTemplateBoardsRepo,
  type ColumnTemplateRecord,
  type ColumnTemplateScope,
} from "@/lib/presets/column-template";
import type { ColumnTemplateActionState } from "./column-template-state";

function required(formData: FormData, key: string): string {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error("INVALID_REQUEST");
  return value;
}

function asRepo(repo: unknown): ColumnTemplateBoardsRepo {
  if (typeof (repo as Partial<ColumnTemplateBoardsRepo>).listSectionPresetBoards !== "function") {
    throw new Error("PRESET_REPO_UNAVAILABLE");
  }
  return repo as ColumnTemplateBoardsRepo;
}

function canWriteTemplate(ctx: Ctx, record: ColumnTemplateRecord): boolean {
  return record.ownerId === ctx.user.id || ctx.role === "owner" || ctx.role === "admin";
}

async function requirePresetPermission(ctx: Ctx) {
  const guard = await loadPermGuard(ctx.org.id, "structure.preset_edit");
  if (guard.kind !== "allowed") throw new Error("DENIED");
}

async function deps() {
  const runtime = await createRequestBoards();
  return { ...runtime, templates: new ColumnTemplateRepo(asRepo(runtime.repo)) };
}

async function listSafe(ctx: Ctx, templates: ColumnTemplateRepo) {
  return templates.list(ctx);
}

function failure(error: unknown): string {
  if (error instanceof Error && error.message === "ORG_PUBLISH_DENIED") return "회사 공개 템플릿은 오너 또는 관리자만 저장할 수 있습니다.";
  if (error instanceof Error && error.message === "TYPE_MISMATCH") return "타입이 다른 기존 컬럼에는 설정을 적용할 수 없습니다. 새 컬럼으로 적용해 주세요.";
  if (error instanceof Error && error.message === "DENIED") return "이 템플릿을 변경할 권한이 없습니다.";
  console.error("[BBE-180] 컬럼 템플릿 처리 실패", error);
  return "컬럼 템플릿을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

export async function loadColumnTemplatesAction(boardId: string): Promise<ColumnTemplateActionState> {
  try {
    const ctx = await getSession();
    await requirePresetPermission(ctx);
    const { service, templates } = await deps();
    await service.getBoardDetail(ctx, boardId);
    return { ok: true, message: null, templates: await listSafe(ctx, templates) };
  } catch (error) {
    return { ok: false, message: failure(error), templates: [] };
  }
}

export async function mutateColumnTemplateAction(
  _previous: ColumnTemplateActionState,
  formData: FormData,
): Promise<ColumnTemplateActionState> {
  const ctx = await getSession();
  const boardId = required(formData, "boardId");
  try {
    await requirePresetPermission(ctx);
    const operation = required(formData, "operation");
    const requestId = required(formData, "requestId");
    const { client, repo, service, templates } = await deps();
    const detail = await service.getBoardDetail(ctx, boardId);

    if (operation === "save") {
      const columnId = required(formData, "columnId");
      const column = detail.columns.find((candidate) => candidate.id === columnId);
      if (!column) throw new Error("INVALID_REQUEST");
      const scope = required(formData, "scope") as ColumnTemplateScope;
      // 같은 폼 요청은 같은 논리 템플릿 key를 사용해 네트워크 재시도에도 버전 1이 하나다.
      const templateKey = requestId;
      await templates.createVersion(ctx, {
        templateKey, name: required(formData, "name"), scope, requestId, column, version: 1,
      });
    } else if (operation === "update" || operation === "rollback") {
      const selected = await templates.get(ctx, required(formData, "templateId"));
      if (!selected || !canWriteTemplate(ctx, selected)) throw new Error("DENIED");
      const latest = await templates.latest(ctx, selected.templateKey);
      if (!latest) throw new Error("INVALID_REQUEST");
      const sourceColumn = operation === "rollback"
        ? selected.column
        : detail.columns.find((column) => column.id === required(formData, "columnId"));
      if (!sourceColumn) throw new Error("INVALID_REQUEST");
      await templates.createVersion(ctx, {
        templateKey: selected.templateKey,
        name: operation === "update" ? required(formData, "name") : latest.name,
        scope: latest.scope,
        requestId,
        column: sourceColumn,
        version: latest.version + 1,
      });
    } else if (operation === "delete") {
      const selected = await templates.get(ctx, required(formData, "templateId"));
      if (!selected || !canWriteTemplate(ctx, selected)) throw new Error("DENIED");
      await templates.deleteAll(ctx, selected.templateKey);
    } else if (operation === "apply") {
      const selected = await templates.get(ctx, required(formData, "templateId"));
      if (!selected) throw new Error("DENIED");
      const targetId = String(formData.get("targetColumnId") ?? "").trim();
      const target = targetId ? detail.columns.find((column) => column.id === targetId) : undefined;
      if (target && target.type !== selected.column.type) throw new Error("TYPE_MISMATCH");
      const rpc = await requireRequestClient(client, "컬럼 템플릿 적용").rpc("execute_board_column_command", {
        p_org_id: ctx.org.id,
        p_board_id: boardId,
        p_column_id: target?.id ?? null,
        p_operation: target ? "settings" : "create_at",
        p_request_id: requestId,
        p_payload: columnTemplatePayload(selected),
      });
      if (rpc.error) throw rpc.error;
      const result = rpc.data as { columnId?: string } | null;
      const appliedId = target?.id ?? result?.columnId;
      if (appliedId) {
        await repo.updateColumn(ctx, appliedId, {
          options: selected.column.options_jsonb?.options ?? [],
          width: selected.column.width,
          moveRule: selected.column.move_rule_jsonb,
          readOnly: selected.column.is_readonly,
          rightPinned: selected.column.rightPinned,
        });
      }
    } else {
      throw new Error("INVALID_REQUEST");
    }

    revalidatePath(`/boards/${boardId}`);
    return { ok: true, message: "컬럼 템플릿 변경을 저장했습니다.", templates: await listSafe(ctx, templates) };
  } catch (error) {
    const { templates } = await deps();
    return { ok: false, message: failure(error), templates: await listSafe(ctx, templates) };
  }
}
