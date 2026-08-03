"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { getNewcustSource } from "@/lib/newcust/service";
import { FIELD_TYPES, type FieldType } from "@/lib/types";
import type { BoardColumn } from "@/lib/boards/types";
import { parseNewcustCsv } from "@/lib/newcust/csv";

export type NewcustActionState = { ok: boolean; message: string; itemIds?: string[] };
const ok = (message: string): NewcustActionState => ({ ok: true, message });
const bad = (error: unknown): NewcustActionState => ({ ok: false, message: error instanceof Error ? error.message : "저장하지 못했습니다." });
const value = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

async function run(task: (ctx: Awaited<ReturnType<typeof getSession>>, source: Awaited<ReturnType<typeof getNewcustSource>>) => Promise<string>): Promise<NewcustActionState> {
  try {
    const [ctx, source] = await Promise.all([getSession(), getNewcustSource()]);
    const message = await task(ctx, source);
    revalidatePath("/newcust");
    return ok(message);
  } catch (error) { return bad(error); }
}

function requireStructureAdmin(ctx: Awaited<ReturnType<typeof getSession>>): void {
  if (ctx.role !== "owner" && ctx.role !== "admin") throw new Error("보드 구조 변경은 소유자 또는 관리자만 할 수 있습니다.");
}

export async function createNewcustItem(_: NewcustActionState, form: FormData) {
  return run(async (ctx, source) => {
    const title = value(form, "title");
    if (!title) throw new Error("업체명을 입력해 주세요.");
    await source.createItem(ctx, value(form, "boardId"), value(form, "groupId"), title);
    return "업체를 추가했습니다.";
  });
}

export async function updateNewcustCell(_: NewcustActionState, form: FormData) {
  return run(async (ctx, source) => {
    const raw = value(form, "value");
    await source.setCell(ctx, value(form, "boardId"), value(form, "itemId"), value(form, "key"), raw);
    return "변경사항을 저장했습니다.";
  });
}

export async function updateNewcustItem(_: NewcustActionState, form: FormData) {
  return run(async (ctx, source) => {
    const field = value(form, "field");
    const raw = value(form, "value");
    if (field !== "title" && field !== "assigned_to") throw new Error("수정할 필드를 확인해 주세요.");
    if (field === "title" && !raw) throw new Error("업체명은 비워둘 수 없습니다.");
    await source.updateItem(ctx, value(form, "boardId"), value(form, "itemId"), field === "title" ? { title: raw } : { assigned_to: raw || null });
    return "업체 정보를 저장했습니다.";
  });
}

export async function addNewcustColumn(_: NewcustActionState, form: FormData) {
  return run(async (ctx, source) => {
    requireStructureAdmin(ctx);
    const type = value(form, "type") as FieldType;
    if (!FIELD_TYPES.includes(type)) throw new Error("컬럼 유형을 확인해 주세요.");
    const label = value(form, "label");
    if (!label) throw new Error("컬럼 이름을 입력해 주세요.");
    await source.addColumn(ctx, value(form, "boardId"), { label, type });
    return "컬럼을 추가했습니다.";
  });
}

export async function renameNewcustColumn(_: NewcustActionState, form: FormData) {
  return run(async (ctx, source) => { requireStructureAdmin(ctx); await source.renameColumn(ctx, value(form, "boardId"), value(form, "columnId"), value(form, "label")); return "컬럼 이름을 변경했습니다."; });
}

export async function deleteNewcustColumn(_: NewcustActionState, form: FormData) {
  return run(async (ctx, source) => { requireStructureAdmin(ctx); await source.deleteColumn(ctx, value(form, "boardId"), { id: value(form, "columnId"), key: value(form, "key") } as BoardColumn); return "컬럼을 삭제했습니다."; });
}

export async function addNewcustGroup(_: NewcustActionState, form: FormData) {
  return run(async (ctx, source) => { requireStructureAdmin(ctx); await source.addGroup(ctx, value(form, "boardId"), value(form, "name") || "새 그룹"); return "그룹을 추가했습니다."; });
}

export async function saveNewcustView(_: NewcustActionState, form: FormData) {
  return run(async (ctx, source) => {
    const visibleColumns = JSON.parse(value(form, "visibleColumns")) as unknown;
    if (!Array.isArray(visibleColumns) || visibleColumns.some((id) => typeof id !== "string")) throw new Error("Invalid visible columns");
    await source.createView(ctx, value(form, "boardId"), { name: value(form, "name") || "New view", kind: value(form, "kind"), sort: value(form, "sort"), groupBy: value(form, "groupBy"), visibleColumns });
    return "View saved";
  });
}

export async function importNewcustCsv(_: NewcustActionState, form: FormData) {
  try {
    const [ctx, source] = await Promise.all([getSession(), getNewcustSource()]);
    const rows = parseNewcustCsv(value(form, "csv"));
    if (rows.length < 2) throw new Error("머리글과 업체 행이 있는 CSV를 붙여 넣어 주세요.");
    if (rows.length > 500) throw new Error("한 번에 최대 499개 업체를 가져올 수 있습니다.");
    const titles = rows.slice(1).map((row) => row[0]?.trim()).filter((title): title is string => Boolean(title));
    const itemIds = await source.importItems(ctx, value(form, "boardId"), value(form, "groupId"), titles);
    revalidatePath("/newcust");
    return { ok: true, message: `${itemIds.length}개 업체를 가져왔습니다.`, itemIds };
  } catch (error) { return bad(error); }
}

export async function undoNewcustCsv(_: NewcustActionState, form: FormData) {
  return run(async (ctx, source) => {
    const itemIds = value(form, "itemIds").split(",").filter(Boolean);
    await source.deleteImportedItems(ctx, value(form, "boardId"), itemIds);
    return "마지막 CSV 가져오기를 되돌렸습니다.";
  });
}
