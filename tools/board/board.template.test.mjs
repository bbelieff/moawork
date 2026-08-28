import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const templateUrl = new URL("./board.template.html", import.meta.url);

test("decision dashboard script compiles and keeps the live data bridge contract", async () => {
  const html = await readFile(templateUrl, "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new Function(scripts[0]));
  assert.match(html, /callMcpTool/);
  assert.match(html, /\/api\/operations/);
  assert.match(html, /전체 오픈 작업/);
  // ★ 2026-08-27 — 화면 문구를 쉬운 말로 바꿨다(총괄 지시: "뭔말인지 못알아듣는거 굉장히 많음").
  //   이 검사들은 «그 자리가 살아 있는가» 를 보는 것이지 «그 낱말이 그대로인가» 가 아니다.
  //   그래서 바뀐 문구로 갱신한다. 다음에 또 다듬으면 여기도 같이 고친다.
  assert.match(html, /지금 일하는 중/);
  assert.match(html, /멈춘 것일 수 있습니다/);
  assert.match(html, /목업과 다른 곳/);
  // 진행 지도 — 「도착점·지금 위치·앞길」을 보여주는 자리(AGENTS.md §2.6-②).
  assert.match(html, /진행 지도/);
  assert.match(html, /renderJourney/);
  assert.match(html, /층별 달성도/);
  assert.match(html, /연료/);
  assert.match(html, /측정 실패/);
  assert.match(html, /60_000/);
  assert.match(html, /visibilitychange/);
  assert.match(html, /force/);
  assert.match(html, /다음 조회/);
  assert.match(html, /stale 상태로 남깁니다/);
  assert.match(html, /measured\(delivery\.counts\?\.\[key\]\)/);
  assert.doesNotMatch(html, /key==="HOSTED_WAITING"\?delivery\.hostedRequiredCount/);
});

test("GitHub partial state names the rate limit and preserves the last-success contract", async () => {
  const html = await readFile(templateUrl, "utf8");
  assert.match(html, /GitHub 조회 제한/);
  assert.match(html, /마지막 성공/);
  assert.match(html, /incoming\.length\?incoming:state\.all/);
  assert.match(html, /Production은 계속 갱신합니다/);
});

test("slow initial load coalesces timer, visibility, and manual refresh fanout", async () => {
  const html = await readFile(templateUrl, "utf8");
  assert.match(html, /loadInFlight=null/);
  assert.match(html, /if\(loadInFlight\)return loadInFlight/);
  assert.match(html, /nextRefreshAt=Date\.now\(\)\+60_000;\s*loadInFlight=loadOnce\(force\)/);
  assert.match(html, /finally\{loadInFlight=null\}/);
});

test("new DG lanes and the P0 handoff chain are visible without the retired 20-slot board", async () => {
  const html = await readFile(templateUrl, "utf8");
  for (const lane of ["DG-01", "DG-02", "DG-03", "DG-04", "DG-05", "DG-06", "DG-07"]) {
    assert.match(html, new RegExp(lane));
  }
  assert.match(html, /BBE-160/);
  assert.match(html, /BBE-161/);
  assert.match(html, /ce5ab1f9/);
  assert.doesNotMatch(html, /USER CHECK/);
  assert.match(html, /로그인 1440×900\/375×812 실측/);
  assert.match(html, /PR #189 merge e593d7ee/);
  assert.match(html, /qa-app DIFF는 52개/);
  assert.match(html, /직전 75개 · 초기 104개/);
  assert.doesNotMatch(html, /기기 2 × 진영 2 × 5칸/);
  assert.doesNotMatch(html, /const SLOTS=/);
});

test("decision metrics derive from the full live issue inventory", async () => {
  const html = await readFile(templateUrl, "utf8");
  // 2026-08-28 — 이 줄은 원래 `state.open=state.issues.filter` 를 고정했다.
  //   그 시절 state.issues 는 «전체 재고» 였다. 뒤에 목표 15건만 담도록 좁혀졌고,
  //   CUTOVER 로 그 15건이 사라지면서 state.open 이 «항상 빈 배열» 이 됐다 —
  //   이 테스트 이름이 말하는 「full live issue inventory」와 정반대인데도 초록이었다.
  //   소스 문자열을 고정하면 이렇게 «틀린 것을 지키는» 검사가 된다.
  assert.match(html, /state\.open=all\.filter/);
  assert.match(html, /owner 라벨 없는 오픈 카드/);
  assert.match(html, /충돌·실패 PR/);
  assert.match(html, /서명 도장 미확인/);
  assert.match(html, /취소\/중복 제외/);
});

async function boardLogic() {
  const html = await readFile(templateUrl, "utf8");
  const match = html.match(/\/\* BOARD_LOGIC_START \*\/([\s\S]*?)\/\* BOARD_LOGIC_END \*\//);
  assert.ok(match, "pure board logic block must remain executable in focused tests");
  return new Function(`${match[1]}; return BOARD_LOGIC;`)();
}

test("cross-squad detector catches the old graph and accepts the refreshed issue graph", async () => {
  const logic = await boardLogic();
  const squads = ["squad:new-lead", "squad:column-preset", "squad:release-gate"];
  const issues = [
    { id: "BBE-173", labels: ["squad:new-lead"] },
    { id: "BBE-175", labels: ["squad:column-preset"] },
    { id: "BBE-176", labels: ["squad:column-preset"] },
    { id: "BBE-182", labels: ["squad:release-gate"] },
  ];

  const oldGraph = { "BBE-176": ["BBE-173"], "BBE-182": ["BBE-173", "BBE-176"] };
  assert.deepEqual(logic.crossDependencies(issues, oldGraph, "BBE-182", squads).map((edge) => [edge.issueId, edge.dependencyId]), [["BBE-176", "BBE-173"]]);

  const currentGraph = { "BBE-176": ["BBE-175"], "BBE-182": ["BBE-173", "BBE-176"] };
  assert.deepEqual(logic.crossDependencies(issues, currentGraph, "BBE-182", squads), []);
});

test("BBE-172 no longer waits for the unrelated BBE-171 form work", async () => {
  const html = await readFile(templateUrl, "utf8");
  assert.match(html, /"BBE-172":\["BBE-173"\]/);
  assert.doesNotMatch(html, /"BBE-172":\["BBE-173","BBE-171"\]/);
  assert.doesNotMatch(html, /"BBE-172":"[^"]*171 Done/);
});

test("BBE-182 release gate exposes WAITING, READY/OPEN, RUNNING, and COMPLETE", async () => {
  const logic = await boardLogic();
  assert.equal(logic.releaseState("Todo", 1, 0, true), "WAITING");
  assert.equal(logic.releaseState("Todo", 0, 0, true), "READY / OPEN");
  assert.equal(logic.releaseState("In Progress", 0, 0, true), "RUNNING");
  assert.equal(logic.releaseState("Done", 0, 0, true), "COMPLETE");
  assert.equal(logic.releaseState("Todo", 0, 1, true), "WAITING");
  assert.equal(logic.releaseState("Todo", 0, 0, false), "WAITING");
});

test("squad coverage rejects missing BBE-174 and duplicate labels with a fixed goal denominator", async () => {
  const logic = await boardLogic();
  const goals = ["BBE-173", "BBE-174", "BBE-175"];
  const squads = ["squad:new-lead", "squad:column-preset"];
  const missing = logic.coverage([
    { id: "BBE-173", labels: ["squad:new-lead"] },
    { id: "BBE-174", labels: [] },
    { id: "BBE-175", labels: ["squad:column-preset"] },
  ], goals, squads);
  assert.deepEqual(missing, { missing: ["BBE-174"], duplicate: [], covered: 2, total: 3, ok: false });

  const duplicate = logic.coverage([
    { id: "BBE-173", labels: ["squad:new-lead"] },
    { id: "BBE-174", labels: ["squad:new-lead", "squad:column-preset"] },
    { id: "BBE-175", labels: ["squad:column-preset"] },
  ], goals, squads);
  assert.equal(duplicate.total, 3);
  assert.deepEqual(duplicate.missing, []);
  assert.deepEqual(duplicate.duplicate, [{ id: "BBE-174", labels: ["squad:new-lead", "squad:column-preset"] }]);
  assert.equal(duplicate.ok, false);
});

test("owner coverage requires exactly one C/G owner and ignores blocked labels", async () => {
  const logic = await boardLogic();
  const goals = ["BBE-171", "BBE-172", "BBE-183", "BBE-184"];
  const result = logic.ownerCoverage([
    { id: "BBE-171", labels: ["DC-03", "squad:new-lead"] },
    { id: "BBE-172", labels: ["blocked:DG-02", "squad:new-lead"] },
    { id: "BBE-183", labels: ["DC-03", "DC-06", "blocked:DG-02"] },
    { id: "BBE-184", labels: ["DG-04", "squad:new-lead"] },
  ], goals);

  assert.deepEqual(result, {
    missing: ["BBE-172"],
    collision: [{ id: "BBE-183", labels: ["DC-03", "DC-06"] }],
    covered: 2,
    total: 4,
    ok: false,
  });
  assert.deepEqual(logic.ownerLabels({ labels: ["NC-04", "DG-02", "blocked:DC-03"] }), ["NC-04", "DG-02"]);
  // 2026-08-20: 칸 번호를 떼었다(§4.2). 번호 없는 반 라벨도 소유 라벨로 읽힌다 —
  // 그러면서 기존 번호 라벨 49개도 그대로 읽혀야 한다. blocked: 접두는 여전히 제외된다.
  assert.deepEqual(logic.ownerLabels({ labels: ["DC", "DG", "blocked:DC"] }), ["DC", "DG"]);
  assert.deepEqual(logic.ownerLabels({ labels: ["NC", "NG-02"] }), ["NC", "NG-02"]);
  assert.deepEqual(logic.ownerLabels({ labels: ["DCX", "D", "dc", "DC-3"] }), []);
});

test("owner coverage ignores historical terminal owners but preserves active missing and collision", async () => {
  const logic = await boardLogic();
  const goals = ["BBE-DONE", "BBE-CANCELED", "BBE-ACTIVE", "BBE-BLOCKED"];
  const terminal = logic.ownerCoverage([
    { id: "BBE-DONE", status: "Done", labels: ["DC-16", "DC-07"] },
    { id: "BBE-CANCELED", status: "Canceled", labels: [] },
    { id: "BBE-ACTIVE", status: "In Progress", labels: ["DG"] },
    { id: "BBE-BLOCKED", status: "Blocked", labels: ["DC-02"] },
  ], goals);
  assert.deepEqual(terminal, { missing: [], collision: [], covered: 4, total: 4, ok: true });

  const activeFailures = logic.ownerCoverage([
    { id: "BBE-DONE", status: "Done", labels: ["DC-16", "DC-07"] },
    { id: "BBE-CANCELED", status: "Duplicate", labels: ["DG", "DC"] },
    { id: "BBE-ACTIVE", status: "In Progress", labels: [] },
    { id: "BBE-BLOCKED", status: "Blocked", labels: ["DC-02", "DG-03"] },
  ], goals);
  assert.deepEqual(activeFailures, {
    missing: ["BBE-ACTIVE"],
    collision: [{ id: "BBE-BLOCKED", labels: ["DC-02", "DG-03"] }],
    covered: 2,
    total: 4,
    ok: false,
  });
  assert.equal(logic.releaseState("Done", 0, 0, terminal.ok), "COMPLETE");
});

test("Production completion is fail-closed across PR, exact deployment, runtime, and hosted gates", async () => {
  const { deliveryStage } = await boardLogic();
  const passingPr = { isDraft: false, checks: { total: 3, failing: 0, pending: 0 } };
  assert.deepEqual(deliveryStage({ linearStatus: "Done", pr: passingPr }), {
    stage: "MERGE_WAITING", complete: false, blockers: ["LINEAR_DONE_WITHOUT_PRODUCTION"],
  }, "CI PASS and issue Done are still not a completed delivery");

  const mergedPr = { ...passingPr, mergedAt: "2026-08-21T00:00:00Z", mergeCommitSha: "aaa" };
  assert.deepEqual(deliveryStage({ linearStatus: "Done", pr: mergedPr, deployment: { state: "SUCCESS", sha: "bbb" }, loginStatus: 200, runtimeErrorCount: 0 }), {
    stage: "DEPLOYMENT_WAITING", complete: false, blockers: ["LINEAR_DONE_WITHOUT_PRODUCTION", "PRODUCTION_SHA_MISMATCH"],
  });
  assert.equal(deliveryStage({ linearStatus: "Done", pr: mergedPr, deployment: { state: "SUCCESS", sha: "aaa" }, loginStatus: 200, runtimeErrorCount: 1 }).complete, false);
  assert.deepEqual(deliveryStage({ linearStatus: "Done", pr: mergedPr, deployment: { state: "SUCCESS", sha: "aaa" }, loginStatus: 200, runtimeErrorCount: 0, hostedRequired: true, hostedApplied: false }), {
    stage: "HOSTED_WAITING", complete: false, blockers: ["HOSTED_REQUIRED_UNVERIFIED"],
  });
  assert.deepEqual(deliveryStage({ linearStatus: "In Progress", pr: null, hostedRequired: true, hostedApplied: false }), {
    stage: "WORK_REVIEW", complete: false, blockers: ["HOSTED_REQUIRED_UNVERIFIED"],
  });
  assert.deepEqual(deliveryStage({ linearStatus: "Done", pr: mergedPr, deployment: { state: "SUCCESS", sha: "aaa" }, loginStatus: 200, runtimeErrorCount: 0 }), {
    stage: "PRODUCTION_COMPLETE", complete: true, blockers: [],
  });
});

test("current pipeline excludes the measured 115 historical Done cards", async () => {
  const { boundedDeliveryIds } = await boardLogic();
  const historical = Array.from({ length: 115 }, (_, index) => ({ id: `OLD-${index}`, status: "Done", updatedAt: "2026-08-01T00:00:00Z" }));
  const issues = [...historical,
    { id: "BBE-266", status: "In Progress", updatedAt: "2026-08-21T01:00:00Z" },
    { id: "BBE-267", status: "Backlog", updatedAt: "2026-08-21T01:00:00Z" },
    { id: "BBE-191", status: "Done", updatedAt: "2026-08-21T01:00:00Z" },
  ];
  const ids = boundedDeliveryIds(issues, [
    { cardId: "BBE-267", state: "OPEN", mergedAt: null },
    { cardId: "BBE-191", state: "MERGED", mergedAt: "2026-08-21T02:00:00Z" },
  ], "2026-08-21");
  assert.deepEqual(ids.sort(), ["BBE-191", "BBE-266", "BBE-267"]);
  assert.equal(ids.some((id) => id.startsWith("OLD-")), false);
});

test("bounded pipeline excludes Backlog and Done without PR evidence but keeps In Progress and open PR", async () => {
  const { boundedDeliveryIds } = await boardLogic();
  const issues = [
    { id: "BACKLOG", status: "Backlog" }, { id: "DONE", status: "Done" },
    { id: "ACTIVE", status: "In Progress" }, { id: "OPEN", status: "Todo" },
  ];
  assert.deepEqual(boundedDeliveryIds(issues, [{ cardId: "OPEN", state: "OPEN", mergedAt: null }], "2026-08-21").sort(), ["ACTIVE", "OPEN"]);
});

/**
 * 이 판의 안전장치가 «영원히 꺼져» 있었다 (#588 4).
 *
 *   「DB 변경 순서」 큐와 «P0 SERIAL CONFLICT» 경보는 둘 다 state.open 을 본다.
 *   그런데 state.open 이 Linear 시절 목표 15건에서 골라져서 CUTOVER 이후 늘 비었다.
 *   화면은 「migration queue 없음」이라고만 말했다 — 없어서가 아니라 «안 봐서» 였다.
 *   가장 나쁜 고장이다: 꺼져 있는데 «정상» 처럼 보인다.
 */
test("DB 변경 순서 큐가 열린 이슈 전부를 본다 — 목표 목록에 없어도 (#588 4)", async () => {
  const logic = await boardLogic();
  const open = [
    { id: "#640", title: "docs(worklog): 기록 추가", status: "In Progress" },
    { id: "#612", title: "feat(db): migration 141 컬럼 추가", status: "In Progress" },
    { id: "#588", title: "fix: schema 정합성", status: "Todo" },
  ];
  const queue = logic.migrationQueue(open);
  assert.deepEqual(queue.map((issue) => issue.id), ["#588", "#612"]);
  assert.equal(queue[0].id, "#588");
});

test("DB 를 안 바꾸는 이슈는 큐에 안 들어간다", async () => {
  const logic = await boardLogic();
  assert.deepEqual(logic.migrationQueue([{ id: "#1", title: "사이드바 색상", status: "Todo" }]), []);
  assert.deepEqual(logic.migrationQueue([]), []);
  assert.deepEqual(logic.migrationQueue(undefined), []);
});

test("도장 몫을 자르면 «못 본 몫» 을 값으로 돌려준다", async () => {
  const logic = await boardLogic();
  const many = Array.from({ length: 43 }, (_, i) => ({ id: `#${i}` }));
  const cut = logic.stampBudget(many, 40);
  assert.equal(cut.seen.length, 40);
  assert.deepEqual(cut.truncated, { seen: 40, total: 43 });

  // 상한 이하면 «잘렸다» 고 말하지 않는다 — 거짓 경보를 만들지 않는다
  const whole = logic.stampBudget(many.slice(0, 40), 40);
  assert.equal(whole.seen.length, 40);
  assert.equal(whole.truncated, null);
  assert.deepEqual(logic.stampBudget(undefined, 40), { seen: [], truncated: null });
});

/**
 * 큐 판정이 «이 저장소의 실제 제목» 을 잡는가.
 *
 * ★ 처음 판은 영어 낱말만 봤다(migration|schema). 검수가 실제 재고에 대보니
 *   열린 이슈 7건 중 «0건» 이 걸렸고, 「마이그레이션이 딸린 PR」을 다루는 이슈
 *   자기 자신도 안 걸렸다. 테스트는 초록이었다 — 픽스처가 영어였기 때문이다.
 *   그래서 여기서는 «이 저장소가 실제로 쓰는 한글 제목» 을 픽스처로 쓴다.
 */
test("큐가 한글 제목을 잡는다 — 이 저장소의 제목 관례다 (#588 4)", async () => {
  const logic = await boardLogic();
  const real = [
    { id: "#632", title: "P0 구조: 마이그레이션이 딸린 PR 은 머지 직후 «배포됨 · DB 안 됨» 구간이 생긴다", status: "Todo" },
    { id: "#510", title: "스키마 표류를 원장으로 잡는다", status: "Todo" },
    { id: "#600", title: "사이드바 활성 탭 색상", status: "Todo" },
  ];
  assert.deepEqual(logic.migrationQueue(real).map((i) => i.id), ["#510", "#632"]);
});

/**
 * 겹침 경보는 «정답지» 로 센다 — 그 PR 이 supabase/migrations/ 를 실제로 건드리는가.
 *
 * ★ 왜 제목을 버렸나 — 실측했더니 «실제로 마이그레이션 파일을 쓴 이슈 15건 중 0건» 이
 *   제목 정규식에 걸렸다. DB 를 바꾸는 사람은 제목에 DB 이야기를 안 쓴다.
 *     140_issue588_…  →  「업체 고르기 후속 6건 — 그룹 무시 · 목록 상한 없음」
 *   반대로 걸린 것은 마이그레이션을 «논하는» 이슈였다. 두 집합의 교집합이 0이었다.
 *
 * ★ 그리고 겹침은 예외가 아니라 일상이다 — 마이그레이션이 추가된 25일 중 23일(92%)이
 *   하루 2건 이상이었는데, 그동안 이 판은 한 번도 경보를 띄우지 않았다.
 */
test("겹침 경보는 «파일» 로 센다 — 제목이 아니라 (#588 4)", async () => {
  const logic = await boardLogic();
  const prs = [
    { number: 631, state: "OPEN", touchesMigrations: true },
    { number: 640, state: "OPEN", touchesMigrations: false },
    { number: 602, state: "OPEN", touchesMigrations: true },
    { number: 500, state: "MERGED", touchesMigrations: true },
  ];
  const writers = logic.migrationWriters(prs);
  assert.deepEqual(writers.map((pr) => pr.number), [602, 631]);
  assert.ok(writers.length > 1, "두 PR 이 동시에 마이그레이션을 담으면 경보 조건이다");
});

test("닫힌 PR 과 마이그레이션 없는 PR 은 겹침으로 안 센다", async () => {
  const logic = await boardLogic();
  assert.deepEqual(logic.migrationWriters([{ number: 1, state: "MERGED", touchesMigrations: true }]), []);
  assert.deepEqual(logic.migrationWriters([{ number: 2, state: "OPEN", touchesMigrations: false }]), []);
  assert.deepEqual(logic.migrationWriters(undefined), []);
});

/**
 * 정답지 판정을 «행동» 으로 잰다 (검수 P2-b).
 *
 * ★ 처음엔 서버 소스를 grep 했다. 그러면 판정을 항상 false 로 만들어도
 *   39개 검사가 전부 초록이다 — 이 PR 이 세 번 비판한 바로 그 안티패턴이
 *   서버 쪽에 그대로 남아 있었다. 그래서 판정을 모듈로 빼고 여기서 직접 부른다.
 */
test("PR 이 마이그레이션을 담았는지 «파일» 로 판정한다", async () => {
  const { touchesMigrations, migrationWriterMap } = await import("../migration-writers.mjs");

  assert.equal(touchesMigrations({ files: [{ path: "supabase/migrations/141_x.sql" }], changedFiles: 1 }), true);
  assert.equal(touchesMigrations({ files: [{ path: "app/src/page.tsx" }], changedFiles: 1 }), false);
  assert.equal(touchesMigrations({ files: [], changedFiles: 0 }), false);

  // ★ 잘렸으면 «모른다»(null) 다. «아니다»(false) 가 아니다.
  //   gh 는 파일 100개에서 조용히 자르고, 목록이 경로 알파벳 순이라
  //   supabase/ 는 app/·docs/·scripts/ 뒤여서 «잘림의 첫 희생자» 다.
  assert.equal(touchesMigrations({ files: [{ path: "app/a.ts" }], changedFiles: 120 }), null);

  const map = migrationWriterMap([
    { number: 1, files: [{ path: "supabase/migrations/1.sql" }], changedFiles: 1 },
    { number: 2, files: [{ path: "docs/x.md" }], changedFiles: 1 },
  ]);
  assert.equal(map.get(1), true);
  assert.equal(map.get(2), false);
});

/**
 * 카드가 «무엇을 말할지» 를 값으로 잰다 (검수 P1-4 · P2-e · P3).
 *
 * ★ 앞선 검사는 소스 문자열을 grep 했다. 그러면 그 문장이 «도달 불가능한 가지» 에
 *   있어도 초록이다 — 실제로 그런 일이 있었다(P1-5). 여기서는 분기를 값으로 잰다.
 */
test("PR 을 못 읽으면 «없음» 이 아니라 «모름» 이다 (#588 4)", async () => {
  const logic = await boardLogic();

  // 목록 자체를 못 읽음
  const a = logic.migrationCardState({ available: false, migrationScanAvailable: false, items: [] });
  assert.equal(a.mode, "unreadable");
  assert.equal(a.overlap, false, "못 읽었으면 겹침을 «없다» 고 판단하지 않는다");

  // 목록은 읽었는데 파일 조회만 실패 — 이것도 «모름» 이다
  const b = logic.migrationCardState({ available: true, migrationScanAvailable: false, items: [] });
  assert.equal(b.mode, "unreadable");

  // ★ 못 읽었을 때 «잘림» 줄을 띄우지 않는다 — 원인을 틀리게 말하는 것이다
  const c = logic.migrationCardState({
    available: true, migrationScanAvailable: false,
    items: [{ number: 1, state: "OPEN", touchesMigrations: null }],
  });
  assert.deepEqual(c.unknown, [], "질의 실패를 «파일이 많아 잘림» 으로 말하면 안 된다");
});

test("정말 없을 때와 겹칠 때를 가른다", async () => {
  const logic = await boardLogic();
  const empty = logic.migrationCardState({ available: true, migrationScanAvailable: true, items: [] });
  assert.equal(empty.mode, "empty");
  assert.equal(empty.overlap, false);

  const two = logic.migrationCardState({
    available: true, migrationScanAvailable: true,
    items: [
      { number: 10, state: "OPEN", touchesMigrations: true },
      { number: 11, state: "OPEN", touchesMigrations: true },
      { number: 12, state: "OPEN", touchesMigrations: false },
    ],
  });
  assert.equal(two.mode, "writers");
  assert.equal(two.overlap, true);
  assert.deepEqual(two.writers.map((pr) => pr.number), [10, 11]);
});

/**
 * ★ 잘려서 «모르는» PR 은 «없다» 로 세지 않는다.
 *   이 경로는 한 번 죽어 있었다 — 서버의 `?? false` 가 null 을 false 로 뭉갰다.
 *   판정(모듈)에는 검사가 있었는데 «배선» 에는 없어서 못 잡았다.
 */
test("파일이 많아 판정 못 한 PR 은 «모름» 으로 따로 센다", async () => {
  const logic = await boardLogic();
  const card = logic.migrationCardState({
    available: true, migrationScanAvailable: true,
    items: [
      { number: 20, state: "OPEN", touchesMigrations: null },
      { number: 21, state: "OPEN", touchesMigrations: false },
    ],
  });
  assert.deepEqual(card.unknown.map((pr) => pr.number), [20]);
  // ★ «없다» 고도 단정하지 않는다. 앞선 판은 여기서 "empty" 를 돌려줬고, 그러면
  //   화면 윗줄(「N건은 판정 못 했습니다」)과 본문(「없습니다」)이 서로 모순됐다.
  assert.equal(card.mode, "partial");
});

/**
 * ★ 「모름을 없음으로 읽지 않는다」가 «겹침» 에서도 지켜지는가.
 *   확인된 1건 + 모르는 1건이면 진짜 겹침일 수 있다. 그때 판이 조용하면
 *   이 PR 이 세운 원칙이 마지막 자리에서 깨진다.
 */
test("확인 1건 + 모름 1건이면 «겹칠 수도 있다» 고 말한다", async () => {
  const logic = await boardLogic();
  const card = logic.migrationCardState({
    available: true, migrationScanAvailable: true,
    items: [
      { number: 30, state: "OPEN", touchesMigrations: true },
      { number: 31, state: "OPEN", touchesMigrations: null },
    ],
  });
  assert.equal(card.overlap, false, "확실하지 않으면 빨간 경보로 울리지 않는다");
  assert.equal(card.mayOverlap, true, "그렇다고 «겹침 없음» 으로 넘기지도 않는다");
});

/**
 * ★ 경보 문턱을 잰다. `> 1` 을 `> 0` 으로 바꿔도 통과하면
 *   「PR 한 건에도 겹침 경보」라는 상시 오경보가 검사를 그냥 지나간다.
 */
test("PR 한 건뿐이면 겹침이 아니다 — 상시 오경보를 막는다", async () => {
  const logic = await boardLogic();
  const one = logic.migrationCardState({
    available: true, migrationScanAvailable: true,
    items: [{ number: 40, state: "OPEN", touchesMigrations: true }],
  });
  assert.equal(one.mode, "writers");
  assert.equal(one.overlap, false);
  assert.equal(one.mayOverlap, false);
});

/**
 * ★ 데이터가 «아예 없을 때» 도 «모름» 이다.
 *   첫 렌더나 예상 못 한 모양에서 「없습니다」를 그리면 그게 이 카드의 습관 그대로다.
 */
test("PR 정보가 아예 없으면 «없음» 이 아니라 «모름» 이다", async () => {
  const logic = await boardLogic();
  assert.equal(logic.migrationCardState(undefined).mode, "unreadable");
  assert.equal(logic.migrationCardState(null).mode, "unreadable");
});

/**
 * ★ 배선을 잰다 — P1-5 가 정확히 이 빈칸으로 들어왔다.
 *   판정(touchesMigrations)에는 검사가 있었는데 «판정을 판에 실어 보내는 한 줄» 에는
 *   하나도 없었다. 그래서 `?? false` 한 글자가 잘림 경로를 통째로 죽였는데도
 *   40개 검사가 전부 초록이었다.
 */
test("판정을 판에 실어 보낼 때 «모름» 을 «아니다» 로 뭉개지 않는다", async () => {
  const { migrationWriterMap, touchesMigrationsFor } = await import("../migration-writers.mjs");
  const map = migrationWriterMap([
    { number: 1, files: [{ path: "supabase/migrations/1.sql" }], changedFiles: 1 },
    { number: 2, files: [{ path: "docs/x.md" }], changedFiles: 1 },
    { number: 3, files: [{ path: "app/a.ts" }], changedFiles: 120 },   // 잘림
  ]);

  assert.equal(touchesMigrationsFor(map, 1), true);
  assert.equal(touchesMigrationsFor(map, 2), false);
  // ★ 잘린 PR 은 null 이어야 한다. false 로 뭉개면 「있는데 없다」가 된다.
  assert.equal(touchesMigrationsFor(map, 3), null);
  // map 에 없는 것(=닫힌 PR)은 false — «모름» 이 아니다
  assert.equal(touchesMigrationsFor(map, 99), false);
  // 열린 PR 을 통째로 못 읽었으면 전부 «모름»
  assert.equal(touchesMigrationsFor(null, 1), null);
});

/**
 * ★ 형제 배선을 잰다 (검수 P2-j).
 *   `touchesMigrations` 배선은 P1-5 로 덮었는데, 바로 옆 줄인 이것은 검사가 0건이라
 *   `migrationScanAvailable: true` 로 통째로 바꿔도 43개 검사가 전부 초록이었다.
 *   이 줄이 깨지면 P1-4(질의 실패인데 「없습니다」)가 그대로 재발한다.
 */
test("열린 PR 파일을 못 읽었으면 «읽었다» 고 말하지 않는다", async () => {
  const { migrationWriterMap, migrationScanAvailable } = await import("../migration-writers.mjs");

  assert.equal(migrationScanAvailable(null, 3), false, "질의가 실패했으면 못 읽은 것이다");

  const map = migrationWriterMap([{ number: 1, files: [], changedFiles: 0 }]);
  assert.equal(migrationScanAvailable(map, 1), true);

  // ★ 열린 PR 이 있다는데 판정이 하나도 없다 — gh 가 exit 0 으로 빈 출력을 낸 경우다.
  //   조용한 0 으로 넘기지 않는다.
  assert.equal(migrationScanAvailable(new Map(), 3), false);
  // 열린 PR 이 정말 0건이면 빈 Map 이 정상이다
  assert.equal(migrationScanAvailable(new Map(), 0), true);
});

/**
 * ★ 측정 실패 카드가 화면에 «null» 을 찍지 않는다.
 *   count 를 그대로 이어 붙이므로 null 이면 판 맨 위에 큰 빨간 「null」이 뜬다.
 */
test("측정 실패 카드의 숫자 자리에 null 을 넣지 않는다", async () => {
  const html = await readFile(templateUrl, "utf8");
  const card = html.match(/kind:"측정 실패"[^}]*}/);
  assert.ok(card, "측정 실패 카드가 있어야 한다");
  assert.doesNotMatch(card[0], /count:null/);
  assert.match(card[0], /count:"—"/);
});

test("판정 정규식은 한 벌만 있다 — 두 벌이면 경보와 큐가 다른 것을 센다", async () => {
  const html = await readFile(templateUrl, "utf8");
  const copies = [...html.matchAll(/DB 정본\|컬럼 메뉴 DB/g)];
  assert.equal(copies.length, 1, "migration 제목 정규식은 BOARD_LOGIC 한 곳만 갖는다");
});
