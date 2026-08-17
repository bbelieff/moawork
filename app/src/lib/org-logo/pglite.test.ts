import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// 회사 로고(BBE-199)의 DB·Storage 계약은 «실제 Postgres» 로만 증명된다.
// 헬퍼 함수를 부르는 단위 테스트는 RLS 를 지나가지 않으므로 근거가 되지 못한다.
describe("org logo executable database contract", () => {
  it("runs the PGlite org-logo RLS suite from the normal app test gate", () => {
    const repoRoot = join(__dirname, "..", "..", "..", "..");
    const testFile = join(repoRoot, "supabase", "tests", "bbe199_org_logo.pglite.test.mjs");
    // TAP 리포터를 쓰고 «정확한 숫자» 로 단언한다.
    // toContain("pass 14") 같은 부분문자열은 "pass 140" 에도 매치해서 개수를 보장하지 못한다.
    const output = execFileSync(process.execPath, ["--test", "--test-reporter=tap", testFile], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, PGLITE_MODULE_ROOT: repoRoot },
    });
    expect(output).toMatch(/^# pass 15$/mu);
    expect(output).toMatch(/^# fail 0$/mu);
  }, 120_000);
});
