import type { QueryPort } from "./store.js";

export interface OutboxOperationalCheck {
  identity: string;
  rowSecurityOn: boolean;
  schemaReady: boolean;
  canClaim: boolean;
  pendingRows: number;
}

/** Read-only production readiness probe. It never claims a row or calls a provider. */
export async function checkOutboxOperationalReadiness(db: QueryPort): Promise<OutboxOperationalCheck> {
  const result = await db.query<{
    identity: string; row_security: string; schema_ready: boolean; can_claim: boolean; pending_rows: string;
  }>(`
    select current_user as identity,
      current_setting('row_security') as row_security,
      to_regclass('public.message_outbox') is not null
        and to_regprocedure('public.claim_message_outbox(integer,text,integer)') is not null as schema_ready,
      has_function_privilege(current_user, 'public.claim_message_outbox(integer,text,integer)', 'execute') as can_claim,
      case when to_regclass('public.message_outbox') is null then 0
        else (select count(*) from public.message_outbox where status in ('pending','retry','leased')) end::text as pending_rows
  `);
  const row = result.rows[0];
  if (!row) throw new Error("outbox readiness query returned no result");
  const check = {
    identity: row.identity,
    rowSecurityOn: row.row_security === "on",
    schemaReady: row.schema_ready,
    canClaim: row.can_claim,
    pendingRows: Number(row.pending_rows),
  };
  if (!check.rowSecurityOn || !check.schemaReady || !check.canClaim || check.identity !== "moawork_outbox_worker") {
    throw new Error("outbox constrained identity is not ready");
  }
  return check;
}
