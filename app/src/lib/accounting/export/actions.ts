"use server";

import { getSession } from "@/lib/auth/session";
import { loadPermGuard } from "@/lib/perm/guard";
import { recordRiskyAction } from "@/lib/perm/server";

export type LedgerExportAuthorization = { ok: true } | { ok: false; message: string };

/** Authorize and audit before any customer ledger CSV is created in the browser. */
export async function authorizeLedgerCsvExport(): Promise<LedgerExportAuthorization> {
  const ctx = await getSession();
  const permission = await loadPermGuard(ctx.org.id, "danger.csv_export");
  if (permission.kind !== "allowed") {
    return { ok: false, message: permission.reason === "permission" ? "CSV를 내보낼 권한이 없어요." : "권한을 확인하지 못했어요." };
  }
  const audit = await recordRiskyAction(ctx.org.id, "danger.csv_export", { operation: "ledger_csv_export" });
  return audit.ok ? { ok: true } : { ok: false, message: "내보내기 기록을 남기지 못해 파일을 만들지 않았어요." };
}
