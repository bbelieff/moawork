/**
 * 2026-10-06 운영 사고(#845 배포 직후) — 진입 repair 는 «늘 새로 읽는» 클라이언트를 써야 한다.
 *
 * Next 서버 렌더는 한 요청 안의 같은 GET fetch 를 기억해 다시 쓴다. 진입 repair 는 드리프트를 읽고
 * (리스 밖) → 리스를 잡은 뒤 다시 읽어 고친다. 기본 클라이언트로는 두 번째 읽기가 첫 번째 결과를
 * 돌려받아, 같은 요청의 레이아웃 부트스트랩이 막 만든 그룹을 못 보고 «또» 만들었다
 * (테스트 회사: 새 그룹 3개가 같은 sort_order 로 두 벌, 진행현황 선택지 23개).
 * 레이아웃 부트스트랩은 BBE-263 에서 이미 noStore 로 고쳤고, 탭 진입 repair 가 빠져 있었다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP = path.resolve(__dirname, "../../app/(app)");
const ENTRY_PAGES = [
  "(tabs)/work/page.tsx",
  "(tabs)/newcust/page.tsx",
  "(tabs)/contract/page.tsx",
  "(tabs)/consult-remote/page.tsx",
  "(tabs)/consult-inperson/page.tsx",
];

describe("진입 repair 는 noStore 클라이언트로만 (2026-10-06 사고)", () => {
  it.each(ENTRY_PAGES)("%s", (file) => {
    const source = readFileSync(path.join(APP, file), "utf8");
    const calls = [...source.matchAll(/repair\w+OnEntry\(\s*ctx\s*,\s*([^)]*\))\s*\)/gu)].map((match) => match[1]);
    expect(calls.length, "진입 repair 호출이 있어야 한다").toBeGreaterThan(0);
    for (const call of calls) expect(call).toContain("createClient({ noStore: true }");
  });

  it("레이아웃 부트스트랩도 noStore 를 유지한다", () => {
    const source = readFileSync(path.join(APP, "layout.tsx"), "utf8");
    expect(source).toContain("createClient({ noStore: true })");
  });
});
