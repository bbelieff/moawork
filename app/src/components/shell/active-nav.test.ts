import { describe, expect, it } from "vitest";
import {
  boardIdFromPathname,
  resolveActiveNavKey,
  resolveConsultationNavKey,
  TAB_SOURCE_NAV_KEY,
} from "./active-nav";
import {
  CONTACT_TAB_SOURCE,
  CONTRACT_WORK_TAB_SOURCE,
  NEW_LEAD_TAB_SOURCE,
  NOTICE_TAB_SOURCE,
} from "@/lib/default-tabs";

const BASE = "/w/acme";
const CANDIDATES = [
  { key: "dash", href: BASE },
  { key: "notice", href: `${BASE}/notices` },
  { key: "new", href: `${BASE}/newcust` },
  { key: "contact", href: `${BASE}/contract` },
  { key: "work", href: `${BASE}/work` },
  { key: "company", href: `${BASE}/companies` },
  { key: "tabs", href: `${BASE}/settings/workspace-builder` },
  { key: "members", href: `${BASE}/settings/members` },
  { key: "notifications", href: `${BASE}/settings/notifications` },
];

describe("사이드바 활성 판정", () => {
  it("보드 화면에서도 «그 탭» 이 켜진다 — /work 는 /boards/<id> 로 넘어가는 경유지다", () => {
    const key = resolveActiveNavKey(`${BASE}/boards/b-work`, CANDIDATES, {
      basePath: BASE,
      boardNavKeys: { "b-work": "work" },
    });
    expect(key).toBe("work");
  });

  it("모르는 보드는 아무것도 켜지 않는다 — 엉뚱한 메뉴를 켜는 것보다 낫다", () => {
    const key = resolveActiveNavKey(`${BASE}/boards/b-unknown`, CANDIDATES, {
      basePath: BASE,
      boardNavKeys: { "b-work": "work" },
    });
    expect(key).toBeNull();
  });

  it("대시보드는 정확히 그 주소일 때만이다 — 아니면 모든 화면이 대시보드가 된다", () => {
    expect(resolveActiveNavKey(BASE, CANDIDATES, { basePath: BASE })).toBe("dash");
    expect(
      resolveActiveNavKey(`${BASE}/companies`, CANDIDATES, { basePath: BASE }),
    ).toBe("company");
  });

  it("하위 화면은 그 탭에 속한다", () => {
    expect(
      resolveActiveNavKey(`${BASE}/companies/c-1`, CANDIDATES, { basePath: BASE }),
    ).toBe("company");
  });

  it("겹치는 주소에서는 «가장 깊은» 하나만 켜진다", () => {
    expect(
      resolveActiveNavKey(`${BASE}/settings/members`, CANDIDATES, { basePath: BASE }),
    ).toBe("members");
  });

  it("세그먼트 경계를 지킨다 — /companies 가 /companies-archive 를 먹지 않는다", () => {
    expect(
      resolveActiveNavKey(`${BASE}/companies-archive`, CANDIDATES, { basePath: BASE }),
    ).toBeNull();
  });

  it("어디에도 안 닿는 주소는 아무것도 켜지 않는다", () => {
    expect(resolveActiveNavKey(`${BASE}/deals/d-1`, CANDIDATES, { basePath: BASE })).toBeNull();
  });

  it("보드 id 를 주소에서 뽑는다", () => {
    expect(boardIdFromPathname(`${BASE}/boards/b-1`)).toBe("b-1");
    expect(boardIdFromPathname("/boards/b-1")).toBe("b-1");
    expect(boardIdFromPathname(`${BASE}/companies`)).toBeNull();
  });

  it("기본 탭 네 개가 전부 메뉴 키로 이어진다", () => {
    expect(TAB_SOURCE_NAV_KEY[NEW_LEAD_TAB_SOURCE]).toBe("new");
    expect(TAB_SOURCE_NAV_KEY[CONTACT_TAB_SOURCE]).toBe("contact");
    expect(TAB_SOURCE_NAV_KEY[CONTRACT_WORK_TAB_SOURCE]).toBe("work");
    expect(TAB_SOURCE_NAV_KEY[NOTICE_TAB_SOURCE]).toBe("notice");
  });

  it("같은 contact 보드라도 단계 보기 쿼리면 STEP2·STEP3 탭이 켜진다", () => {
    const keys = { "b-contact": "contact" };
    expect(resolveConsultationNavKey(`${BASE}/boards/b-contact`, "?consultation=remote", keys)).toBe(
      "consult-remote",
    );
    expect(resolveConsultationNavKey(`${BASE}/boards/b-contact`, "?consultation=inperson", keys)).toBe(
      "consult-inperson",
    );
  });

  it("쿼리가 없거나 contact 보드가 아니면 단계 탭을 켜지 않는다", () => {
    const keys = { "b-contact": "contact", "b-work": "work" };
    expect(resolveConsultationNavKey(`${BASE}/boards/b-contact`, "", keys)).toBeNull();
    expect(resolveConsultationNavKey(`${BASE}/boards/b-contact`, null, keys)).toBeNull();
    expect(resolveConsultationNavKey(`${BASE}/boards/b-contact`, "?consultation=all", keys)).toBeNull();
    expect(resolveConsultationNavKey(`${BASE}/boards/b-work`, "?consultation=remote", keys)).toBeNull();
    expect(resolveConsultationNavKey(`${BASE}/companies`, "?consultation=remote", keys)).toBeNull();
  });

  // #849 사용자 탭 — 보드 id 지도에 «board:<id>» 로 들어간다.
  it("#849 사용자 탭 보드에서는 그 탭 줄(board:<id>) 하나만 켜진다 — 워크스페이스 주소든 맨 주소든", () => {
    const boardNavKeys = { u1: "board:u1", "b-work": "work" };
    const candidates = [...CANDIDATES, { key: "board:u1", href: `${BASE}/boards/u1` }];
    expect(resolveActiveNavKey(`${BASE}/boards/u1`, candidates, { basePath: BASE, boardNavKeys })).toBe("board:u1");
    expect(resolveActiveNavKey("/boards/u1", candidates, { basePath: BASE, boardNavKeys })).toBe("board:u1");
    // 줄 후보가 없어도(주소 접두어가 달라도) 지도만으로 켜진다.
    expect(resolveActiveNavKey("/boards/u1", CANDIDATES, { basePath: BASE, boardNavKeys })).toBe("board:u1");
  });

  it("#849 사용자 탭 보드에 상담 단계 쿼리가 붙어도 STEP2·STEP3 탭을 켜지 않는다", () => {
    const boardNavKeys = { u1: "board:u1", "b-contact": "contact" };
    expect(resolveConsultationNavKey(`${BASE}/boards/u1`, "consultation=remote", boardNavKeys)).toBeNull();
    expect(resolveConsultationNavKey("/boards/u1", "?consultation=inperson", boardNavKeys)).toBeNull();
  });
});
