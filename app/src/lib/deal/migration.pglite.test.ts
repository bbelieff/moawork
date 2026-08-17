import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("BBE-16 deal collaboration migration", () => {
  it("atomically rejects stale and non-author comment edits", async () => {
    const root = join(__dirname, "..", "..", "..", "..");
    const testFile = join(root, "supabase", "tests", "deal_collab_notify.pglite.test.mjs");
    await expect(execFileAsync(process.execPath, ["--test", testFile], {
      cwd: root,
      env: { ...process.env, PGLITE_MODULE_ROOT: root },
      timeout: 60_000,
    })).resolves.toBeDefined();
  }, 65_000);
});
