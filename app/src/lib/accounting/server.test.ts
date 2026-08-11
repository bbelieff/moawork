import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DealLedgerReadError, loadDealLedger } from "./server";

function row(patch: Record<string, unknown> = {}) {
  return {
    id: "entry-1",
    deal_id: "deal-1",
    kind: "fee",
    amount: "1000",
    received_amount: "400",
    occurred_on: "2026-08-12",
    paid_on: null,
    attribution_month: "2026-08-01",
    ...patch,
  };
}

function client(options: {
  rows?: unknown[] | null;
  rowsError?: unknown;
  summary?: unknown[] | null;
  summaryError?: unknown;
  access?: boolean;
  accessError?: unknown;
} = {}) {
  const order = vi.fn().mockResolvedValue({
    data: options.rows ?? [],
    error: options.rowsError ?? null,
  });
  const eq = vi.fn().mockReturnValue({ order });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  const rpc = vi.fn().mockImplementation(async (name: string) => {
    if (name === "can_access_deal_ledger") {
      return { data: options.access ?? true, error: options.accessError ?? null };
    }
    return {
      data: options.summary ?? [{ deal_id: "deal-1", fee_total: "0" }],
      error: options.summaryError ?? null,
    };
  });
  return { client: { from, rpc } as unknown as SupabaseClient, from, select, eq, rpc };
}

describe("deal ledger server read model", () => {
  it("reads an empty RLS-scoped ledger and its summary through the session client", async () => {
    const mock = client();

    await expect(loadDealLedger("deal-1", async () => mock.client)).resolves.toEqual({
      entries: [],
      expectedFeeTotal: 0,
    });
    expect(mock.from).toHaveBeenCalledWith("deal_ledger_entries");
    expect(mock.eq).toHaveBeenCalledWith("deal_id", "deal-1");
    expect(mock.rpc).toHaveBeenCalledWith("can_access_deal_ledger", { p_deal_id: "deal-1" });
    expect(mock.rpc).toHaveBeenCalledWith("deal_ledger_summary", { p_deal_id: "deal-1" });
  });

  it("maps multiple rows including a partial payment without losing integer precision", async () => {
    const mock = client({
      rows: [
        row(),
        row({
          id: "entry-2",
          kind: "contract_deposit",
          amount: 2500,
          received_amount: 2500,
          paid_on: "2026-08-12",
        }),
      ],
      summary: [{ deal_id: "deal-1", fee_total: "1000" }],
    });

    const result = await loadDealLedger("deal-1", async () => mock.client);

    expect(result.expectedFeeTotal).toBe(1000);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({ amount: 1000, receivedAmount: 400, paidOn: null });
    expect(result.entries[1]).toMatchObject({ kind: "contract_deposit", receivedAmount: 2500 });
  });

  it.each([
    { amount: "-1" },
    { amount: "1.5" },
    { amount: "9007199254740992" },
    { amount: "100", received_amount: "101" },
  ])("rejects unsafe or invalid money instead of coercing it", async (patch) => {
    const mock = client({ rows: [row(patch)] });
    await expect(loadDealLedger("deal-1", async () => mock.client)).rejects.toBeInstanceOf(
      DealLedgerReadError,
    );
  });

  it("does not disguise a table or RLS failure as an empty ledger", async () => {
    const mock = client({ rowsError: { code: "42501" } });
    await expect(loadDealLedger("deal-1", async () => mock.client)).rejects.toBeInstanceOf(
      DealLedgerReadError,
    );
  });

  it("does not disguise an RLS-hidden deal as an empty ledger", async () => {
    const mock = client({ access: false });
    await expect(loadDealLedger("deal-1", async () => mock.client)).rejects.toBeInstanceOf(
      DealLedgerReadError,
    );
    expect(mock.from).not.toHaveBeenCalled();
  });

  it("fails closed when the explicit access check errors", async () => {
    const mock = client({ accessError: { code: "42501" } });
    await expect(loadDealLedger("deal-1", async () => mock.client)).rejects.toBeInstanceOf(
      DealLedgerReadError,
    );
    expect(mock.from).not.toHaveBeenCalled();
  });

  it("does not disguise an RPC failure as a zero summary", async () => {
    const mock = client({ rows: [row()], summaryError: { code: "42501" } });
    await expect(loadDealLedger("deal-1", async () => mock.client)).rejects.toBeInstanceOf(
      DealLedgerReadError,
    );
  });
});
