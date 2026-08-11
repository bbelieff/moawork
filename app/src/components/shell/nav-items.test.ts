import { describe, it, expect } from "vitest";
import { NAV_ITEMS } from "./nav-items";

function hrefOf(key: string): string | undefined {
  return NAV_ITEMS.find((i) => i.key === key)?.href;
}

describe("BBE-103 — 사이드바 연결 누락 회귀 가드", () => {
  it("업체관리·공지사항·컨택업체가 실제 라우트에 연결돼 있다", () => {
    expect(hrefOf("company")).toBe("/companies");
    expect(hrefOf("notice")).toBe("/notices");
    expect(hrefOf("contact")).toBe("/contract");
  });

  it("업무관리는 /policyfund 를 유지한다 — MWC 프로덕션 실측 정정(2026-08-11): " +
    "/work 는 빈 데이터, /policyfund 는 31컬럼+선택지 전량 렌더 확인. 임의 교체 금지.", () => {
    expect(hrefOf("work")).toBe("/policyfund");
  });

  it("미구현 항목은 그대로 잠금 유지 — 없는 화면으로 보내지 않는다", () => {
    for (const key of ["vendor", "topco", "acct"]) {
      expect(hrefOf(key)).toBeUndefined();
    }
  });
});
