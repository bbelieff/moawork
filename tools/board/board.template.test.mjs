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

test("cross-squad detector catches the old graph and accepts the refreshed Linear graph", async () => {
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
});
