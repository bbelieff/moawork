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
    expect(html).toContain("검토 환경");
    expect(html).toContain("열람 권한을 받은 경우에만");
    expect(html).toMatch(/플랫폼 운영 .* 운영 분석/);
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
});
