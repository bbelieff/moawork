"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { loadPermGuard } from "@/lib/perm/guard";
import { recordRiskyAction } from "@/lib/perm/server";
import { BoardsService } from "@/lib/boards";
import { SupabaseBoardsRepo } from "@/lib/repo/supabase/boardsRepo";
import { createClient } from "@/lib/supabase/server";
import { SectionPresetRepo, snapshotSectionPreset } from "@/lib/presets/section-presets";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function requireAllowed(orgId: string, key: string) {
  const result = await loadPermGuard(orgId, key);
  if (result.kind !== "allowed") throw new Error("이 구조를 바꿀 권한이 없어요.");
}

async function requireDeleteAllowed(orgId: string) {
  await requireAllowed(orgId, "danger.bulk_edit_delete");
  const audit = await recordRiskyAction(orgId, "danger.bulk_edit_delete", {
    operation: "danger.bulk_edit_delete",
  });
  if (!audit.ok) throw new Error("위험 작업 기록에 실패해 삭제하지 않았어요.");
}

async function deps() {
  const ctx = await getSession();
  const client = await createClient();
  const repo = new SupabaseBoardsRepo(client);
  const boards = new BoardsService(repo);
  return { ctx, boards, presets: new SectionPresetRepo(repo) };
}

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function createTabAction(formData: FormData) {
  const { ctx, boards } = await deps();
  await requireAllowed(ctx.org.id, "structure.tab_manage");
  const name = text(formData, "name");
  if (!name) throw new Error("탭 이름을 입력해 주세요.");
  // 화면을 그릴 때 받은 요청 열쇠 — 두 번 눌러도 탭은 하나만 생긴다.
  const requestId = text(formData, "requestId");
  await boards.createBoard(
    ctx,
    { name, description: "회사가 만든 업무 탭" },
    REQUEST_ID.test(requestId) ? requestId : crypto.randomUUID(),
  );
  revalidatePath("/presets");
}

export async function renameTabAction(formData: FormData) {
  const { ctx, boards } = await deps();
  await requireAllowed(ctx.org.id, "structure.tab_manage");
  await boards.updateBoard(ctx, text(formData, "boardId"), { name: text(formData, "name") });
  revalidatePath("/presets");
}

/** #849 지우면 휴지통으로 간다(7일 안에 탭 관리 › 휴지통에서 복구). */
export async function deleteTabAction(formData: FormData) {
  const { ctx, boards } = await deps();
  await requireAllowed(ctx.org.id, "structure.tab_manage");
  await requireDeleteAllowed(ctx.org.id);
  await boards.deleteBoard(ctx, text(formData, "boardId"));
  revalidatePath("/presets");
  revalidatePath("/boards");
  revalidatePath("/settings/workspace-builder");
}

export async function saveSectionPresetAction(formData: FormData) {
  const { ctx, boards, presets } = await deps();
  await requireAllowed(ctx.org.id, "structure.preset_edit");
  const detail = await boards.getBoardDetail(ctx, text(formData, "boardId"));
  const input = snapshotSectionPreset(text(formData, "name"), detail.groups, detail.columns);
  if (!input.name) throw new Error("프리셋 이름을 입력해 주세요.");
  await presets.create(ctx, input);
  revalidatePath("/presets");
}

export async function applySectionPresetAction(formData: FormData) {
  const { ctx, boards, presets } = await deps();
  await requireAllowed(ctx.org.id, "structure.preset_edit");
  await requireAllowed(ctx.org.id, "structure.column_manage");
  const boardId = text(formData, "boardId");
  const preset = await presets.get(ctx, text(formData, "presetId"));
  if (!preset) throw new Error("프리셋을 찾을 수 없어요.");
  const target = await boards.getBoardDetail(ctx, boardId);
  const existingKeys = new Set(target.columns.map((column) => column.key));
  for (const group of preset.groups) await boards.addGroup(ctx, boardId, group);
  for (const column of preset.columns) {
    if (existingKeys.has(column.key)) continue;
    await boards.addColumn(ctx, boardId, {
      key: column.key,
      label: column.label,
      type: column.type,
      source: column.source,
      rightPinned: column.rightPinned,
      options: column.options,
      width: column.width,
      moveRule: column.move_rule_jsonb,
      readOnly: column.is_readonly,
    });
  }
  revalidatePath("/presets");
  revalidatePath(`/boards/${boardId}`);
}

export async function deleteSectionPresetAction(formData: FormData) {
  const { ctx, presets } = await deps();
  await requireAllowed(ctx.org.id, "structure.preset_edit");
  await presets.delete(ctx, text(formData, "presetId"));
  revalidatePath("/presets");
}
