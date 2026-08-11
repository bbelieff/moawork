import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("permission matrix executable database contract", () => {
  it("runs the PGlite tenant/RLS suite from the normal app test gate", () => {
    const testFile = join(__dirname, "..", "..", "..", "..", "supabase", "tests", "permission_role_matrix.pglite.test.mjs");
    const output = execFileSync(process.execPath, ["--test", testFile], {
      cwd: join(__dirname, "..", "..", "..", ".."),
      encoding: "utf8",
    });
    expect(output).toContain("pass 1");
    expect(output).toContain("fail 0");
  }, 15_000);
});
