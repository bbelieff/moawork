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
  assert.match(html, /state\.open=state\.issues\.filter/);
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
