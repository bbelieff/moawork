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

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SRC = fileURLToPath(new URL("../..", import.meta.url));

// ★ 이 목록은 «지금 main 의 실제» 다 — 손으로 고른 게 아니라 아래 전수 대조가 강제한다.
//   #265 가 네 자리(boardsRepo · default-tab-assignees · deal/members · deal/comments)에
//   가드를 새로 넣는데, 그때 이 목록에 안 적으면 아래 대조가 그 «이름을 말하며» 빨개진다.
//   즉 이 목록은 이제 «따라오게» 돼 있다.
const callSites = [
  "../boards/server.ts",
  "../dash/server.ts",
  "../dash/today-server.ts",
  "../../app/(app)/dash/page.tsx",
  "../../app/(app)/deals/[dealId]/page.tsx",
  "../../app/(app)/presets/page.tsx",
  "../../app/(app)/work/page.tsx",
  "../../app/api/tab-views/route.ts",
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
