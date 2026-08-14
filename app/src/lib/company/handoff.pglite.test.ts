import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("BBE-125 company handoff migration", () => {
  it("passes atomic upsert, duplicate review, tenant and privilege PGlite tests", () => {
    const root = join(__dirname, "..", "..", "..", "..");
    const testFile = join(root, "supabase", "tests", "company_master_identity.pglite.test.mjs");
    expect(() => execFileSync(process.execPath, ["--test", testFile], {
      cwd: root,
      env: { ...process.env, PGLITE_MODULE_ROOT: root },
      stdio: "pipe",
      timeout: 40_000,
    })).not.toThrow();
  }, 45_000);
});
