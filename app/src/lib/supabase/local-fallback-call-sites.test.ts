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
//
// ★ 이 목록이 «전부» 인지 2026-08-18 에 전수로 셌다(BBE-203 후속).
//   목록에 `boardsRepo.ts` 가 빠져 있었고, 세어 보니 **빠진 게 하나가 아니라 넷**이었다.
//   기준: 「env 로 갈리고, 그 갈림의 한쪽이 로컬 시드 «데이터» 를 준다」.
//
//   목록 밖인 것과 그 이유(다음 사람이 다시 안 세도 되게 적는다):
//   · auth/session.ts       — 폴백 대상 `getDevSession()` 안에 자체 NODE_ENV 가드가 있다(fail-closed)
//   · perm/server.ts ×2     — 규칙을 «인라인» 으로 적어야 한다. 함수로 감싸면 경계 검사기의
//                             isInsideExplicitDevGuard 가 못 읽어 운영 위반으로 세어진다(그 파일 주석)
//   · companies/server.ts · notify/* · metrics/read.ts · platform/server.ts ·
//     entitlements/server.ts · workspace-entry/* · member-org-summary.ts
//                           — 시드가 아니라 «빈 값·미연결 상태» 를 준다. 위험 등급이 다르다
const callSites = [
  "../dash/server.ts",
  "../dash/today-server.ts",
  "../../app/(app)/dash/page.tsx",
  "../../app/(app)/deals/[dealId]/page.tsx",
  // ── 2026-08-18 추가. 전부 «운영에서 env 가 빠지면 시드가 조용히 새는» 자리였다 ──
  "../repo/local/boardsRepo.ts",
  "../boards/default-tab-assignees.ts",
  "../deal/members.ts",
  "../deal/comments.ts",
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
