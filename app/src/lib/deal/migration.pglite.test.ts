import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("BBE-16 deal collaboration migration", () => {
  it("atomically rejects stale and non-author comment edits", () => {
    const root = join(__dirname, "..", "..", "..", "..");
    const testFile = join(root, "supabase", "tests", "deal_collab_notify.pglite.test.mjs");
    expect(() => execFileSync(process.execPath, ["--test", testFile], {
      cwd: root,
      env: { ...process.env, PGLITE_MODULE_ROOT: root },
      stdio: "pipe",
      timeout: 20_000,
    })).not.toThrow();
  }, 25_000);
});
