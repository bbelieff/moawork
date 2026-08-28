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
 * 경보는 «작업 중» 이 아니라 «열린 채» 를 센다.
 *
 * ★ 왜 낮췄나 — 이 판의 출처(GitHub 이슈 API)는 Todo·Blocked·Done 셋만 만든다.
 *   「In Progress」는 Projects 의 Status 칸에 있어 이슈 API 로는 안 보인다.
 *   그걸 모른 채 ACTIVE_STATES 로 세면 경보가 «영원히 안 뜬다» — 그게 이 카드의 병이었다.
 */
test("경보는 열려 있는 DB 변경을 센다. 막힌 건은 뺀다 (#588 4)", async () => {
  const logic = await boardLogic();
  const queue = [
    { id: "#1", title: "migration 141", status: "Todo" },
    { id: "#2", title: "스키마 정리", status: "Todo" },
    { id: "#3", title: "마이그레이션 142", status: "Blocked" },
  ];
  const contention = logic.migrationContention(queue);
  assert.deepEqual(contention.map((i) => i.id), ["#1", "#2"]);
  assert.ok(contention.length > 1, "두 건이 동시에 열려 있으면 경보 조건이다");
  // 막힌 것만 남으면 경보가 아니다 — 지금 아무도 안 건드리고 있다
  assert.equal(logic.migrationContention([queue[2]]).length, 0);
});

test("판정 정규식은 한 벌만 있다 — 두 벌이면 경보와 큐가 다른 것을 센다", async () => {
  const html = await readFile(templateUrl, "utf8");
  const copies = [...html.matchAll(/DB 정본\|컬럼 메뉴 DB/g)];
  assert.equal(copies.length, 1, "migration 제목 정규식은 BOARD_LOGIC 한 곳만 갖는다");
});
