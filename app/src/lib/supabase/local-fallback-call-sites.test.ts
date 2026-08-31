import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// BBE-203 — 폴백을 쓰는 «모든» 자리가 같은 규칙 하나를 통해서만 갈리게 못 박는다.
//
// 진짜 회귀 모양은 「폴백을 넣었다」가 아니라 **「누군가 규칙을 그 자리에서 다시 만든다」** 이다.
// `hasSupabaseEnv()` 만 보고 갈리면 개발에선 잘 돌지만 **운영에서 env 가 빠졌을 때 시드가 조용히 샌다.**
// 그 느슨한 규칙이 한 파일에서라도 되살아나면 경계가 뚫린다 — 그래서 파일 단위로 금지한다.
//
// 네 줄 규칙 자체는 `local-fallback.test.ts` 가 행위로 고정한다. 여기서는 «배선» 만 본다.
// (페이지는 서버 컴포넌트 + redirect 라 행위 테스트 비용이 과해서 배선으로 고정한다 — 한계를 그대로 적는다.)
//
// ── BBE-220: 목록이 «자기가 놓친 것» 을 세게 한다 ─────────────────────────────
// 전에는 이 배열에 적힌 파일«만» 검사했다. 그래서 새 사용처가 생겨도 **목록은 초록인 채로
// 지나갔다.** 2026-08-18 실측: 실제 사용처 12곳인데 배열에는 8곳(그 전에는 4곳)만 있었고,
// 빠진 자리는 사람 셋이 세 번 세어서야 나왔다. 그중 `boards/server.ts` 는 보드 상세 화면과
// 보드 액션 «전부» 가 쓰는 자리였다.
//
// ★ 그래서 처치는 「목록을 늘린다」가 아니라 **「목록과 실제를 대조한다」** 다.
//   늘리기만 하면 다음 사용처에서 똑같이 초록으로 지나간다.
//
// ★★ 판정 기준(A) — **「이 파일이 폴백 규칙으로 갈리는가」**. 무엇을 «돌려주는가» 는 안 본다.
//   이 장치가 막는 것은 «시드 데이터 유출» 이 아니라 **«느슨한 규칙의 부활»** 이고,
//   그건 반환값과 무관하다. 빈 배열·「연결 안 됨」 을 주는 자리도 `hasSupabaseEnv()` 로 바뀌면
//   **운영에서 조용해진다** — 시끄럽게 실패해야 할 자리에서. 「빈 값을 준다」는 무해한 것이
//   아니라 **다른 방식으로 조용한 것**이다.

// ★ BBE-186(PR #246) 이후 홈의 env 분기는 `(app)/page.tsx` 에 없다. 홈이 V6 «오늘» 로 바뀌면서
//   그 분기가 `lib/dash/today-server.ts` 로, 옛 대시보드 블록(체크리스트 포함)은 `(app)/dash/page.tsx`
//   로 **옮겨갔다.** 그래서 못 박는 자리도 같이 옮긴다 — 규칙을 «푸는» 게 아니라 «따라가는» 것이다.
//   자리 수는 3 → 4 로 늘었다. 줄었으면 그건 경계를 깎은 것이다.
//
// ★ 후보 기준 (A) — 「**이 파일이 폴백 규칙으로 갈린다**」. 반환값은 보지 않는다.
//
//   한때 기준 (B)「갈림의 한쪽이 로컬 시드 «데이터» 를 준다」로 세어 8개만 담았다가
//   독립 계수에서 12로 정정됐다(2026-08-18). B 는 틀린 기준이다 — 이 파일 머리가 적은
//   목적이 「폴백을 쓰는 «모든» 자리가 같은 규칙 하나로만 갈리게」이고, 막는 대상은
//   **«느슨한 규칙의 부활»** 이지 반환값이 아니기 때문이다.
//
//   ★ 「빈 값을 준다」는 무해한 것이 아니라 «다른 방식으로 조용한 것» 이다.
//     시드 유출은 **없는 데이터를 있다고** 하고, 빈 값은 **있는 데이터를 없다고** 한다.
//     둘 다 운영에서는 시끄럽게 실패해야 할 자리다. 그래서 둘 다 못을 박는다.
//
//   ※ 세는 법: **목록을 검산하지 말고 트리에서 후보를 다시 뽑아라.**
//     목록을 검산하면 「이 중 틀린 게 있나」만 알 수 있고, 「빠진 게 있나」는 못 본다.
//     8→12 로 어긋난 원인이 정확히 그것이었다.
//
//   목록 밖인 것과 그 이유(다음 사람이 다시 안 세도 되게 적는다):
//   · auth/session.ts       — 폴백 대상 `getDevSession()` 안에 자체 NODE_ENV 가드가 있다(fail-closed)
//   · perm/server.ts ×2     — 규칙을 «인라인» 으로 적어야 한다. 함수로 감싸면 경계 검사기의
//                             isInsideExplicitDevGuard 가 못 읽어 운영 위반으로 세어진다(그 파일 주석)
//   ※ 위 둘은 «제외» 이지 «누락» 이 아니다. 규칙으로 갈리지만 그 규칙을 여기 못 박으면
//     오히려 깨지는 자리라서 뺐다. 이 구분이 안 적혀 있으면 다음 사람이 누락으로 오해한다.

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SRC = fileURLToPath(new URL("../..", import.meta.url));
const callSites = [
  "../boards/server.ts",
  "../dash/server.ts",
  "../dash/today-server.ts",
  "../custom/server.ts",
  "../policyfund/checklist/actions.ts",
  // ★ BBE-215 — 「업무 분석」이 홈의 «회사 현황» 절이 되면서 이 가드가 그 컴포넌트로 옮겨갔다.
  //   (app)/dash/page.tsx 는 이제 redirect 뿐이라 폴백 규칙으로 갈리지 않는다.
  //   못 박는 자리는 «코드를 따라간다» — 지우는 게 아니다. 자리 수는 12 그대로다.
  "../../components/dash/CompanyStatusSection.tsx",
  "../../app/(app)/deals/[dealId]/page.tsx",
  // ── 2026-08-18 추가 ① 시드가 조용히 새던 자리 (BBE-203 후속) ──
  "../repo/local/boardsRepo.ts",
  "../boards/default-tab-assignees.ts",
  "../deal/members.ts",
  "../deal/comments.ts",
  // ── 2026-08-18 추가 ② 독립 계수(DC-12)가 찾아낸 자리. 기준 A 로 정정하며 담는다 ──
  //    ★ boards/server.ts 가 가장 무겁다 — createRequestBoards() 는 «보드 상세 화면과
  //      보드 액션 전부» 가 쓴다. 여기서 규칙이 느슨해지면 운영에서 보드 데이터가
  //      통째로 로컬 시드로 나간다. BBE-203 이 막으려던 바로 그 자리인데 못이 없었다.
  "../../app/(app)/(tabs)/presets/page.tsx",
  // 2026-08-25(#551) — `(tabs)/work/page.tsx` 를 «뺐다». 조용히 지운 것이 아니다:
  //   그 화면이 «그리는 페이지» 에서 «리다이렉트» 로 바뀌어(리드컨택과 같은 형태)
  //   로컬 폴백을 판단할 자리 자체가 없어졌다. 목적지인 `/boards/[id]` 가 그 판단을 갖는다.
  // BBE-210 — render와 command가 같은 dev-only work source를 소비해야 저장 후 refresh가 보존된다.
  "../../app/(app)/(tabs)/work/actions.ts",
  "../../app/(app)/(tabs)/notices/page.tsx",
  "../../app/api/tab-views/route.ts",
  "../../app/api/tab-views/[viewId]/route.ts",
  "../../app/api/workspace-requests/handler.ts",
];

