import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadTodayHome } from "./today-server";

/**
 * BBE-186 후속 — 홈이 «원본 예외 메시지» 를 화면에 그리지 않는다.
 *
 * ★ 왜 테스트가 필요한가: 이 결함은 «주석이 약속하고 코드가 안 지킨» 형태였다.
 *   today-server.ts 의 주석은 「사람이 읽을 한 줄만 남긴다」고 적혀 있었는데 코드는
 *   `error.message` 를 그대로 돌려줬고, TodayHome 이 그것을 「사유:」로 그렸다.
 *   읽는 사람은 주석을 믿기 때문에 검수에서도 잘 안 잡힌다.
 *
 *   그리고 이건 재발이다 — BBE-209(#261)에서 `/api/tab-views` 가 흘리던 «같은 문자열» 이다.
 *   한 번 고친 것이 다른 자리에서 다시 났으므로, 고정하지 않으면 또 난다.
 */
describe("loadTodayHome — 원문 예외를 화면에 흘리지 않는다", () => {
  // env 가 없으면 `canUseLocalSeedFallback()` 이 참이라 try 에 닿기도 전에 unconfigured 로
  // 빠진다. 이 파일이 재려는 것은 «실패 경로» 이므로 env 를 채워 그 분기를 연다.
  const saved: Record<string, string | undefined> = {};
  const KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;
  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.test";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const throwing = (message: string) => async () => {
    throw new Error(message);
  };

  // 되돌리면 빨개진다: reason 을 error.message 로 되돌리기
  it("★ env 누락 원문이 reason 에 실리지 않는다", async () => {
    const state = await loadTodayHome("org-1", {
      clientFactory: throwing(
        "Supabase 환경변수 누락: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 를 설정하세요 (app/.env.local).",
      ) as never,
    });

    expect(state.kind).toBe("error");
    const reason = state.kind === "error" ? state.reason : "";
    expect(reason).not.toContain("NEXT_PUBLIC_SUPABASE");
    expect(reason).not.toContain(".env.local");
    expect(reason).not.toContain("환경변수 누락");
  });

  it("내부 구조(테이블·정책·SQLSTATE)도 실리지 않는다", async () => {
    const state = await loadTodayHome("org-1", {
      clientFactory: throwing('permission denied for table "item_values" (SQLSTATE 42501)') as never,
    });
    const reason = state.kind === "error" ? state.reason : "";
    expect(reason).not.toContain("item_values");
    expect(reason).not.toContain("42501");
  });

  it("대신 «읽기 실패» 를 사람 말로 알린다 — 저장 실패라고 거짓말하지 않는다", async () => {
    const state = await loadTodayHome("org-1", { clientFactory: throwing("boom") as never });
    const reason = state.kind === "error" ? state.reason : "";
    expect(reason).toContain("불러오지 못했어요");
    // 아무것도 저장하지 않았다. 「저장하지 못했어요」는 사실이 아니다.
    expect(reason).not.toContain("저장하지 못했어요");
  });
});
