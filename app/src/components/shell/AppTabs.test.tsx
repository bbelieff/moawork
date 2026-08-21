import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { APP_TABS } from "./app-tabs";

// 셸이 여섯 탭을 «실제로 그리는가». 위 app-tabs-runtime.test.ts 가 판정 로직을,
// 이 파일이 그 판정이 DOM 으로 나오는지를 본다.

const pathname = vi.hoisted(() => ({ current: "/presets" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

async function render(path: string, lockedFeatures: string[] = [], workspaceBasePath: string | null = "/w/sample-lab", directHrefs?: { contact?: string }) {
  pathname.current = path;
  const { AppTabs } = await import("./AppTabs");
  return renderToStaticMarkup(<AppTabs lockedFeatures={lockedFeatures} workspaceBasePath={workspaceBasePath ?? undefined} directHrefs={directHrefs} />);
}

describe("AppTabs — 목업 「탭 6개 한 화면」 탭 줄", () => {
  it("탭 화면에서 여섯 탭을 모두 그린다 — 구조를 줄이지 않는다(D73)", async () => {
    const html = await render("/w/sample-lab/presets");
    for (const tab of APP_TABS) {
      expect(html, `${tab.key} 탭이 없다`).toContain(`data-tab-key="${tab.key}"`);
    }
    expect((html.match(/data-tab-key=/g) ?? []).length).toBe(6);
  });

  it("지금 보고 있는 탭만 aria-current=page 다", async () => {
    const html = await render("/w/sample-lab/presets");
    const current = [...html.matchAll(/data-tab-key="([a-z]+)"[^>]*aria-current="page"/g)].map((m) => m[1]);
    expect(current).toEqual(["preset"]);
  });

  it("상세 주소로 들어가도 탭 줄이 유지되고 부모 탭이 활성이다", async () => {
    const html = await render("/w/sample-lab/companies/c-1");
    expect(html).toContain('data-tab-key="company"');
    expect(html).toMatch(/data-tab-key="company"[^>]*aria-current="page"/);
  });

  it("탭 밖 화면에서는 아무것도 그리지 않는다", async () => {
    expect(await render("/w/sample-lab/settings/members")).toBe("");
    expect(await render("/w/sample-lab/platform")).toBe("");
    expect(await render("/w/sample-lab")).toBe("");
    expect(await render("/w/sample-lab/boards/board-1")).toBe("");
  });

  it("보드 본문에서는 사이드바 복제 탭을 숨겨 저장 뷰 헤더와 경쟁하지 않는다", async () => {
    const html = await render("/w/sample-lab/boards/board-1?view=flat");
    expect(html).toBe("");
  });

  it("각 탭이 자기 대표 주소로 링크된다 — 전환이 실제로 일어난다", async () => {
    const html = await render("/w/sample-lab/presets");
    for (const tab of APP_TABS) {
      expect(html).toContain(`href="/w/sample-lab${tab.canonicalHref}"`);
    }
  });

  it("server-resolved contact destination bypasses /contract only", async () => {
    const html = await render("/w/sample-lab/work", [], "/w/sample-lab", { contact: "/boards/contact-board" });
    const contactTag = html.match(/<a[^>]*data-tab-key="contact"[^>]*>/)?.[0] ?? "";
    expect(contactTag).toContain('href="/w/sample-lab/boards/contact-board"');
    expect(html).toContain('href="/w/sample-lab/newcust"');
    expect(contactTag).not.toContain('href="/w/sample-lab/contract"');
  });

  it("fails every tab closed when the workspace namespace is unavailable", async () => {
    const html = await render("/presets", [], null);
    expect((html.match(/href="\/workspace-entry\?error=routing"/g) ?? []).length).toBe(6);
    expect(html).not.toMatch(/href="\/(?:newcust|contract|work|companies|notices|presets)"/);
  });

  it("잠긴 기능의 탭은 잠금으로 표시한다 — 엔타이틀먼트는 서버 진실", async () => {
    const html = await render("/w/sample-lab/presets", ["core.crm"]);
    expect(html).toMatch(/data-tab-key="new"[^>]*aria-disabled="true"/);
    // 잠기지 않은 탭은 그대로다.
    expect(html).not.toMatch(/data-tab-key="preset"[^>]*aria-disabled="true"/);
  });

  it("상단 탭은 사이드바 축약명이 아니라 목업 정본명을 유지한다", async () => {
    const html = await render("/w/sample-lab/presets");

    for (const tab of APP_TABS) {
      expect(html).toContain(`<span>${tab.mockupLabel}</span>`);
    }
    expect(html).toContain("프리셋 라이브러리");
    expect(html).not.toMatch(/data-tab-key="preset"[^>]*>.*<span>프리셋<\/span>/);
  });
});
