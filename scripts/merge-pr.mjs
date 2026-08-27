#!/usr/bin/env node
/**
 * merge-pr — 「그 exact head 에 CI 초록이 있는가」를 «기계가» 확인하고 머지한다.
 *
 * ★ 왜 이 스크립트가 필요한가
 *   `AGENTS.md §7` 의 실행 체인은 「④ push → PR → CI 초록」을 전제한다. 그런데 그걸
 *   강제하는 것이 아무것도 없었다. GitHub 의 브랜치 보호(required status check)를
 *   걸면 되지만, 이 저장소는 «비공개 + 무료 플랜» 이라 그 기능이 잠겨 있다:
 *
 *     GET /repos/.../branches/main/protection
 *       → 403 "Upgrade to GitHub Pro or make this repository public"
 *
 *   공개 전환은 답이 아니다 — 히스토리에 첫 고객 자료가 영구 보존돼 있고
 *   (.github/workflows/ci.yml 주석의 실측), 셀프호스티드 러너까지 붙어 있어
 *   포크 PR 이 데스크탑에서 임의 코드를 돌릴 수 있게 된다.
 *
 *   그래서 GitHub 이 못 막는 자리를 «우리 도구» 가 막는다.
 *
 * ★ 2026-08-27 에 이 관문이 없어서 실제로 일어난 일
 *   · CI 실행이 5회 취소됐는데 아무도 못 알아챘다(feat/573 3회 · codex 1회 · main 1회)
 *   · force-push 로 덮인 head 하나는 CI 실행이 끝내 0건이었다 — 검증 안 된 채 사라졌다
 *   · PR 체크 목록에는 GitGuardian·Vercel 이 초록으로 떠 「전부 통과」처럼 보였다
 *   빨간불이 아니라 «불이 없는» 상태라 눈에 안 띈다. 그게 이 관문이 막는 것이다.
 *
 * 쓰는 법
 *   node scripts/merge-pr.mjs <PR번호>
 *   node scripts/merge-pr.mjs <PR번호> --dry-run   판정만 하고 머지하지 않는다
 *   node scripts/merge-pr.mjs --self-test          판정 로직을 자체 검사한다
 *
 * ★ 한계 — 적어 두지 않으면 «막힌다» 고 오해한다
 *   웹 UI 의 Merge 버튼이나 `gh pr merge` 를 직접 부르면 이 관문을 지나지 않는다.
 *   그래서 AGENTS.md §7 이 「머지는 이 스크립트로만」이라고 못박아야 완성된다.
 *   Pro 로 올라가면 required status check 로 옮기고 이 스크립트는 지운다.
 */

import { execFileSync } from "node:child_process";

/**
 * CI 워크플로를 «파일 경로» 로 고른다 — 표시 이름이 아니라.
 *
 * ★ 이름(`name: CI`)으로 고르면 속일 수 있다. PR 은 «그 브랜치의» 워크플로를 돌리므로,
 *   `.github/workflows/decoy.yml` 에 `name: CI` 와 빈 잡을 넣으면 그 PR 에서
 *   「CI 라는 이름의 초록」이 하나 더 생긴다. 진짜 CI 가 빨개도 통과하게 된다.
 *   경로는 그 PR 이 바꿔도 «어느 파일인지» 가 그대로 드러난다.
 *
 * ★ 이름으로 고르면 반대 방향으로도 깨진다 — ci.yml 에 `run-name:` 을 넣는 순간
 *   `name` 이 바뀌어 실행을 0건으로 보고 영원히 막는다.
 */
export const CI_WORKFLOW_PATH = ".github/workflows/ci.yml";

/**
 * PR 을 검증하는 실행은 «pull_request» 여야 한다.
 *
 * ★ 이게 이 관문의 핵심이다. 같은 head_sha 라도 이벤트에 따라 «다른 트리» 를 검사한다:
 *     pull_request      → refs/pull/N/merge   (main 과 합친 결과)
 *     workflow_dispatch → 그 브랜치 head      (합치기 전)
 *   즉 「합쳐야만 깨지는」 PR 은 dispatch 로는 초록이 나온다.
 *   dispatch 초록만으로 통과시키면 `gh workflow run` 한 번으로 관문을 지날 수 있다.
 */
