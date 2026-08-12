import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_TABS, OUT_OF_TAB_HREFS, findTabByHref } from "./app-tabs";

// app/src/app 아래 모든 page.tsx 를 라우트 경로로 변환한다. 라우트 그룹 `(app)`·`(auth)` 는
// URL 에 나타나지 않으므로 벗겨낸다 — 이 변환 자체가 Next.js App Router 규칙과 같다.
function collectRoutes(dir: string, base: string[] = []): string[] {
  const entries = readdirSync(dir);
  const routes: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      const isGroup = entry.startsWith("(") && entry.endsWith(")");
      routes.push(...collectRoutes(full, isGroup ? base : [...base, entry]));
    } else if (entry === "page.tsx") {
      const path = "/" + base.join("/");
      routes.push(path === "//" ? "/" : path.replace(/\/$/, "") || "/");
    }
  }
  return routes;
}

const APP_DIR = join(__dirname, "..", "..", "app");
const ACTUAL_ROUTES = collectRoutes(APP_DIR);

describe("APP_TABS — 6탭 정본", () => {
  it("6개 키가 정확하다 — new/contact/work/company/notice/preset", () => {
    expect(APP_TABS.map((t) => t.key)).toEqual(["new", "contact", "work", "company", "notice", "preset"]);
  });

  it("모든 탭에 canonicalHref 가 있다(프리셋 라이브러리 신설 포함)", () => {
    expect(APP_TABS.every((t) => t.canonicalHref !== null)).toBe(true);
  });

  it("findTabByHref 가 canonical·alt 양쪽을 찾는다", () => {
    expect(findTabByHref("/companies")?.key).toBe("company");
    expect(findTabByHref("/companies/[companyId]")?.key).toBe("company");
    expect(findTabByHref("/policyfund")?.key).toBe("work");
    expect(findTabByHref("/no-such-route")).toBeUndefined();
  });
});

describe("실제 라우트 전수 분류 — 드리프트 가드", () => {
  const classified = new Set<string>([
    ...APP_TABS.flatMap((t) => [t.canonicalHref, ...t.altHrefs].filter((h): h is string => h !== null)),
    ...OUT_OF_TAB_HREFS,
  ]);

  it("실제 페이지 라우트가 하나 이상 발견됐다(파서 자체 확인)", () => {
    expect(ACTUAL_ROUTES.length).toBeGreaterThan(20);
  });

  it("발견된 라우트 전부가 6탭 또는 탭 밖 목록에 있다 — 새 라우트가 생기면 이 테스트가 깨진다", () => {
    const unclassified = ACTUAL_ROUTES.filter((route) => !classified.has(route));
    expect(unclassified, `분류 안 된 라우트: ${unclassified.join(", ")}`).toEqual([]);
  });

  it("분류표에 있는 주소 중 실제로 존재하지 않는 것은 없다(유령 주소 방지)", () => {
    const actualSet = new Set(ACTUAL_ROUTES);
    const ghosts = [...classified].filter((href) => !actualSet.has(href));
    expect(ghosts, `실재하지 않는 분류 주소: ${ghosts.join(", ")}`).toEqual([]);
  });
});
