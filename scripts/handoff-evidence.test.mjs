import assert from "node:assert/strict";
import test from "node:test";

import { hasHandoffIntent, inspectHandoffBody, validateHandoffEvidence } from "./handoff-evidence.mjs";

const SOURCE_HEAD = "3".repeat(40);

function reviewBlock(findings, status = "reviewed") {
  return `\`\`\`moawork-review-findings\n${JSON.stringify({
    version: 1,
    pr: 583,
    exactHead: SOURCE_HEAD,
    status,
    findings,
  })}\n\`\`\``;
}

const sourceFindings = [
  {
    id: "P1-idempotency-key",
    severity: "P1",
    title: "렌더당 멱등키 공유",
    location: "app/src/components/board/ContractWorkIntakeForm.tsx:42",
    reproduction: "회사 A 직후 회사 B를 선택하면 같은 requestId가 재사용된다.",
  },
  {
    id: "P1-swallowed-action-error",
    severity: "P1",
    title: "서버 액션 실패 삼킴",
    location: "app/src/app/(app)/boards/actions.ts:10",
    reproduction: "RPC가 실패해도 action이 void로 끝나 화면에 성공처럼 보인다.",
  },
];

function handoffBlock(overrides = {}) {
  const evidence = {
    version: 1,
    kind: "supersedes",
    sourcePr: 583,
    sourceExactHead: SOURCE_HEAD,
    reviewStatus: "reviewed",
    findings: sourceFindings.map((finding) => ({
      ...finding,
      disposition: { kind: "fixed", evidence: `${finding.location} + focused regression` },
    })),
    ...overrides,
  };
  return `Supersedes PR #583\n\n\`\`\`moawork-handoff\n${JSON.stringify(evidence)}\n\`\`\``;
}

test("일반 PR에는 영향이 없다", () => {
  assert.equal(hasHandoffIntent("Closes #595\n일반 merge gate 개선"), false);
  assert.deepEqual(inspectHandoffBody("Closes #595"), {
    ok: true,
    required: false,
    reason: "일반 PR — 인계 evidence 비대상",
  });
});

test("takeover/supersedes 신호만 있고 block이 없으면 fail-closed", () => {
  const result = inspectHandoffBody("Supersedes PR #583");
  assert.equal(result.ok, false);
  assert.match(result.reason, /정확히 1개/);
});

test("malformed JSON과 중복 block을 거부한다", () => {
  assert.equal(inspectHandoffBody("Supersedes #583\n```moawork-handoff\n{\n```").ok, false);
  const twice = `${handoffBlock()}\n${handoffBlock()}`;
  assert.equal(inspectHandoffBody(twice).ok, false);
});

test("빈 findings 칸과 명시적 빈 배열을 구분한다", () => {
  const missing = handoffBlock({ findings: undefined });
  assert.equal(inspectHandoffBody(missing).ok, false);

  const none = handoffBlock({ findings: [] });
  const result = validateHandoffEvidence(none, [reviewBlock([])]);
  assert.equal(result.ok, true);
  assert.match(result.reason, /0건/);
});

test("검수 미실시는 원본 exact not_run manifest와 빈 배열이 있어야 통과한다", () => {
  const body = handoffBlock({ reviewStatus: "not_run", findings: [] });
  assert.equal(validateHandoffEvidence(body, []).ok, false);
  const result = validateHandoffEvidence(body, [reviewBlock([], "not_run")]);
  assert.equal(result.ok, true);
  assert.match(result.reason, /미실시/);
});

test("검수 미실시에 finding을 붙이면 거부한다", () => {
  const result = inspectHandoffBody(handoffBlock({ reviewStatus: "not_run" }));
  assert.equal(result.ok, false);
});

test("원본 reviewed를 not_run으로 바꿔 적어 findings를 우회할 수 없다", () => {
  const body = handoffBlock({ reviewStatus: "not_run", findings: [] });
  const result = validateHandoffEvidence(body, [reviewBlock(sourceFindings)]);
  assert.equal(result.ok, false);
  assert.match(result.reason, /status/);
});

