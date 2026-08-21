"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { WorkManagementSource } from "@/lib/repo/supabase/workManagementSource";
import type { WorkViewKind } from "@/lib/work-management/contracts";
import { parseWorkCommand } from "@/lib/work-management/rpc-contract";
import { canUseLocalSeedFallback } from "@/lib/supabase/local-fallback";
import { LocalWorkManagementSource } from "@/lib/work-management/local-source";

export type WorkActionState = { ok: boolean; message: string };
const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const number = (form: FormData, key: string) => { const value = Number(text(form, key)); if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${key}.`); return value; };

export async function mutateWork(_: WorkActionState, form: FormData): Promise<WorkActionState> {
  try {
    const ctx = await getSession(); const operation = text(form, "operation"); const itemId = text(form, "itemId") || undefined; const value = text(form, "value");
    const common = { operation, orgId: ctx.org.id, boardId: text(form, "boardId"), ...(itemId ? { itemId } : {}), expectedVersion: number(form, "expectedVersion"), requestId: randomUUID() };
    let payload: Record<string, unknown>;
    switch (operation) {
      case "set_field": payload = { field: text(form, "field"), value: value || null }; break;
      case "set_due_date": payload = { due_date: value || null }; break;
      case "append_update": payload = { body: value }; break;
      case "create_group": payload = { name: value }; break;
      case "rename_group": payload = { group_id: text(form, "groupId"), name: value }; break;
      case "delete_group": payload = { group_id: text(form, "groupId") }; break;
      case "reorder_group": payload = { group_id: text(form, "groupId"), position: number(form, "position") }; break;
      case "create_column": payload = { name: value, kind: text(form, "kind") || "text" }; break;
      case "rename_column": payload = { column_key: text(form, "columnKey"), name: value }; break;
      case "delete_column": payload = { column_key: text(form, "columnKey") }; break;
      case "reorder_column": payload = { column_key: text(form, "columnKey"), position: number(form, "position") }; break;
      case "create_item": payload = { name: value, ...(text(form, "groupId") ? { group_id: text(form, "groupId") } : {}) }; break;
      case "delete_item": payload = {}; break;
      case "move_item": payload = { group_id: text(form, "groupId"), ...(text(form, "position") ? { position: number(form, "position") } : {}) }; break;
      case "save_personal_view": payload = { name: text(form, "viewName"), kind: text(form, "viewKind") as WorkViewKind, predicate: JSON.parse(text(form, "predicate")), shared: false }; break;
      default: throw new Error("Unsupported work command.");
    }
    const command = parseWorkCommand({ ...common, payload });
    const source = canUseLocalSeedFallback()
      ? new LocalWorkManagementSource(ctx)
      : new WorkManagementSource(await createClient());
    const result = await source.execute(command);
    revalidatePath("/work");
    return { ok: true, message: result.replayed ? "Already applied." : "Saved." };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Unable to save work." }; }
}
