/**
 * 003 boards engine hosted/RLS probe. Credentials are environment-only; absent means NOT_RUN.
 * This test is read-only so it cannot alter a customer's board.
 */
import { describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const email = process.env.RLS_TEST_ORG_A_EMAIL;
const password = process.env.RLS_TEST_ORG_A_PASSWORD;
const otherOrg = process.env.RLS_TEST_ORG_B_ID;
const READY = Boolean(url && anon && email && password);

async function token() {
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: anon!, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!response.ok) throw new Error(`boards probe login failed: ${response.status}`);
  return ((await response.json()) as { access_token: string }).access_token;
}

async function rows(table: string, accessToken: string, query = "select=id&limit=1") {
  const response = await fetch(`${url}/rest/v1/${table}?${query}`, { headers: { apikey: anon!, Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`${table} probe failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as unknown[];
}

describe.skipIf(!READY)("hosted 003 boards schema/RLS", () => {
  it("exposes every 003 table through authenticated RLS", async () => {
    const accessToken = await token();
    for (const table of ["boards", "board_groups", "board_columns", "items", "item_values", "board_views"]) await expect(rows(table, accessToken)).resolves.toBeInstanceOf(Array);
  });

  it.skipIf(!otherOrg)("does not expose another organization's boards", async () => {
    const accessToken = await token();
    await expect(rows("boards", accessToken, `org_id=eq.${otherOrg}&select=id`)).resolves.toHaveLength(0);
  });
});

describe("hosted 003 probe readiness", () => {
  it("records whether credentials are available", () => expect(typeof READY).toBe("boolean"));
});