test("원본 exact review manifest가 없거나 SHA가 다르면 거부한다", () => {
  assert.equal(validateHandoffEvidence(handoffBlock(), []).ok, false);
  const wrong = reviewBlock(sourceFindings).replace(SOURCE_HEAD, "4".repeat(40));
  assert.equal(validateHandoffEvidence(handoffBlock(), [wrong]).ok, false);
});

test("원본 P0/P1 두 건과 dispositions를 exact 보존하면 통과한다", () => {
  const result = validateHandoffEvidence(handoffBlock(), ["unrelated", reviewBlock(sourceFindings)]);
  assert.equal(result.ok, true);
  assert.match(result.reason, /2건/);
});

test("원본 finding 하나를 누락하면 거부한다", () => {
  const findings = sourceFindings.slice(0, 1).map((finding) => ({
    ...finding,
    disposition: { kind: "fixed", evidence: "test" },
  }));
  const result = validateHandoffEvidence(handoffBlock({ findings }), [reviewBlock(sourceFindings)]);
  assert.equal(result.ok, false);
  assert.match(result.reason, /누락/);
});

test("원본에 없는 finding을 추가하면 거부한다", () => {
  const extra = {
    id: "P1-extra",
    severity: "P1",
    title: "extra",
    location: "x.ts:1",
    reproduction: "extra repro",
    disposition: { kind: "fixed", evidence: "test" },
  };
  const result = validateHandoffEvidence(
    handoffBlock({ findings: [...JSON.parse(JSON.stringify(sourceFindings)).map((finding) => ({ ...finding, disposition: { kind: "fixed", evidence: "test" } })), extra] }),
    [reviewBlock(sourceFindings)],
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /섞였습니다/);
});

test("제목·파일/재현을 바꿔 적으면 원본 보존 실패", () => {
  for (const field of ["title", "location", "reproduction"]) {
    const findings = sourceFindings.map((finding) => ({
      ...finding,
      disposition: { kind: "fixed", evidence: "test" },
    }));
    findings[0][field] = `${findings[0][field]} changed`;
    const result = validateHandoffEvidence(handoffBlock({ findings }), [reviewBlock(sourceFindings)]);
    assert.equal(result.ok, false, field);
    assert.match(result.reason, new RegExp(field));
  }
});

test("고침/불필요/이월 disposition의 필수 근거를 검사한다", () => {
  const base = sourceFindings.map((finding) => ({ ...finding, disposition: { kind: "fixed", evidence: "test" } }));
  for (const bad of [
    { kind: "fixed", evidence: "" },
    { kind: "not_applicable", rationale: "" },
    { kind: "deferred", issue: 0 },
  ]) {
    const findings = JSON.parse(JSON.stringify(base));
    findings[0].disposition = bad;
    assert.equal(inspectHandoffBody(handoffBlock({ findings })).ok, false);
  }

  const dispositions = [
    { kind: "fixed", evidence: "file:test" },
    { kind: "not_applicable", rationale: "source path removed by newer main" },
    { kind: "deferred", issue: 588 },
  ];
  for (const disposition of dispositions) {
    const findings = JSON.parse(JSON.stringify(base));
    findings[0].disposition = disposition;
    assert.equal(validateHandoffEvidence(handoffBlock({ findings }), [reviewBlock(sourceFindings)]).ok, true);
  }
});

test("중복 finding id와 공백 필드를 거부한다", () => {
  const findings = sourceFindings.map((finding) => ({ ...finding, disposition: { kind: "fixed", evidence: "test" } }));
  findings[1].id = findings[0].id;
  assert.equal(inspectHandoffBody(handoffBlock({ findings })).ok, false);
  findings[1].id = "P1-second";
  findings[0].reproduction = " ";
  assert.equal(inspectHandoffBody(handoffBlock({ findings })).ok, false);
});

test("같은 exact의 source manifests가 서로 다르면 모순으로 거부한다", () => {
  const changed = structuredClone(sourceFindings);
  changed[0].title = "다른 제목";
  const result = validateHandoffEvidence(handoffBlock(), [reviewBlock(sourceFindings), reviewBlock(changed)]);
  assert.equal(result.ok, false);
  assert.match(result.reason, /서로 다른/);
});
