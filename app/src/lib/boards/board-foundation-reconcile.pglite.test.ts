import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("BBE-146 board foundation reconciliation", () => {
  it("passes the PGlite partial-drift and rerun suite", () => {
    const root = join(__dirname, "..", "..", "..", "..");
    const testFile = join(root, "supabase", "tests", "board_foundation_reconcile.pglite.test.mjs");
    expect(() => execFileSync(process.execPath, ["--test", testFile], {
      cwd: root,
      env: { ...process.env, PGLITE_MODULE_ROOT: root },
      stdio: "pipe",
    })).not.toThrow();
  }, 15_000);
});
