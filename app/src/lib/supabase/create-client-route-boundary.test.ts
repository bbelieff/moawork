import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const guardedSurfaces = [
  "src/app/(app)/presets/page.tsx",
  "src/app/(app)/work/page.tsx",
  "src/app/(app)/notices/page.tsx",
  "src/app/api/tab-views/route.ts",
  "src/app/api/tab-views/[viewId]/route.ts",
  "src/app/api/workspace-requests/handler.ts",
] as const;

const productionOnlySurfaces = [
  "src/app/auth/callback/route.ts",
  "src/app/platform/demo/page.tsx",
] as const;

describe("BBE-216 createClient 화면·라우트 경계", () => {
  it.each(guardedSurfaces)("%s 는 공용 개발 폴백 규칙을 소비한다", (path) => {
    const body = source(path);
    expect(body).toContain("canUseLocalSeedFallback");
    expect(body).not.toMatch(/\bhasSupabaseEnv\s*\(/);
  });

  it.each([
    "src/app/api/tab-views/[viewId]/route.ts",
    "src/app/api/workspace-requests/handler.ts",
  ])("%s 의 새 쓰기 가드는 운영 조건을 호출부에 명시한다", (path) => {
    expect(source(path)).toMatch(/process\.env\.NODE_ENV\s*!==\s*["']production["']/);
  });

  it("PATCH·DELETE와 workspace 쓰기 각각의 guard 수를 고정한다", () => {
    expect(source("src/app/api/tab-views/[viewId]/route.ts").match(/canUseLocalSeedFallback\(\)/g)).toHaveLength(2);
    expect(source("src/app/api/workspace-requests/handler.ts").match(/canUseLocalSeedFallback\(\)/g)).toHaveLength(1);
  });

  it("8개 판단 대상의 집합을 고정한다", () => {
    expect([...guardedSurfaces, ...productionOnlySurfaces]).toEqual([
      "src/app/(app)/presets/page.tsx",
      "src/app/(app)/work/page.tsx",
      "src/app/(app)/notices/page.tsx",
      "src/app/api/tab-views/route.ts",
      "src/app/api/tab-views/[viewId]/route.ts",
      "src/app/api/workspace-requests/handler.ts",
      "src/app/auth/callback/route.ts",
      "src/app/platform/demo/page.tsx",
    ]);
  });

  it("OAuth callback과 플랫폼 데모는 인증·권한 경계라 로컬 폴백을 열지 않는다", () => {
    const callback = source(productionOnlySurfaces[0]);
    const demo = source(productionOnlySurfaces[1]);
    expect(callback).toContain("exchangeCodeForSession");
    expect(demo).toContain("requirePlatformAccess");
    for (const body of [callback, demo]) {
      expect(body).not.toContain("canUseLocalSeedFallback");
      expect(body).not.toMatch(/\bhasSupabaseEnv\s*\(/);
    }
  });

  it("공용 연결 오류는 환경변수 이름과 로컬 파일 경로를 노출하지 않는다", () => {
    const env = source("src/lib/supabase/env.ts");
    const thrown = env.match(/throw new Error\(([^;]+)\)/)?.[1] ?? "";
    expect(thrown).toContain("서비스 연결 설정을 확인할 수 없습니다.");
    expect(thrown).not.toContain("NEXT_PUBLIC_");
    expect(thrown).not.toContain(".env");
  });
});
