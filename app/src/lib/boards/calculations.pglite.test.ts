import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("BBE-153 persisted calculations", () => {
  it("passes the PGlite recalculation, read-only, failure, and 8,400-record suite", () => {
    const root = join(__dirname, "..", "..", "..", "..");
    const testFile = join(root, "supabase", "tests", "board_calculated_values.pglite.test.mjs");
    expect(() => execFileSync(process.execPath, ["--test", testFile], {
      cwd: root,
      env: { ...process.env, PGLITE_MODULE_ROOT: root },
      stdio: "pipe",
      timeout: 40_000,
    })).not.toThrow();
  }, 45_000);
});
