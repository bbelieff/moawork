// BBE-229 — 새 page.tsx 는 loading.tsx 또는 사유가 적힌 예외 중 하나를 반드시 고른다.

import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_ROOT = fileURLToPath(new URL(".", import.meta.url));

// Issue 857 — 예외는 «정말 서버 대기가 없는» 화면이나 «바로 위 로딩 경계를 쓰는» 하위 화면만.
//   전에는 대시보드·원장·거래 상세·탭 관리 등 서버를 1~3초 읽는 화면이 «클라이언트 화면» 이라는
//   사실과 다른 이유로 빠져 있어서, 눌러도 아무 표시 없이 멈춘 듯 보였다.
const LOADING_EXCEPTIONS: Readonly<Record<string, string>> = {
  "/account": "설정 › 계정으로 바로 넘기는 경유 경로다(서버 읽기 없음).",
  "/companies/[companyId]": "상위 업체 목록의 로딩 경계를 그대로 사용한다.",
  "/dash/[pipelineId]": "상위 dash 로딩 경계를 그대로 사용한다.",
  "/dash/all": "상위 dash 로딩 경계를 그대로 사용한다.",
  "/dash/tasks": "상위 dash 로딩 경계를 그대로 사용한다.",
  "/notices/[noticeId]": "상위 공지 목록의 로딩 경계를 그대로 사용한다.",
  "/onboarding/practice": "상위 온보딩 로딩 경계를 그대로 사용한다.",
  "/settings/account/privacy": "상위 계정 설정의 로딩 경계를 그대로 사용한다.",
  "/settings/account/sessions": "상위 계정 설정의 로딩 경계를 그대로 사용한다.",
  "/settings/members/approvals": "상위 멤버 설정의 로딩 경계를 그대로 사용한다.",
};

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

function routeFor(file: string): string {
  const directory = relative(APP_ROOT, file.slice(0, -"page.tsx".length)).split(sep).filter(
    (segment) => Boolean(segment) && !(segment.startsWith("(") && segment.endsWith(")")),
  );
  return directory.length === 0 ? "/" : `/${directory.join("/")}`;
}

function loadingCoverage(files: readonly string[], exceptions: Readonly<Record<string, string>>) {
  const pages = files.filter((file) => file.endsWith(`${sep}page.tsx`) || file === join(APP_ROOT, "page.tsx"));
  const loadings = new Set(
    files
      .filter((file) => file.endsWith(`${sep}loading.tsx`) || file === join(APP_ROOT, "loading.tsx"))
      .map((file) => file.slice(0, -"loading.tsx".length)),
  );
  const routes = pages.map(routeFor);

  return {
    routes,
    uncovered: pages.map((file) => [routeFor(file), file] as const).filter(([, file]) => {
      const directory = file.slice(0, -"page.tsx".length);
      return !loadings.has(directory) && !exceptions[routeFor(file)]?.trim();
    }).map(([route]) => route),
    staleExceptions: Object.keys(exceptions).filter((route) => !routes.includes(route)),
    redundantExceptions: pages.map((file) => [routeFor(file), file] as const).filter(([route, file]) => {
      return loadings.has(file.slice(0, -"page.tsx".length)) && route in exceptions;
    }).map(([route]) => route),
  };
}

describe("BBE-229 · 모든 앱 라우트가 로딩 정책을 명시한다", () => {
  const files = listFiles(APP_ROOT);

  it("파일시스템의 모든 page.tsx가 loading.tsx 또는 사유 있는 예외로 분류된다", () => {
    const coverage = loadingCoverage(files, LOADING_EXCEPTIONS);

    expect(coverage.routes.length).toBeGreaterThan(0);
    expect(coverage.uncovered).toEqual([]);
    expect(coverage.staleExceptions).toEqual([]);
    expect(coverage.redundantExceptions).toEqual([]);
  });

  it("새 라우트를 둘 중 어디에도 넣지 않으면 빨간불이 된다", () => {
    const mutantPage = join(APP_ROOT, "__bbe229_unclassified__", "page.tsx");
    const coverage = loadingCoverage([...files, mutantPage], LOADING_EXCEPTIONS);

    expect(coverage.uncovered).toEqual(["/__bbe229_unclassified__"]);
  });
});
