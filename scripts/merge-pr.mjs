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

/** CI 워크플로 이름 — .github/workflows/ci.yml 의 `name:` 과 같아야 한다. */
export const CI_WORKFLOW_NAME = "CI";

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

  // ★ 충돌은 CI 보다 «먼저» 본다. 충돌난 PR 의 CI 초록은 다른 트리의 초록이다.
  const mergeState = String(pr.mergeStateStatus || "").toUpperCase();
  if (mergeState === "DIRTY") return { ok: false, reason: "main 과 충돌합니다. rebase 로 해소한 뒤 다시 시도합니다." };
  if (mergeState === "BLOCKED") return { ok: false, reason: "저장소 규칙이 머지를 막고 있습니다." };

  const list = Array.isArray(runs) ? runs : [];
  // ★ «그 exact head» 의 실행만 센다.
  //   head_sha 를 안 보면 이전 커밋의 초록으로 지금 트리를 통과시키게 된다 —
  //   force-push 로 브랜치를 갈아끼운 순간 그게 곧 «검증 안 된 머지» 다.
  const mine = list.filter(
    (run) => String(run?.name) === CI_WORKFLOW_NAME && (!run?.head_sha || String(run.head_sha) === head),
  );

  if (mine.length === 0) {
    return { ok: false, reason: `이 head(${head.slice(0, 7)})에 ${CI_WORKFLOW_NAME} 실행이 «하나도 없습니다». 아직 안 붙었을 수 있으니 기다렸다가 다시 확인합니다.` };
  }

  const pending = mine.filter((run) => String(run.status) !== "completed");
  const success = mine.filter((run) => String(run.conclusion) === "success");
  if (success.length > 0) {
    return { ok: true, reason: `${CI_WORKFLOW_NAME} success · head ${head.slice(0, 7)}` };
  }
  if (pending.length > 0) {
    return { ok: false, reason: `${CI_WORKFLOW_NAME} 가 아직 도는 중입니다 (${pending.length}건). 끝난 뒤 다시 시도합니다.` };
  }

  const outcomes = [...new Set(mine.map((run) => String(run.conclusion || "-")))].join(", ");
  return { ok: false, reason: `${CI_WORKFLOW_NAME} 가 초록이 아닙니다 (${outcomes}). 재실행하거나 원인을 고친 뒤 머지합니다.` };
}

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

function selfTest() {
  const cases = [
    ["열려 있고 exact head 초록이면 통과",
      { state: "OPEN", headRefOid: "a".repeat(40), mergeStateStatus: "CLEAN" },
      [{ name: "CI", status: "completed", conclusion: "success", head_sha: "a".repeat(40) }], true],
    ["★ 다른 커밋의 초록으로는 통과하지 않는다",
      { state: "OPEN", headRefOid: "a".repeat(40), mergeStateStatus: "CLEAN" },
      [{ name: "CI", status: "completed", conclusion: "success", head_sha: "b".repeat(40) }], false],
    ["★ 실행이 아예 없으면 «통과» 가 아니다 — 이게 이 스크립트의 존재 이유다",
      { state: "OPEN", headRefOid: "a".repeat(40), mergeStateStatus: "CLEAN" }, [], false],
    ["도는 중이면 기다린다",
      { state: "OPEN", headRefOid: "a".repeat(40), mergeStateStatus: "CLEAN" },
      [{ name: "CI", status: "in_progress", conclusion: null, head_sha: "a".repeat(40) }], false],
    ["취소는 초록이 아니다 — 2026-08-27 에 5회 일어났다",
      { state: "OPEN", headRefOid: "a".repeat(40), mergeStateStatus: "CLEAN" },
      [{ name: "CI", status: "completed", conclusion: "cancelled", head_sha: "a".repeat(40) }], false],
    ["실패 뒤 재실행 초록이면 통과한다",
      { state: "OPEN", headRefOid: "a".repeat(40), mergeStateStatus: "CLEAN" },
      [{ name: "CI", status: "completed", conclusion: "failure", head_sha: "a".repeat(40) },
       { name: "CI", status: "completed", conclusion: "success", head_sha: "a".repeat(40) }], true],
    ["다른 워크플로의 초록은 세지 않는다",
      { state: "OPEN", headRefOid: "a".repeat(40), mergeStateStatus: "CLEAN" },
      [{ name: "Vercel", status: "completed", conclusion: "success", head_sha: "a".repeat(40) }], false],
    ["충돌이면 CI 초록이어도 막는다",
      { state: "OPEN", headRefOid: "a".repeat(40), mergeStateStatus: "DIRTY" },
      [{ name: "CI", status: "completed", conclusion: "success", head_sha: "a".repeat(40) }], false],
    ["닫힌 PR 은 막는다",
      { state: "CLOSED", headRefOid: "a".repeat(40), mergeStateStatus: "CLEAN" },
      [{ name: "CI", status: "completed", conclusion: "success", head_sha: "a".repeat(40) }], false],
    ["초안은 막는다",
      { state: "OPEN", isDraft: true, headRefOid: "a".repeat(40), mergeStateStatus: "CLEAN" },
      [{ name: "CI", status: "completed", conclusion: "success", head_sha: "a".repeat(40) }], false],
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

  const pr = JSON.parse(gh(["pr", "view", number, "--json", "state,isDraft,mergeStateStatus,headRefOid,title"]));
  const runs = JSON.parse(
    gh(["api", `repos/bbelieff/moawork/actions/runs?head_sha=${pr.headRefOid}&per_page=50`, "--jq", ".workflow_runs"]),
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
