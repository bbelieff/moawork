import { getSession } from "@/lib/auth/session";
import { loadNewcustBoard } from "@/lib/newcust/service";
import { NewcustBoard } from "@/components/newcust/NewcustBoard";
import { getSupabaseClient } from "@/lib/repo/supabase/client";
import { NewcustLegacyMigrationSource } from "@/lib/repo/supabase/newcustLegacyMigrationSource";
import { NewcustMigrationGate } from "@/components/newcust/NewcustMigrationGate";

/** 신규고객 보드 (T02 · B2) — 002 시드의 신규고객(kind=marketing) 단계. */
export default async function NewCustomerPage() {
  const ctx = await getSession();
  const db = getSupabaseClient();
  if (db && !(await new NewcustLegacyMigrationSource(db).uiReady(ctx.org.id))) {
    return <NewcustMigrationGate canApply={ctx.role === "owner" || ctx.role === "admin"} />;
  }
  const snapshot = await loadNewcustBoard(ctx);
  return <NewcustBoard snapshot={snapshot} currentUserId={ctx.user.id} currentUserName={ctx.user.name ?? ctx.user.email ?? "나"} canManageStructure={ctx.role === "owner" || ctx.role === "admin" || snapshot.board.created_by === ctx.user.id} />;
}
