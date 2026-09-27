import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PLATFORM_NAV, PLATFORM_NAV_GROUPS } from "./nav";
import { PlatformAggregatePanel, PlatformShell } from "./PlatformShell";
import { unavailablePlatformAggregate } from "@/lib/platform/contracts";

describe("PlatformShell", () => {
  it("renders the safe navigation destinations and marks the current page", () => {
    const html = renderToStaticMarkup(<PlatformShell pathname="/platform/analytics" title="운영 분석" description="집계만"><p>내용</p></PlatformShell>);
    expect(PLATFORM_NAV).toHaveLength(9);
    expect(PLATFORM_NAV_GROUPS).toHaveLength(3);
    expect(html).toContain('href="/platform/analytics"');
    expect(html).toContain('href="/platform/demo"');
    expect(html).toContain('aria-current="page"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain("현황");
    expect(html).toContain("고객사 관리");
    expect(html).toContain("출시 전 확인");
    expect(html).toContain("서비스 관리자 전용");
    expect(html).toMatch(/서비스 운영 .* 운영 분석/);
    for (const item of PLATFORM_NAV) {
      expect(html.match(new RegExp(`href="${item.href}"`, "g"))).toHaveLength(1);
    }
    for (const group of PLATFORM_NAV_GROUPS) {
      expect(html).toContain(`aria-labelledby="platform-nav-${group.key}"`);
      expect(html).toContain(`id="platform-nav-${group.key}"`);
    }
    expect(html).not.toContain("개인정보 표시");
  });

  it("uses an honest unavailable state instead of a fabricated metric", () => {
    const html = renderToStaticMarkup(<PlatformAggregatePanel section="overview" state={unavailablePlatformAggregate()} />);
    expect(html).toContain("임시 수치나 고객 정보로 대신 표시하지 않습니다");
    expect(html).toContain("고객사·사용자·업무 원본");
    expect(html).not.toContain("0건");
  });

  it("keeps the platform-mode badge visible and accepts only an injected return destination", () => {
    const html = renderToStaticMarkup(<PlatformShell pathname="/platform" title="운영" description="집계" userModeAction={{ mode: "user" }}><p>내용</p></PlatformShell>);
    expect(html).toContain("관리자 모드");
    expect(html).toContain("사용자 모드로");
    expect(html).toContain('action="/mode/preference"');
  });

  it("shows the real lockup undistorted with a single POST return seam", () => {
    const html = renderToStaticMarkup(<PlatformShell pathname="/platform" title="운영" description="집계" userModeAction={{ mode: "user" }}><p>내용</p></PlatformShell>);
    // 실제 락업(어두운 band에서 읽히는 dark 자산) + 현재 위치 캡션.
    // band는 상태 표시줄이라 탐색 링크를 두지 않는다(탐색 href 단일 계약 유지).
    expect(html).toContain("/brand/moawork-lockup-dark.svg");
    expect(html).toContain("서비스 관리자 전용");
    // 비율 계약(레이아웃 사이드바와 동일): 자연 너비(height×3)가 120px 이상, min-width가 자연 너비 이하.
    const inlineStyles = [...html.matchAll(/<img[^>]*style="([^"]*)"[^>]*>/g)].map((match) => match[1]);
    expect(inlineStyles.length).toBeGreaterThan(0);
    for (const style of inlineStyles) {
      const height = Number(/height:\s*(\d+(?:\.\d+)?)px/.exec(style)?.[1]);
      const minWidth = Number(/min-width:\s*(\d+(?:\.\d+)?)px/.exec(style)?.[1]);
      expect(height * 3).toBeGreaterThanOrEqual(120);
      expect(minWidth).toBeLessThanOrEqual(height * 3);
    }
    // 현재 표시와 전환은 함께 있고, 전환은 POST 그대로.
    expect(html).toContain("관리자 모드");
    expect(html).toContain("사용자 모드로");
    expect(html).toContain('name="mode" value="user"');
  });
});
