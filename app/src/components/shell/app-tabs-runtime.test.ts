import { describe, expect, it } from "vitest";
import { APP_TABS, matchTabByPathname } from "./app-tabs";

// BBE-142 수용기준1 — 「탭 6개가 한 셸 안에서 전환된다」의 런타임 절반.
// app-tabs.test.ts 가 «분류표가 옳은가» 를 보고, 이 파일이 «셸이 실제 주소를 탭으로 읽는가» 를 본다.
// 1차 검수에서 FAIL 난 지점이 정확히 이 경계였다 — 표는 있었는데 소비하는 런타임이 없었다.

describe("matchTabByPathname — 셸이 «지금 어느 탭인가» 를 판정한다", () => {
  it("여섯 탭의 대표 주소를 각각 자기 탭으로 읽는다", () => {
    expect(matchTabByPathname("/newcust")?.key).toBe("new");
    expect(matchTabByPathname("/contract")?.key).toBe("contact");
    expect(matchTabByPathname("/work")?.key).toBe("work");
    expect(matchTabByPathname("/companies")?.key).toBe("company");
    expect(matchTabByPathname("/notices")?.key).toBe("notice");
    expect(matchTabByPathname("/presets")?.key).toBe("preset");
  });

  it("동적 세그먼트가 든 실제 주소도 같은 탭으로 읽는다 — 상세로 들어가도 탭이 안 바뀐다", () => {
    // 분류표에는 `/companies/[companyId]` 로 적혀 있고, 브라우저에는 실제 id 가 들어온다.
    expect(matchTabByPathname("/companies/c-123")?.key).toBe("company");
    expect(matchTabByPathname("/notices/n-9")?.key).toBe("notice");
    expect(matchTabByPathname("/boards/b-1")?.key).toBe("new");
  });

  it("옛 주소로 들어와도 해당 탭으로 읽는다 — 기존 주소를 깨지 않는다", () => {
    expect(matchTabByPathname("/policyfund")?.key).toBe("work");
    expect(matchTabByPathname("/boards")?.key).toBe("new");
  });

  it("탭 밖 화면에서는 탭을 돌려주지 않는다 — 셸이 탭 줄을 그리지 않는 근거다", () => {
    for (const outside of [
      "/",
      "/settings/members",
      "/settings/account/sessions",
      "/platform",
      "/platform/organizations",
      "/account",
      "/onboarding",
      "/workspaces",
      "/dash/all",
      "/deals/d-1",
    ]) {
      expect(matchTabByPathname(outside), `${outside} 는 탭 밖이어야 한다`).toBeUndefined();
    }
  });

  it("모르는 주소는 탭이 아니다 — 유령 탭을 만들지 않는다", () => {
    expect(matchTabByPathname("/no-such-route")).toBeUndefined();
    expect(matchTabByPathname("/companies/c-1/extra")).toBeUndefined();
  });

  it("끝 슬래시가 붙어도 같은 탭이다", () => {
    expect(matchTabByPathname("/presets/")?.key).toBe("preset");
  });

  it("경로를 모르면 탭이 아니다 — 라우터 문맥 밖에서 셸이 터지면 안 된다", () => {
    // usePathname() 은 서버 렌더 테스트처럼 라우터 문맥이 없는 곳에서 null 을 준다.
    // BBE-139 의 layout.entry-guard.test.tsx 가 정확히 그 상황이다.
    expect(matchTabByPathname(null)).toBeUndefined();
    expect(matchTabByPathname(undefined)).toBeUndefined();
    expect(matchTabByPathname("")).toBeUndefined();
  });

  it("탭 밖 판정이 탭 판정보다 «먼저» 다 — 겹치면 탭 밖이 이긴다", () => {
    // `/` 는 대시보드(탭 밖)다. 어떤 탭의 패턴에도 걸려선 안 된다.
    expect(matchTabByPathname("/")).toBeUndefined();
    expect(APP_TABS.some((tab) => tab.canonicalHref === "/")).toBe(false);
  });
});