export const REQUIRED_EVENT = "pull_request";

/**
 * 머지해도 되는가 — 순수 판정.
 *
 * 저장소·네트워크를 모른다. 입력만 보고 답한다. 그래야 테스트가 돈다.
 *
 * @param {{state?: string, isDraft?: boolean, mergeStateStatus?: string, headRefOid?: string}} pr
 * @param {Array<{name?: string, status?: string, conclusion?: string|null, head_sha?: string}>} runs
 *   그 PR head 의 워크플로 실행 목록. GitHub Actions API 응답 모양 그대로.
 * @returns {{ok: boolean, reason: string}}
 */
export function mergeDecision(pr, runs) {
  if (!pr || typeof pr !== "object") return { ok: false, reason: "PR 정보를 읽지 못했습니다." };

  const state = String(pr.state || "").toUpperCase();
  if (state !== "OPEN") return { ok: false, reason: `PR 이 열려 있지 않습니다 (${state || "알 수 없음"}).` };
  if (pr.isDraft) return { ok: false, reason: "초안(draft) PR 입니다. Ready for review 로 바꾼 뒤 머지합니다." };

  const head = String(pr.headRefOid || "");
  if (!/^[0-9a-f]{40}$/.test(head)) return { ok: false, reason: "PR 의 head SHA 를 확인하지 못했습니다." };

  // ★ base 를 확인한다. 이 관문은 «main 으로 들어가는 것» 을 지키라고 만든 것이다.
  //   전에는 base 를 조회조차 하지 않아, 아무 브랜치로 가는 PR 도 그냥 머지했다.
  const base = String(pr.baseRefName || "");
  if (base && base !== "main") {
    return { ok: false, reason: `base 가 main 이 아닙니다 (${base}). 이 관문은 main 행만 판정합니다.` };
  }

  // ★ 충돌은 CI 보다 «먼저» 본다. 충돌난 PR 의 CI 초록은 다른 트리의 초록이다.
  const mergeState = String(pr.mergeStateStatus || "").toUpperCase();
  if (mergeState === "DIRTY") return { ok: false, reason: "main 과 충돌합니다. rebase 로 해소한 뒤 다시 시도합니다." };
  if (mergeState === "BLOCKED") return { ok: false, reason: "저장소 규칙이 머지를 막고 있습니다." };
  // UNKNOWN = GitHub 이 머지 가능 여부를 «아직 계산하지 않았다».
  //   그 상태에서는 위 DIRTY 판정이 통째로 무의미하다 — 충돌이 있어도 안 보인다.
  //   모르는 채로 통과시키지 않는다. 잠시 뒤 다시 부르면 계산돼 있다.
  if (mergeState === "UNKNOWN" || mergeState === "") {
    return { ok: false, reason: "GitHub 이 머지 가능 여부를 아직 계산하지 않았습니다(UNKNOWN). 잠시 뒤 다시 시도합니다." };
  }
  // UNSTABLE 은 막지 않는다 — 이 저장소의 열린 PR 은 «전부» UNSTABLE 이다(실측).
  //   대신 어떤 검사가 빨간지는 아래 statusCheckRollup 으로 직접 본다. 그쪽이 정확하다.

  // ★ 다른 체크가 «빨간» 상태면 막는다.
  //   GitGuardian(비밀값 스캔)·Vercel 이 여기 들어온다. CLAUDE.md 의 「절대 금지 2가지」 중
  //   하나가 비밀값이므로, 그 스캔이 빨간데 머지되는 일이 있어선 안 된다.
  //   mergeStateStatus 로는 못 잡는다 — 이 저장소의 열린 PR 은 전부 UNSTABLE 이라
  //   그 값으로 막으면 아무것도 못 머지한다. 그래서 체크를 직접 본다.
  const failing = (Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : []).filter((check) => {
    const verdict = String(check?.conclusion || check?.state || "").toUpperCase();
    return verdict === "FAILURE" || verdict === "TIMED_OUT" || verdict === "ERROR" || verdict === "ACTION_REQUIRED";
  });
  if (failing.length > 0) {
    const names = failing.map((check) => String(check?.name || check?.context || "?")).join(", ");
    return { ok: false, reason: `다른 검사가 빨갛습니다 — ${names}. 고친 뒤 머지합니다.` };
  }

  const list = Array.isArray(runs) ? runs : [];
  // ★ «그 exact head» 의 실행만 센다. head_sha 가 없으면 «모른다» 이지 «일치» 가 아니다.
  //   전에는 (!run?.head_sha || ...) 로 «없으면 통과» 였다 — 이 관문이 존재하는 이유
  //   바로 그것(force-push 로 갈아끼운 트리)을 기본값으로 열어 두고 있었다.
  //   덧붙여 gh 의 두 API 가 필드 이름이 다르다: actions/runs 는 head_sha,
  //   `gh run list --json` 은 headSha. 데이터 출처를 바꾸는 사람이 이 차이를 모르면
  //   조용히 «아무 초록이나 통과» 가 된다. 그래서 엄격히 비교한다.
  const mine = list.filter(
    (run) => String(run?.path || "") === CI_WORKFLOW_PATH && String(run?.head_sha || "") === head,
  );

  if (mine.length === 0) {
    return { ok: false, reason: `이 head(${head.slice(0, 7)})에 CI(${CI_WORKFLOW_PATH}) 실행이 «하나도 없습니다». 아직 안 붙었을 수 있으니 기다렸다가 다시 확인합니다.` };
  }

  // ★ 이벤트별로 «가장 최근» 실행만 본다.
  //   전에는 「초록이 하나라도 있으면 통과」였다. 그래서 이렇게 뚫린다:
  //     ① PR 실행이 빨갛다  ② gh workflow run 으로 dispatch 를 돌린다(그 브랜치 head 를 검사)
  //     ③ dispatch 초록이 생긴다  ④ 관문 통과
  //   같은 구멍이 악의 없이도 열린다 — 옛 초록이 새 빨강을 덮는다.
  const newest = new Map();
  for (const run of mine) {
    const lane = String(run?.event || "?");
    const at = Date.parse(run?.run_started_at || run?.created_at || "") || Number(run?.id) || 0;
    const prev = newest.get(lane);
    if (!prev || at >= prev.at) newest.set(lane, { at, run });
  }

  const lanes = [...newest.entries()].map(([lane, entry]) => ({ lane, run: entry.run }));
  const required = lanes.find((entry) => entry.lane === REQUIRED_EVENT);
  if (!required) {
    return { ok: false, reason: `이 head 에 «${REQUIRED_EVENT}» CI 실행이 없습니다. 브랜치만 검사한 실행(예: workflow_dispatch)으로는 통과시키지 않습니다 — main 과 합친 트리를 검사하지 않기 때문입니다.` };
  }

  const stillRunning = lanes.filter((entry) => String(entry.run.status) !== "completed");
  if (stillRunning.length > 0) {
    return { ok: false, reason: `CI 가 아직 도는 중입니다 (${stillRunning.map((entry) => entry.lane).join(", ")}). 끝난 뒤 다시 시도합니다.` };
  }

  const notGreen = lanes.filter((entry) => String(entry.run.conclusion) !== "success");
  if (notGreen.length > 0) {
    const detail = notGreen.map((entry) => `${entry.lane}:${entry.run.conclusion || "-"}`).join(", ");
    return { ok: false, reason: `CI 최신 실행이 초록이 아닙니다 (${detail}). 재실행하거나 원인을 고친 뒤 머지합니다.` };
  }

  return { ok: true, reason: `CI success · head ${head.slice(0, 7)} · 이벤트 ${lanes.map((entry) => entry.lane).join("+")}` };
}

