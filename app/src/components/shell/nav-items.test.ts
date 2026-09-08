import { describe, it, expect } from "vitest";
import { NAV_ITEMS, NAV_SECTIONS, navItemsForSection } from "./nav-items";

function hrefOf(key: string): string | undefined {
  return NAV_ITEMS.find((i) => i.key === key)?.href;
}

describe("BBE-103 — 사이드바 연결 누락 회귀 가드", () => {
  it("업체관리·공지사항·컨택업체가 실제 라우트에 연결돼 있다", () => {
    expect(hrefOf("company")).toBe("/companies");
    expect(hrefOf("notice")).toBe("/notices");
    expect(hrefOf("contact")).toBe("/contract");
  });

  it("업무관리는 /work 를 가리킨다 — 총괄 지시(2026-08-12, BBE-142 PR #166 인계)로 " +
    "2026-08-11 MWC 데이터-완성도 결정(/policyfund 유지)을 뒤집는다: " +
    "/policyfund 는 앱 셸 밖 옛 미리보기이고, /work 는 셸(사이드바·상단바) 안의 새 화면이다. " +
    "/policyfund 페이지 자체는 지우지 않는다 — 총괄이 후속 정리한다.", () => {
    expect(hrefOf("work")).toBe("/work");
  });

  it("이달의 계약회사는 기존 월 집계 상세 화면으로 연결된다", () => {
    expect(hrefOf("topco")).toBe("/dash/top-companies");
  });

  it("미구현 항목은 그대로 잠금 유지 — 없는 화면으로 보내지 않는다", () => {
    for (const key of ["vendor", "addons"]) {
      expect(hrefOf(key)).toBeUndefined();
    }
  });

  it("회계(acct)는 BBE-240 으로 실화면이 생겨 잠금 해제됐다 — /ledger 로 연결", () => {
    expect(hrefOf("acct")).toBe("/ledger");
  });

  it("목업 D05 계층·순서와 canonical href 를 함께 보존한다", () => {
    expect(NAV_SECTIONS.map((section) => section.label)).toEqual([
      "종합",
      "계약 전",
      "계약 후",
      "준비 중",
      "설정",
    ]);
    expect(NAV_SECTIONS[3].collapsible).toBe(true);
    expect(navItemsForSection(NAV_SECTIONS[0]).map((item) => item.label)).toEqual([
      "대시보드",
      "알림",
      "공지사항",
    ]);
    expect(navItemsForSection(NAV_SECTIONS[1]).map((item) => [item.label, item.href])).toEqual([
      ["신규리드 관리", "/newcust"],
      ["리드컨택 관리", "/contract"],
    ]);
    expect(navItemsForSection(NAV_SECTIONS[2]).map((item) => [item.label, item.href])).toEqual([
      ["계약업체 실무", "/work"],
      ["업체관리 현황", "/companies"],
      ["회계", "/ledger"], // BBE-240 — 연도별 전체 원장.
      ["이달의 계약회사", "/dash/top-companies"],
    ]);
    expect(navItemsForSection(NAV_SECTIONS[3]).map((item) => item.key)).toEqual(["vendor", "addons"]);
    expect(navItemsForSection(NAV_SECTIONS[4]).map((item) => [item.label, item.href])).toEqual([
      ["탭 관리", "/settings/workspace-builder"],
      ["자동화", "/settings/automations"],
      ["조직관리", "/settings/members"],
      ["프리셋", "/presets"],
      ["내 프로필", "/account"],
      ["온보딩", "/onboarding"],
    ]);
  });
});
