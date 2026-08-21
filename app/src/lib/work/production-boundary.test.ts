import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workPage = new URL("../../app/(app)/(tabs)/work/page.tsx", import.meta.url);
// BBE-236 — repairContractWorkBoardOnEntry() 가 SupabaseBoardsRepo 구성을 여기로 옮겼다.
// «어디서 만드는가» 가 아니라 «로컬 repo 로 안 새는가» 가 이 계약의 본질이라 그쪽을 지킨다.
const repairOnEntry = new URL("../../lib/default-tabs/repair-on-entry.ts", import.meta.url);

describe("BBE-150 /work production repository boundary", () => {
  it("uses one request-scoped Supabase client without a LocalBoardsRepo factory fallback", () => {
    const source = readFileSync(workPage, "utf8");

    expect(source).not.toMatch(/@\/lib\/repo\/local\/boardsRepo/);
    expect(source).not.toMatch(/\bgetBoardsRepo\s*\(/);
    expect(source).toContain("const client = await createClient()");
    // BBE-236 이전엔 이 파일이 SupabaseBoardsRepo 를 직접 만들었다. 지금은 공용 진입 헬퍼
    // (repairContractWorkBoardOnEntry)에 client 를 그대로 넘긴다 — 아래 두 번째 테스트가
    // 그 헬퍼 안에서도 같은 경계가 지켜지는지 확인한다.
    expect(source).toContain("repairContractWorkBoardOnEntry(ctx, client)");
    expect(source).toContain("new WorkManagementSource(client)");
    expect(source.match(/await createClient\(\)/g)).toHaveLength(1);
  });

  it("the shared default-tab repair helper still builds SupabaseBoardsRepo, never a local one", () => {
    const source = readFileSync(repairOnEntry, "utf8");

    expect(source).not.toMatch(/@\/lib\/repo\/local\/boardsRepo/);
    expect(source).not.toMatch(/\bgetBoardsRepo\s*\(/);
    expect(source).toContain("new SupabaseBoardsRepo(client)");
  });
});