/**
 * gh 호출 — 실패하면 «한 줄» 로 말하고 멈춘다.
 *
 * 전에는 execFileSync 의 스택과 output 배열이 그대로 튀어나왔다. 판정을 읽으라고
 * 만든 도구가 스택을 뱉으면 사람이 「관문이 통과했나 아닌가」를 읽지 못한다.
 * 어느 경우든 머지는 «하지 않는다» — 못 읽었으면 통과가 아니다.
 */
function gh(args, what) {
  try {
    return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  } catch (error) {
    const detail = String(error?.stderr || error?.message || "").trim().split("\n")[0];
    console.error(`  ${what} 을(를) 읽지 못했습니다 — ${detail || "gh 실행 실패"}`);
    console.error("  머지하지 않았습니다. gh 로그인·네트워크·PR 번호를 확인해 주세요.");
    process.exit(1);
  }
}

const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);
/** 정상 PR — 각 검사에서 «하나만» 비틀어 무엇이 판정을 바꾸는지 드러낸다. */
const OK_PR = { state: "OPEN", headRefOid: HEAD_A, baseRefName: "main", mergeStateStatus: "UNSTABLE", statusCheckRollup: [] };
/** 정상 CI 실행 — pull_request 이벤트 · ci.yml · 그 head · 초록. */
function run(over = {}) {
  return {
    path: CI_WORKFLOW_PATH,
    head_sha: HEAD_A,
    event: REQUIRED_EVENT,
    status: "completed",
    conclusion: "success",
    created_at: "2026-08-27T00:00:00Z",
    ...over,
  };
}

