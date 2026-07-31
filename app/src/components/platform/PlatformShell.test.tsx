import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PLATFORM_NAV } from "./nav";
import { PlatformAggregatePanel, PlatformShell } from "./PlatformShell";
import { unavailablePlatformAggregate } from "@/lib/platform/contracts";

describe("PlatformShell", () => {
  it("renders exactly eight safe navigation destinations and marks the current page", () => {
    const html = renderToStaticMarkup(<PlatformShell pathname="/platform/analytics" title="운영 분석" description="집계만"><p>내용</p></PlatformShell>);
    expect(PLATFORM_NAV).toHaveLength(8);
    expect(html).toContain('href="/platform/analytics"');
    expect(html).toContain('aria-current="page"');
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
