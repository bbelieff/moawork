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

  it("업무관리는 /work 를 가리킨다 — 총괄 지시(2026-08-12, BBE-142 PR #166 인계)로 " +
    "2026-08-11 MWC 데이터-완성도 결정(/policyfund 유지)을 뒤집는다: " +
    "/policyfund 는 앱 셸 밖 옛 미리보기이고, /work 는 셸(사이드바·상단바) 안의 새 화면이다. " +
    "/policyfund 페이지 자체는 지우지 않는다 — 총괄이 후속 정리한다.", () => {
    expect(hrefOf("work")).toBe("/work");
  });

  it("미구현 항목은 그대로 잠금 유지 — 없는 화면으로 보내지 않는다", () => {
    for (const key of ["vendor", "topco", "acct"]) {
      expect(hrefOf(key)).toBeUndefined();
    }
  });
});
