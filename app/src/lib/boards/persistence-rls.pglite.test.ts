import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("BBE-159 boards persistence and RLS", () => {
  it("passes the PGlite restart and tenant-isolation suite", () => {
    const root = join(__dirname, "..", "..", "..", "..");
    const testFile = join(root, "supabase", "tests", "boards_persistence_rls.pglite.test.mjs");
    expect(() => execFileSync(process.execPath, ["--test", testFile], {
      cwd: root,
      env: { ...process.env, PGLITE_MODULE_ROOT: root },
      stdio: "pipe",
    })).not.toThrow();
  }, 15_000);
});
