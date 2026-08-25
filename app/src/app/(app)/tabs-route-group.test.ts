import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = __dirname;
const TABS_ROOT = join(APP_ROOT, "(tabs)");
const TAB_ROUTES = ["newcust", "contract", "work", "companies", "notices", "presets"] as const;

function relativeFiles(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory()
      ? relativeFiles(path, base)
      : [path.slice(base.length + 1).replaceAll("\\", "/")];
  });
}

describe("BBE-227 · 업무 여섯 화면의 route group (가로 탭 줄은 2026-08-25 제거)", () => {
  it("moves all six route trees without leaving a second URL owner", () => {
    for (const route of TAB_ROUTES) {
      expect(existsSync(join(TABS_ROOT, route, "page.tsx")), `${route}/page.tsx missing`).toBe(true);
      expect(existsSync(join(APP_ROOT, route)), `${route} still has an old route owner`).toBe(false);
    }
  });

  it("preserves every page/loading/action/error/test file during the move", () => {
    const files = relativeFiles(TABS_ROOT);
    expect(files).toEqual(expect.arrayContaining([
      "newcust/loading.tsx",
      "contract/loading.tsx",
      "work/actions.ts",
      "companies/[companyId]/page.test.tsx",
      "notices/[noticeId]/page.tsx",
      "notices/production-boundary.test.ts",
      "presets/permission-actions.test.ts",
    ]));
  });

  // 2026-08-25 총괄 직접 지시로 계약이 «뒤집혔다» — 가로 탭 줄을 아예 없앴다.
  //   「위에 탭이름 반복해서 가로로 나오는거 … 필요가 없는거야 … 아예 이게 페이지에 뜨지 않게」
  //   왼쪽 사이드바가 같은 여섯 곳을 이미 그려서 같은 것이 두 번 보였다.
  //   전에는 「route-group layout «에서만» 그린다」가 규칙이었다. 이제 「어디에서도 안 그린다」다.
  it("가로 탭 줄을 어느 레이아웃에서도 그리지 않는다", () => {
    const rootLayout = readFileSync(join(APP_ROOT, "layout.tsx"), "utf8");
    const tabsLayout = readFileSync(join(TABS_ROOT, "layout.tsx"), "utf8");

    for (const [name, source] of [["root", rootLayout], ["(tabs)", tabsLayout]] as const) {
      expect(source, `${name} layout 이 AppTabs 를 다시 들여왔다`).not.toContain('from "@/components/shell/AppTabs"');
      expect(source, `${name} layout 이 AppTabs 를 다시 그린다`).not.toMatch(/<AppTabs(?:\s|>)/);
    }
    // 부품 자체도 남기지 않았다 — 닿지 않는 파일을 늘리지 않는다.
    expect(existsSync(join(APP_ROOT, "..", "..", "components", "shell", "AppTabs.tsx"))).toBe(false);
  });

  it("★ 탭 «데이터» 는 남는다 — 사이드바·경로 판정·목업 대조가 읽는다", () => {
    // 없앤 것은 «가로로 그리던 부품» 하나다. app-tabs.ts 까지 지우면 사이드바와
    // qa-app 목업 대조가 같이 무너진다.
    expect(existsSync(join(APP_ROOT, "..", "..", "components", "shell", "app-tabs.ts"))).toBe(true);
  });

  it("keeps boards and every out-of-tab route outside the group", () => {
    for (const route of ["boards", "settings", "dash", "ledger", "account", "onboarding"]) {
      expect(existsSync(join(APP_ROOT, route)), `${route} unexpectedly moved into tabs`).toBe(true);
      expect(existsSync(join(TABS_ROOT, route)), `${route} must not receive AppTabs`).toBe(false);
    }
  });
});
