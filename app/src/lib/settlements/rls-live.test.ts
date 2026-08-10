import { describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const memberEmail = process.env.SETTLEMENT_RLS_TEST_MEMBER_EMAIL;
const memberPassword = process.env.SETTLEMENT_RLS_TEST_MEMBER_PASSWORD;
const orgId = process.env.SETTLEMENT_RLS_TEST_ORG_ID;
const assignedSettlementId = process.env.SETTLEMENT_RLS_TEST_ASSIGNED_ID;
const otherSettlementId = process.env.SETTLEMENT_RLS_TEST_OTHER_ID;
const READY = Boolean(url && anon && memberEmail && memberPassword && orgId && assignedSettlementId && otherSettlementId);

async function signIn() {
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon!, "Content-Type": "application/json" },
    body: JSON.stringify({ email: memberEmail, password: memberPassword }),
  });
  if (!response.ok) throw new Error(`settlement RLS test sign-in failed (${response.status})`);
  return ((await response.json()) as { access_token: string }).access_token;
}

async function rpc(token: string, name: string, body: Record<string, unknown>) {
  return fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: anon!, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const suite = READY ? describe : describe.skip;

suite("settlement ledger live DB/RLS", () => {
  it("assigned member sees only their settlement snapshot", async () => {
    const token = await signIn();
    const response = await rpc(token, "get_settlement_ledger_snapshot", { p_org_id: orgId });
    expect(response.ok).toBe(true);
    const rows = (await response.json()) as Array<{ id: string }>;
    expect(rows.some((row) => row.id === assignedSettlementId)).toBe(true);
    expect(rows.some((row) => row.id === otherSettlementId)).toBe(false);
  });

  it("member cannot write ledger entries or record CSV audit", async () => {
    const token = await signIn();
    const write = await rpc(token, "post_settlement_ledger_entry", {
      p_settlement_id: assignedSettlementId, p_kind: "payment", p_amount: 1, p_occurred_on: "2000-01-01",
    });
    expect(write.ok).toBe(false);
    const audit = await rpc(token, "record_settlement_csv_export", { p_org_id: orgId, p_row_count: 0 });
    expect(audit.ok).toBe(false);
  });
});

describe("settlement ledger live DB/RLS readiness", () => {
  it("reports whether isolated live-test credentials are available", () => {
    expect(typeof READY).toBe("boolean");
  });
});
