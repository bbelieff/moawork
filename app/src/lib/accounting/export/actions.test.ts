import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ guard: vi.fn(), risky: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn(async () => ({ org: { id: "org-a" } })) }));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: mocks.guard }));
vi.mock("@/lib/perm/server", () => ({ recordRiskyAction: mocks.risky }));

import { authorizeLedgerCsvExport } from "./actions";

describe("ledger CSV permission boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("denies without writing an audit when permission is denied", async () => {
    mocks.guard.mockResolvedValue({ kind: "denied", reason: "permission" });
    expect((await authorizeLedgerCsvExport()).ok).toBe(false);
    expect(mocks.risky).not.toHaveBeenCalled();
  });

  it("fails closed when the mandatory audit cannot be written", async () => {
    mocks.guard.mockResolvedValue({ kind: "allowed" });
    mocks.risky.mockResolvedValue({ ok: false });
    expect((await authorizeLedgerCsvExport()).ok).toBe(false);
  });

  it("authorizes only after the risk audit succeeds", async () => {
    mocks.guard.mockResolvedValue({ kind: "allowed" });
    mocks.risky.mockResolvedValue({ ok: true });
    expect(await authorizeLedgerCsvExport()).toEqual({ ok: true });
    expect(mocks.risky).toHaveBeenCalledWith("org-a", "danger.csv_export", { operation: "ledger_csv_export" });
  });
});