/** 규칙을 «정의» 하는 파일과 테스트는 사용처가 아니다. */
const NOT_A_CALL_SITE = /(\.test\.tsx?$)|(local-fallback\.ts$)/;

/**
 * `canUseLocalSeedFallback` 을 실제로 «호출» 하는 파일 전부 — 목록이 아니라 «저장소» 에게 묻는다.
 * ★ 이름이 스쳐 지나가는 것(import 만 · 주석)은 세지 않는다. 갈림이 «일어나는» 자리만 센다.
 */
function actualCallSites(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".next") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(full) || NOT_A_CALL_SITE.test(full)) continue;
      if (/canUseLocalSeedFallback\s*\(/.test(readFileSync(full, "utf8"))) found.push(full);
    }
  };
  walk(SRC);
  return found.map((file) => relative(SRC, file).split(sep).join("/")).sort();
}

/** 목록의 상대경로를 `actualCallSites()` 와 같은 표기로 맞춘다. */
function listedCallSites(): string[] {
  return callSites.map((rel) => relative(SRC, join(HERE, rel)).split(sep).join("/")).sort();
}

describe("local seed fallback call sites", () => {
  // 되돌리면 빨개진다: 어느 한 자리에서 canUseLocalSeedFallback() 대신 hasSupabaseEnv() 로 갈리게 하기
  it.each(callSites)("%s 는 공용 규칙 하나로만 갈린다", (relativePath) => {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");

    expect(source).toContain("canUseLocalSeedFallback");
    // ★ 느슨한 규칙을 그 자리에서 다시 만들지 못하게 한다.
    //   hasSupabaseEnv() 는 «env 가 있나» 만 답하고 «운영인가» 를 안 본다.
    expect(source).not.toMatch(/\bhasSupabaseEnv\s*\(/);
  });

  // ★ 되돌리면 빨개진다: 새 파일에서 폴백으로 갈리게 하고 목록에 안 적기.
  //   위의 it.each 는 «적힌 것» 만 읽으므로 이 대조가 없으면 빠뜨림이 초록으로 지나간다.
  //
  //   ★★ 개수가 아니라 «집합» 으로 본다. 개수만 맞추면 한 줄을 지우고 다른 줄을 더한
  //      상태가 통과한다 — 그러면 지워진 자리가 조용히 무방비가 된다.
  //      그래서 양방향 차집합을 «둘 다» 보고, 어긋난 파일을 이름으로 말한다.
  it("★ 목록과 실제가 «집합으로» 같다 — 어긋나면 이름을 말한다", () => {
    const actual = actualCallSites();
    const listed = listedCallSites();

    const missing = actual.filter((file) => !listed.includes(file));
    const stale = listed.filter((file) => !actual.includes(file));

    expect(missing, `목록에 없는 폴백 사용처 — 여기에 적어라: ${missing.join(", ")}`).toEqual([]);
    expect(stale, `목록에 있는데 더 이상 폴백으로 갈리지 않는 파일 — 목록에서 빼라: ${stale.join(", ")}`).toEqual([]);
  });

  // ★ 계측기 자신을 잰다: 스캐너가 조용히 아무것도 못 찾으면 위 대조는
  //   «양쪽 다 빈 배열» 로 통과한다. 「판정 불능을 통과로 접지 마라」가 이 파일에도 걸린다.
  it("★ 전수 스캐너가 실제로 파일을 훑는다 — 0개를 훑고 통과하지 않는다", () => {
    expect(actualCallSites().length).toBeGreaterThanOrEqual(callSites.length);
  });
});
