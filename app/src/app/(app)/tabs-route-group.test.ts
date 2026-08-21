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

describe("BBE-227 · six business routes own the AppTabs layout", () => {
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

  it("renders AppTabs only from the route-group layout", () => {
    const rootLayout = readFileSync(join(APP_ROOT, "layout.tsx"), "utf8");
    const tabsLayout = readFileSync(join(TABS_ROOT, "layout.tsx"), "utf8");

    expect(rootLayout).not.toContain('from "@/components/shell/AppTabs"');
    expect(rootLayout).not.toMatch(/<AppTabs(?:\s|>)/);
    expect(tabsLayout).toContain('from "@/components/shell/AppTabs"');
    expect(tabsLayout).toContain("<AppTabs {...appTabs} />");
  });

  it("keeps boards and every out-of-tab route outside the group", () => {
    for (const route of ["boards", "settings", "dash", "ledger", "account", "onboarding"]) {
      expect(existsSync(join(APP_ROOT, route)), `${route} unexpectedly moved into tabs`).toBe(true);
      expect(existsSync(join(TABS_ROOT, route)), `${route} must not receive AppTabs`).toBe(false);
    }
  });
});
