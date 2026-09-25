import { getSession } from "@/lib/auth/session";
import { loadPermGuard } from "@/lib/perm/guard";
import { recordRiskyAction } from "@/lib/perm/server";
import { userFacingMessage } from "@/lib/boards/boardActionFlash";

/** Batch actions need both the underlying row permission and the explicit bulk permission. */
export async function requireBulkWritePermission(workScope: "work.item_upsert" | "work.item_delete") {
  try {
    const ctx = await getSession();
    const permissions = await Promise.all([
      loadPermGuard(ctx.org.id, workScope),
      loadPermGuard(ctx.org.id, "danger.bulk_edit_delete"),
    ]);
    const denied = permissions.find((permission) => permission.kind !== "allowed");
    if (denied?.kind === "denied") {
      return { ok: false as const, message: denied.reason === "permission"
        ? "이 일괄 작업을 실행할 권한이 없어요." : "권한을 확인하지 못했어요." };
    }
    const audit = await recordRiskyAction(ctx.org.id, "danger.bulk_edit_delete", { operation: "board_bulk_write", permission: workScope });
    if (!audit.ok) return { ok: false as const, message: "일괄 작업 기록을 남기지 못해 실행하지 않았어요." };
    return { ok: true as const, ctx };
  } catch (error) {
    return { ok: false as const, message: userFacingMessage(error) };
  }
}
