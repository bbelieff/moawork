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
    expect(source).not.toMatch(/import\s*\(.*repo\/local/);
    // BBE-236 이전엔 이 파일이 SupabaseBoardsRepo 를 직접 만들었다. 지금은 공용 진입 헬퍼
    // (repairContractWorkBoardOnEntry)에 client 를 그대로 넘긴다 — 아래 두 번째 테스트가
    // 그 헬퍼 안에서도 같은 경계가 지켜지는지 확인한다.
    expect(source).toContain("repairContractWorkBoardOnEntry(ctx, await createClient())");
    // ★ 요청당 «한 개» — 이 계약의 본질이다. 렌더러가 바뀌어도 이건 안 바뀐다.
    expect(source.match(/await createClient\(\)/g)).toHaveLength(1);

    // 2026-08-25(#551) — work-management 읽기 모델을 더 이상 쓰지 않는다.
    //   그 렌더러는 `태스크`(items.title) 컬럼을 전제하는데 이 보드에는 그 컬럼이 없어
    //   표에 업무 이름이 아예 안 나왔다. 목업에도 그 열은 없다.
    //   이제 리드컨택과 같은 형태로 표준 보드 화면에 넘긴다.
    expect(source).not.toMatch(/WorkManagementSource/);
    expect(source).not.toMatch(/NotificationWorkBoard/);
    expect(source).toContain("redirect(`/boards/");
  });

  it("the shared default-tab repair helper still builds SupabaseBoardsRepo, never a local one", () => {
    const source = readFileSync(repairOnEntry, "utf8");

    expect(source).not.toMatch(/@\/lib\/repo\/local\/boardsRepo/);
    expect(source).not.toMatch(/\bgetBoardsRepo\s*\(/);
    expect(source).toContain("new SupabaseBoardsRepo(client)");
  });
});
