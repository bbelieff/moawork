import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("BBE-176 durable column date schedule database contract", () => {
  it("runs the PGlite permission, replay, audit, schedule, and duplicate suite from the normal app gate", () => {
    const repoRoot = join(__dirname, "..", "..", "..", "..");
    const testFile = join(repoRoot, "supabase", "tests", "bbe176_column_date_schedule.pglite.test.mjs");
    const output = execFileSync(process.execPath, ["--test", "--test-reporter=tap", testFile], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, PGLITE_MODULE_ROOT: repoRoot },
    });
    expect(output).toMatch(/^# pass 8$/mu);
    expect(output).toMatch(/^# fail 0$/mu);
  }, 120_000);
});
