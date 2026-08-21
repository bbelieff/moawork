// BBE-229 — 새 page.tsx 는 loading.tsx 또는 사유가 적힌 예외 중 하나를 반드시 고른다.

import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_ROOT = fileURLToPath(new URL(".", import.meta.url));

const LOADING_EXCEPTIONS: Readonly<Record<string, string>> = {
  "/": "인증 뒤 작업공간 주소로 즉시 이동하는 진입 경로다.",
  "/account": "브라우저 저장소의 계정 설정만 읽는 클라이언트 화면이다.",
  "/companies/[companyId]": "상위 업체 목록의 로딩 경계를 그대로 사용한다.",
  "/dash": "선택된 파이프라인 주소로 즉시 이동하는 경유 경로다.",
  "/dash/[pipelineId]": "워크스페이스 셸 안에서 클라이언트 상태로 전환되는 화면이다.",
  "/dash/all": "워크스페이스 셸 안에서 클라이언트 상태로 전환되는 화면이다.",
  "/dash/tasks": "워크스페이스 셸 안에서 클라이언트 상태로 전환되는 화면이다.",
  "/deals/[dealId]": "클라이언트 저장소에서 거래 상세를 선택하는 화면이다.",
  "/ledger": "클라이언트 저장소 기반 원장 화면이라 서버 대기 구간이 없다.",
  "/notices/[noticeId]": "상위 공지 목록의 로딩 경계를 그대로 사용한다.",
  "/onboarding": "워크스페이스 생성 안내 전용 화면이다.",
  "/onboarding/practice": "로컬 연습 데이터로 동작하는 안내 화면이다.",
  "/settings/account/privacy": "상위 계정 설정의 로딩 경계를 그대로 사용한다.",
  "/settings/account/sessions": "상위 계정 설정의 로딩 경계를 그대로 사용한다.",
  "/settings/automations": "브라우저 저장소 기반 설정 화면이다.",
  "/settings/members/approvals": "상위 멤버 설정의 로딩 경계를 그대로 사용한다.",
  "/settings/notifications": "브라우저 저장소 기반 설정 화면이다.",
  "/settings/workspace-builder": "브라우저 저장소 기반 설정 화면이다.",
};

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

function routeFor(file: string): string {
  const directory = relative(APP_ROOT, file.slice(0, -"page.tsx".length)).split(sep).filter(Boolean);
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
