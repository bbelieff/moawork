import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildConsultationBoardRedirect,
  buildConsultationViewOptions,
} from "@/components/shell/active-nav";
import {
  CONSULTATION_CANONICAL_PATH,
  CONSULTATION_LEGACY_PATHS,
  resolveConsultationRoute,
} from "@/lib/workflow/precontract-routing";

const routeMocks = vi.hoisted(() => ({
  redirects: [] as string[],
}));

vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    routeMocks.redirects.push(href);
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "user-1" }, org: { id: "org-1" } })),
  applyAs: vi.fn((session: unknown) => session),
}));
vi.mock("@/lib/contact/entry", () => ({
  repairContactBoardOnEntry: vi.fn(async () => ({ kind: "ready", boardId: "contact/board" })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({})),
}));

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const visualFixtureSource = readFileSync(
  new URL("../../../login/visual-fixture/page.tsx", import.meta.url),
  "utf8",
);

describe("Issue #834 S1A — 상담관리 메뉴와 보드 보기", () => {
  beforeEach(() => {
    routeMocks.redirects.length = 0;
  });

  it("전체·비대면·대면은 경로를 바꾸지 않고 같은 보드의 안전한 쿼리만 바꾼다", () => {
    const options = buildConsultationViewOptions(
      "savedView=mine&view=kanban&group=status&mwFocus=owner&consultation=remote&unsafe=drop",
      "remote",
    );

    expect(options.map((option) => option.id)).toEqual(["all", "remote", "inperson"]);
    expect(options.find((option) => option.id === "remote")?.active).toBe(true);
    expect(options.find((option) => option.id === "all")?.href).toBe(
      "?savedView=mine&view=kanban&group=status&mwFocus=owner",
    );
    expect(options.find((option) => option.id === "inperson")?.href).toBe(
      "?savedView=mine&view=kanban&group=status&mwFocus=owner&consultation=inperson",
    );
    expect(options.every((option) => option.href.startsWith("?") && !option.href.includes("unsafe"))).toBe(true);
  });

  it("옛 주소는 저장된 보기 상태를 보존하면서 canonical 상담관리로 모인다", () => {
    expect(resolveConsultationRoute(
      `${CONSULTATION_LEGACY_PATHS.remote}?savedView=mine&view=flat&group=owner&mwFocus=status`,
    )).toMatchObject({
      menuId: "consultation",
      viewId: "remote",
      canonicalHref: "/contract?savedView=mine&view=flat&group=owner&mwFocus=status&consultation=remote",
      legacyAlias: true,
    });
  });

  it("실제 canonical·legacy 진입 redirect도 같은 allowlist와 보기 값을 쓴다", async () => {
    const shared = {
      as: "admin",
      savedView: "mine",
      view: "flat",
      group: "owner",
      mwFocus: "status",
      unsafe: "drop",
      next: "//evil.example",
    } as const;
    const { default: ContractPage } = await import("../../(tabs)/contract/page");
    const { default: RemotePage } = await import("../../(tabs)/consult-remote/page");
    const { default: InpersonPage } = await import("../../(tabs)/consult-inperson/page");

    for (const [Page, expected] of [
      [ContractPage, "/boards/contact%2Fboard?as=admin&savedView=mine&view=flat&group=owner&mwFocus=status"],
      [RemotePage, "/boards/contact%2Fboard?as=admin&savedView=mine&view=flat&group=owner&mwFocus=status&consultation=remote"],
      [InpersonPage, "/boards/contact%2Fboard?as=admin&savedView=mine&view=flat&group=owner&mwFocus=status&consultation=inperson"],
    ] as const) {
      await expect(Page({ searchParams: Promise.resolve(shared) })).rejects.toThrow("NEXT_REDIRECT");
      expect(routeMocks.redirects.pop()).toBe(expected);
    }
  });

  it("malformed consultation과 외부·protocol-relative·backslash 입력은 neutral safe query로 닫힌다", () => {
    expect(buildConsultationBoardRedirect("board-1", CONSULTATION_CANONICAL_PATH, {
      consultation: "unexpected",
      savedView: "mine",
      returnTo: "https://evil.example",
      next: "//evil.example",
      path: "/\\evil.example",
    })).toBe("/boards/board-1?savedView=mine");
  });

  it("보드는 같은 item/deal/company 조회 결과를 보기에서만 거르고 복제 경로를 만들지 않는다", () => {
    expect(pageSource).toContain("loadConsultationBoardView(boardRpc");
    expect(pageSource).toContain('const stageItems = consultationView === "all"');
    expect(pageSource).toContain("items.filter((item) => consultationModeForRow(item.id, consultationByItem) === consultationView)");
    expect(pageSource).toContain("rows={stageItems}");
    expect(pageSource).toContain('aria-label="상담 보기"');
    expect(pageSource).toContain("buildConsultationViewOptions(currentQuery.toString(), consultationView)");
    expect(pageSource).not.toMatch(/consultation[^\n]{0,80}\.(?:insert|upsert)\(/u);
  });

  it("합성 화면도 제품과 같은 selector builder를 써서 브라우저 증거를 만든다", () => {
    expect(visualFixtureSource).toContain("buildConsultationViewOptions(consultationSearch.toString(), consultationView)");
    expect(visualFixtureSource).toContain("viewSlot={consultationViewSlot}");
    expect(visualFixtureSource).toContain("data-visual-consultation-selector");
  });
});
