import { afterEach, describe, expect, it, vi } from "vitest";
import { canUseLocalSeedFallback } from "./local-fallback";

// BBE-203 — 폴백 «판단» 자체를 네 줄로 못 박는다.
//
// 왜 따로 두는가: `loadDashboardPageData` 쪽 행위 테스트는 운영+env없음 경로에서
// cookies() 가 먼저 걸려 «어떤 오류인지» 를 단언할 수 없다. 그래서 그쪽은
// 「던진다 · 로컬을 안 건드린다」만 고정하고, **결정 규칙은 여기서 정확히** 고정한다.
//
// ★ 2행이 이 카드의 안전 성질이다 — 운영에서 env 가 빠져도 시드로 떨어지지 않는다.
//   그게 깨지면 사용자 화면에 남의 시드 숫자가 «오류 없이» 뜬다.

function setEnv(present: boolean) {
  if (present) {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-anon-test-key");
  } else {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  }
}

describe("canUseLocalSeedFallback — 네 줄 규칙", () => {
  afterEach(() => vi.unstubAllEnvs());

  // 되돌리면 빨개진다: 조건을 hasSupabaseEnv() 만 보도록 되돌리기
  it("② 운영 빌드 + env 없음 → 폴백 금지 (★ 경계의 핵심)", () => {
    vi.stubEnv("NODE_ENV", "production");
    setEnv(false);
    expect(canUseLocalSeedFallback()).toBe(false);
  });

  it("① 운영 빌드 + env 있음 → 폴백 금지", () => {
    vi.stubEnv("NODE_ENV", "production");
    setEnv(true);
    expect(canUseLocalSeedFallback()).toBe(false);
  });

  // 되돌리면 빨개진다: 폴백을 통째로 없애기
  it("③ 개발 빌드 + env 없음 → 폴백 허용 (이것만 새로 열린다)", () => {
    vi.stubEnv("NODE_ENV", "development");
    setEnv(false);
    expect(canUseLocalSeedFallback()).toBe(true);
  });

  // 되돌리면 빨개진다: env 검사를 빼고 NODE_ENV 만 보게 하기
  it("④ 개발 빌드 + env 있음 → 폴백 금지 (실 DB 가 있으면 그걸 쓴다)", () => {
    vi.stubEnv("NODE_ENV", "development");
    setEnv(true);
    expect(canUseLocalSeedFallback()).toBe(false);
  });
});
