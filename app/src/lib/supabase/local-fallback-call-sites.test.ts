import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// BBE-203 — 폴백을 쓰는 «모든» 자리가 같은 규칙 하나를 통해서만 갈리게 못 박는다.
//
// 진짜 회귀 모양은 「폴백을 넣었다」가 아니라 **「누군가 규칙을 그 자리에서 다시 만든다」** 이다.
// `hasSupabaseEnv()` 만 보고 갈리면 개발에선 잘 돌지만 **운영에서 env 가 빠졌을 때 시드가 조용히 샌다.**
// 그 느슨한 규칙이 한 파일에서라도 되살아나면 경계가 뚫린다 — 그래서 파일 단위로 금지한다.
//
// 네 줄 규칙 자체는 `local-fallback.test.ts` 가 행위로 고정한다. 여기서는 «배선» 만 본다.
// (페이지는 서버 컴포넌트 + redirect 라 행위 테스트 비용이 과해서 배선으로 고정한다 — 한계를 그대로 적는다.)

// ★ BBE-186(PR #246) 이후 홈의 env 분기는 `(app)/page.tsx` 에 없다. 홈이 V6 «오늘» 로 바뀌면서
//   그 분기가 `lib/dash/today-server.ts` 로, 옛 대시보드 블록(체크리스트 포함)은 `(app)/dash/page.tsx`
//   로 **옮겨갔다.** 그래서 못 박는 자리도 같이 옮긴다 — 규칙을 «푸는» 게 아니라 «따라가는» 것이다.
//   자리 수는 3 → 4 로 늘었다. 줄었으면 그건 경계를 깎은 것이다.
const callSites = [
  "../dash/server.ts",
  "../dash/today-server.ts",
  "../../app/(app)/dash/page.tsx",
  "../../app/(app)/deals/[dealId]/page.tsx",
];

describe("local seed fallback call sites", () => {
  // 되돌리면 빨개진다: 어느 한 자리에서 canUseLocalSeedFallback() 대신 hasSupabaseEnv() 로 갈리게 하기
  it.each(callSites)("%s 는 공용 규칙 하나로만 갈린다", (relative) => {
    const source = readFileSync(new URL(relative, import.meta.url), "utf8");

    expect(source).toContain("canUseLocalSeedFallback");
    // ★ 느슨한 규칙을 그 자리에서 다시 만들지 못하게 한다.
    //   hasSupabaseEnv() 는 «env 가 있나» 만 답하고 «운영인가» 를 안 본다.
    expect(source).not.toMatch(/\bhasSupabaseEnv\s*\(/);
  });
});
