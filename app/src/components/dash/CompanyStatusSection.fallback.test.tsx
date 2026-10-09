import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CompanyStatusSectionFallback } from "./CompanyStatusSection";

// 뼈대는 조회가 없다. 절 파일이 끌고 오는 서버 전용 모듈만 비운다(뼈대 렌더와 무관).
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], get: () => undefined }), headers: async () => new Headers() }));

// 회사 현황을 기다리는 동안 — 제목은 그대로, 내용 자리는 위젯 모양 뼈대(2026-10-09).
describe("CompanyStatusSectionFallback", () => {
  const html = renderToStaticMarkup(<CompanyStatusSectionFallback />);

  it("제목을 지키고, 낭독기에는 «불러오는 중» 을 알린다", () => {
    expect(html).toContain("회사 현황");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("회사 현황을 불러오는 중이에요.");
  });

  it("요약 카드 3 + 위젯 4 모양의 뼈대이고, 지어낸 숫자는 없다", () => {
    expect(html.match(/mw-skeleton/g)?.length ?? 0).toBeGreaterThan(10);
    const widgetCards = html.split('class="mw-skeleton mb-[var(--sp-4)]').length - 1;
    expect(widgetCards).toBe(4);
    expect(html).not.toMatch(/\d+건/);
  });
});