function selfTest() {
  const cases = [
    // ── 통과해야 하는 것 ──────────────────────────────────────────
    ["정상 — pull_request CI 초록", OK_PR, [run()], true],
    ["실패 뒤 «재실행» 초록이면 통과한다", OK_PR,
      [run({ conclusion: "failure", created_at: "2026-08-27T00:00:00Z" }),
       run({ created_at: "2026-08-27T01:00:00Z" })], true],
    ["pull_request 초록 + dispatch 초록이면 통과", OK_PR,
      [run(), run({ event: "workflow_dispatch" })], true],

    // ── ★ 검수가 찾은 우회 경로 ───────────────────────────────────
    ["★ PR 이 빨간데 dispatch 를 돌려 통과시킬 수 없다 — gh workflow run 한 번이면 뚫리던 구멍", OK_PR,
      [run({ conclusion: "failure" }),
       run({ event: "workflow_dispatch", created_at: "2026-08-27T02:00:00Z" })], false],
    ["★ 옛 초록이 새 빨강을 덮지 못한다", OK_PR,
      [run({ created_at: "2026-08-27T00:00:00Z" }),
       run({ conclusion: "failure", created_at: "2026-08-27T01:00:00Z" })], false],
    ["★ 초록이 있어도 «도는 중» 이 있으면 기다린다", OK_PR,
      [run({ created_at: "2026-08-27T00:00:00Z" }),
       run({ status: "in_progress", conclusion: null, created_at: "2026-08-27T01:00:00Z" })], false],
    ["★ head_sha 가 없으면 «모른다» 이지 «일치» 가 아니다", OK_PR, [run({ head_sha: undefined })], false],
    ["★ head_sha 가 빈 문자열이어도 통과하지 않는다", OK_PR, [run({ head_sha: "" })], false],
    ["★ headSha(camelCase)만 있으면 통과하지 않는다 — gh run list 로 갈아타도 안전하게", OK_PR,
      [{ ...run({ head_sha: undefined }), headSha: HEAD_A }], false],
    ["★ 이름만 CI 인 가짜 워크플로로는 통과하지 않는다", OK_PR,
      [run({ conclusion: "failure" }),
       run({ path: ".github/workflows/decoy.yml", name: "CI", created_at: "2026-08-27T02:00:00Z" })], false],
    ["★ dispatch 초록«만» 있으면 통과하지 않는다 — 합친 트리를 검사하지 않는다", OK_PR,
      [run({ event: "workflow_dispatch" })], false],
    ["★ 다른 커밋의 초록으로는 통과하지 않는다", OK_PR, [run({ head_sha: HEAD_B })], false],
    ["★ GitGuardian 이 빨가면 막는다 — 비밀값 금지는 절대 금지 2가지 중 하나다",
      { ...OK_PR, statusCheckRollup: [{ name: "GitGuardian Security Checks", conclusion: "FAILURE" }] },
      [run()], false],
    ["★ mergeStateStatus UNKNOWN 이면 충돌 판정이 무의미하므로 막는다",
      { ...OK_PR, mergeStateStatus: "UNKNOWN" }, [run()], false],
    ["★ base 가 main 이 아니면 막는다", { ...OK_PR, baseRefName: "develop" }, [run()], false],

    // ── 기본 방어 ────────────────────────────────────────────────
    ["실행이 아예 없으면 통과가 아니다", OK_PR, [], false],
    ["취소는 초록이 아니다 — 2026-08-27 에 5회 일어났다", OK_PR, [run({ conclusion: "cancelled" })], false],
    ["충돌이면 CI 초록이어도 막는다", { ...OK_PR, mergeStateStatus: "DIRTY" }, [run()], false],
    ["닫힌 PR 은 막는다", { ...OK_PR, state: "CLOSED" }, [run()], false],
    ["초안은 막는다", { ...OK_PR, isDraft: true }, [run()], false],
    ["실행 목록이 배열이 아니면 막는다 — API 오류를 통과로 읽지 않는다", OK_PR, { message: "rate limit" }, false],
    ["PR 정보가 없으면 막는다", null, [run()], false],
  ];

  let failed = 0;
  for (const [label, pr, runs, expected] of cases) {
    const got = mergeDecision(pr, runs);
    if (got.ok !== expected) {
      failed += 1;
      console.error(`✖ ${label}\n    기대 ok=${expected} · 실제 ok=${got.ok} — ${got.reason}`);
    } else {
      console.log(`✔ ${label}`);
    }
  }
  if (failed) {
    console.error(`merge-pr self-test 실패 ${failed}건`);
    process.exit(1);
  }
  console.log(`merge-pr self-test: ${cases.length}건 통과`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) return selfTest();

  const number = args.find((arg) => /^\d+$/.test(arg));
  if (!number) {
    console.error("쓰는 법: node scripts/merge-pr.mjs <PR번호> [--dry-run]");
    process.exit(2);
  }
  const dryRun = args.includes("--dry-run");

  const pr = JSON.parse(
    gh(
      ["pr", "view", number, "--json", "state,isDraft,mergeStateStatus,headRefOid,baseRefName,title,statusCheckRollup"],
      `PR #${number}`,
    ),
  );
  // 저장소를 박아 두지 않는다 — PR 조회는 cwd 로, 실행 조회는 하드코딩이면 둘이 어긋날 수 있다.
  const repo = JSON.parse(gh(["repo", "view", "--json", "nameWithOwner"], "저장소 이름")).nameWithOwner;
  // --paginate 로 전부 받는다. 한 SHA 에 실행이 50개를 넘으면(재실행을 반복하면 넘는다)
  // 잘린 목록에서 CI 가 빠져 «실행 없음» 으로 막히거나, 더 나쁘게는 최신 실행을 놓친다.
  const runs = JSON.parse(
    gh(
      ["api", "--paginate", `repos/${repo}/actions/runs?head_sha=${pr.headRefOid}&per_page=100`, "--jq", ".workflow_runs"],
      "CI 실행 목록",
    ),
  );

  const decision = mergeDecision(pr, runs);
  console.log(`PR #${number} — ${pr.title || ""}`);
  console.log(`  head ${String(pr.headRefOid).slice(0, 7)} · ${pr.mergeStateStatus}`);
  console.log(`  판정: ${decision.ok ? "통과" : "머지 안 함"} — ${decision.reason}`);

  if (!decision.ok) process.exit(1);
  if (dryRun) {
    console.log("  --dry-run 이라 머지하지 않았습니다.");
    return;
  }

  // ★ --match-head-commit 을 반드시 넘긴다. 판정한 트리와 머지되는 트리가 같아야 한다.
  //   그 사이에 누가 push 하면 GitHub 이 거절한다 — 그게 옳다.
  gh(["pr", "merge", number, "--squash", "--match-head-commit", pr.headRefOid]);
  console.log(`  머지했습니다 — squash · head ${String(pr.headRefOid).slice(0, 7)}`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("merge-pr.mjs")) main();
