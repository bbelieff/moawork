import assert from "node:assert/strict";
import test from "node:test";

import {
  hasHandoffIntent,
  inspectHandoffBody,
  loadPaginatedCollection,
  parseReviewEvidencePages,
  parseSourcePrMetadata,
  parseWorkflowRunPages,
  validateHandoffEvidence,
} from "./handoff-evidence.mjs";

const SOURCE_HEAD = "3".repeat(40);
const OLD_SOURCE_HEAD = "2".repeat(40);
const SOURCE_AUTHOR = "source-author";

function reviewBlock(findings, status = "reviewed", overrides = {}) {
  return `\`\`\`moawork-review-findings\n${JSON.stringify({
    version: 1,
    pr: 583,
    exactHead: SOURCE_HEAD,
    status,
    findings,
    ...overrides,
  })}\n\`\`\``;
}

function reviewRecord(body, overrides = {}) {
  return {
    kind: "review",
    id: "review-1",
    author: "independent-reviewer",
    authorAssociation: "MEMBER",
    state: "APPROVED",
    createdAt: "2026-08-27T00:00:00Z",
    commitId: SOURCE_HEAD,
    body,
    ...overrides,
  };
}

function commentRecord(body, overrides = {}) {
  return {
    kind: "comment",
    id: "comment-1",
    author: "repo-member-reviewer",
    authorAssociation: "MEMBER",
    state: null,
    createdAt: "2026-08-27T00:00:00Z",
    commitId: null,
    body,
    ...overrides,
  };
}

function sourceEvidence(records = [], pr = {}) {
  return { pr: { number: 583, author: SOURCE_AUTHOR, ...pr }, records };
}

function apiComment(id, body = "", overrides = {}) {
  return {
    id,
    user: { login: `commenter-${id}` },
    author_association: "MEMBER",
    created_at: "2026-08-27T00:00:00Z",
    body,
    ...overrides,
  };
}

function apiReview(id, body = "", overrides = {}) {
  return {
    id,
    user: { login: `reviewer-${id}` },
    author_association: "MEMBER",
    state: "APPROVED",
    submitted_at: "2026-08-27T00:00:00Z",
    commit_id: SOURCE_HEAD,
    body,
    ...overrides,
  };
}

function apiRun(id, overrides = {}) {
  return {
    id,
    path: ".github/workflows/ci.yml",
    head_sha: SOURCE_HEAD,
    event: "pull_request",
    status: "completed",
    conclusion: "success",
    created_at: "2026-08-27T00:00:00Z",
    ...overrides,
  };
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
  assert.equal(hasHandoffIntent("supersedes parser를 고칩니다"), false);
  assert.deepEqual(inspectHandoffBody("Closes #595"), {
    ok: true,
    required: false,
    reason: "일반 PR — 인계 evidence 비대상",
  });
});

test("title/body source marker는 정확히 하나이며 manifest/current PR과 결속한다", () => {
  const blockOnly = handoffBlock().replace(/^Supersedes PR #583\n\n/, "");
  const titleBound = inspectHandoffBody(blockOnly, { title: "Supersedes PR #583", currentPr: 595 });
  assert.equal(titleBound.ok, true);
  assert.equal(inspectHandoffBody("설명만", { title: "Supersedes PR #583", currentPr: 595 }).ok, false);
  assert.equal(inspectHandoffBody(blockOnly, { currentPr: 595 }).ok, false);

  const mismatch = handoffBlock().replace("Supersedes PR #583", "Supersedes PR #584");
  assert.equal(inspectHandoffBody(mismatch, { currentPr: 595 }).ok, false);
  const multiple = `${handoffBlock()}\nTakeover PR #583`;
  assert.equal(inspectHandoffBody(multiple, { currentPr: 595 }).ok, false);
  const ambiguous = `${handoffBlock()}\nTakeover PR #584`;
  assert.equal(inspectHandoffBody(ambiguous, { currentPr: 595 }).ok, false);
  assert.equal(inspectHandoffBody(handoffBlock(), { currentPr: 583 }).ok, false);

  const korean = handoffBlock().replace("Supersedes PR #583", "대체 PR #583");
  assert.equal(inspectHandoffBody(korean, { currentPr: 595 }).ok, true);
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
  const result = validateHandoffEvidence(none, sourceEvidence([reviewRecord(reviewBlock([]))]));
  assert.equal(result.ok, true);
  assert.match(result.reason, /0건/);
});

test("검수 미실시는 원본 exact not_run manifest와 빈 배열이 있어야 통과한다", () => {
  const body = handoffBlock({ reviewStatus: "not_run", findings: [] });
  assert.equal(validateHandoffEvidence(body, sourceEvidence()).ok, false);
  const result = validateHandoffEvidence(body, sourceEvidence([reviewRecord(reviewBlock([], "not_run"))]));
  assert.equal(result.ok, true);
  assert.match(result.reason, /미실시/);
});

test("검수 미실시에 finding을 붙이면 거부한다", () => {
  const result = inspectHandoffBody(handoffBlock({ reviewStatus: "not_run" }));
  assert.equal(result.ok, false);
});

test("원본 reviewed를 not_run으로 바꿔 적어 findings를 우회할 수 없다", () => {
  const body = handoffBlock({ reviewStatus: "not_run", findings: [] });
  const result = validateHandoffEvidence(body, sourceEvidence([reviewRecord(reviewBlock(sourceFindings))]));
  assert.equal(result.ok, false);
  assert.match(result.reason, /status/);
});

test("원본 exact review manifest가 없거나 SHA가 다르면 거부한다", () => {
  assert.equal(validateHandoffEvidence(handoffBlock(), sourceEvidence()).ok, false);
  const wrong = reviewBlock(sourceFindings).replace(SOURCE_HEAD, "4".repeat(40));
  assert.equal(validateHandoffEvidence(handoffBlock(), sourceEvidence([reviewRecord(wrong)])).ok, false);
});

test("원본 P0/P1 두 건과 dispositions를 exact 보존하면 통과한다", () => {
  const result = validateHandoffEvidence(handoffBlock(), sourceEvidence([
    commentRecord("unrelated untagged text", { id: "untagged", authorAssociation: "NONE" }),
    reviewRecord(reviewBlock(sourceFindings)),
  ]));
  assert.equal(result.ok, true);
  assert.match(result.reason, /2건/);
});

test("원본 finding 하나를 누락하면 거부한다", () => {
  const findings = sourceFindings.slice(0, 1).map((finding) => ({
    ...finding,
    disposition: { kind: "fixed", evidence: "test" },
  }));
  const result = validateHandoffEvidence(handoffBlock({ findings }), sourceEvidence([reviewRecord(reviewBlock(sourceFindings))]));
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
    sourceEvidence([reviewRecord(reviewBlock(sourceFindings))]),
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
    const result = validateHandoffEvidence(handoffBlock({ findings }), sourceEvidence([reviewRecord(reviewBlock(sourceFindings))]));
    assert.equal(result.ok, false, field);
    assert.match(result.reason, new RegExp(field));
  }
});

test("P0/P1은 고침/실제 불필요만 허용하고 deferred를 차단하며 P2/P3는 manifest 밖에 둔다", () => {
  const base = sourceFindings.map((finding) => ({ ...finding, disposition: { kind: "fixed", evidence: "test" } }));
  for (const bad of [
    { kind: "fixed", evidence: "" },
    { kind: "not_applicable", rationale: "" },
    { kind: "deferred", issue: 0 },
    { kind: "deferred", issue: 588 },
  ]) {
    const findings = JSON.parse(JSON.stringify(base));
    findings[0].disposition = bad;
    assert.equal(inspectHandoffBody(handoffBlock({ findings })).ok, false);
  }

  const dispositions = [
    { kind: "fixed", evidence: "file:test" },
    { kind: "not_applicable", rationale: "source path removed by newer main" },
  ];
  for (const disposition of dispositions) {
    const findings = JSON.parse(JSON.stringify(base));
    findings[0].disposition = disposition;
    assert.equal(validateHandoffEvidence(handoffBlock({ findings }), sourceEvidence([reviewRecord(reviewBlock(sourceFindings))])).ok, true);
  }

  for (const severity of ["P2", "P3"]) {
    const findings = JSON.parse(JSON.stringify(base));
    findings[0].severity = severity;
    const result = inspectHandoffBody(handoffBlock({ findings }));
    assert.equal(result.ok, false, severity);
    assert.match(result.reason, /P0 또는 P1/);
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
  const result = validateHandoffEvidence(handoffBlock(), sourceEvidence([
    reviewRecord(reviewBlock(sourceFindings), { id: "review-a" }),
    reviewRecord(reviewBlock(changed), { id: "review-b" }),
  ]));
  assert.equal(result.ok, false);
  assert.match(result.reason, /서로 다른/);
});

test("schema-valid 과거 exact는 history로 제외하되 target exact만 canonical 판정한다", () => {
  const old = reviewRecord(
    reviewBlock(sourceFindings, "reviewed", { exactHead: OLD_SOURCE_HEAD }),
    { id: "review-old", commitId: OLD_SOURCE_HEAD },
  );
  const target = reviewRecord(reviewBlock(sourceFindings), { id: "review-target" });
  const pass = validateHandoffEvidence(handoffBlock(), sourceEvidence([old, target]));
  assert.equal(pass.ok, true);
  assert.deepEqual(pass.provenance.map(({ id }) => id), ["review-target"]);

  const missingTarget = validateHandoffEvidence(handoffBlock(), sourceEvidence([old]));
  assert.equal(missingTarget.ok, false);
  assert.match(missingTarget.reason, /evidence가 없습니다/);
});

test("과거 exact라도 malformed/unauthorized면 전체 차단하고 다른 PR manifest도 context 위반이다", () => {
  const target = reviewRecord(reviewBlock(sourceFindings), { id: "review-target" });
  const malformedOld = reviewRecord("```moawork-review-findings\n{\n```", {
    id: "review-old-malformed",
    commitId: OLD_SOURCE_HEAD,
  });
  assert.equal(validateHandoffEvidence(handoffBlock(), sourceEvidence([target, malformedOld])).ok, false);

  const unauthorizedOld = reviewRecord(
    reviewBlock(sourceFindings, "reviewed", { exactHead: OLD_SOURCE_HEAD }),
    { id: "review-old-outsider", commitId: OLD_SOURCE_HEAD, authorAssociation: "NONE" },
  );
  assert.equal(validateHandoffEvidence(handoffBlock(), sourceEvidence([target, unauthorizedOld])).ok, false);

  const otherPr = reviewRecord(
    reviewBlock(sourceFindings, "reviewed", { pr: 584 }),
    { id: "review-other-pr" },
  );
  const wrongContext = validateHandoffEvidence(handoffBlock(), sourceEvidence([target, otherPr]));
  assert.equal(wrongContext.ok, false);
  assert.match(wrongContext.reason, /context/);
});

test("source PR body와 PR author 자가 comment/review는 독립 검수 증거가 아니다", () => {
  const emptyHandoff = handoffBlock({ findings: [] });
  const injectedBody = sourceEvidence([], { body: reviewBlock([]) });
  assert.equal(validateHandoffEvidence(emptyHandoff, injectedBody).ok, false);

  const selfComment = validateHandoffEvidence(emptyHandoff, sourceEvidence([
    commentRecord(reviewBlock([]), { author: SOURCE_AUTHOR }),
  ]));
  assert.equal(selfComment.ok, false);
  assert.match(selfComment.reason, /evidence가 없습니다/);

  const selfReview = validateHandoffEvidence(emptyHandoff, sourceEvidence([
    reviewRecord(reviewBlock([]), { author: SOURCE_AUTHOR }),
  ]));
  assert.equal(selfReview.ok, false);
  assert.match(selfReview.reason, /독립 검수 증거가 아닙니다/);
});

test("trusted non-author formal review만 canonical evidence로 허용하고 comment는 evidence0이다", () => {
  const emptyHandoff = handoffBlock({ findings: [] });
  for (const authorAssociation of ["OWNER", "MEMBER", "COLLABORATOR"]) {
    const formal = validateHandoffEvidence(emptyHandoff, sourceEvidence([
      reviewRecord(reviewBlock([]), { authorAssociation }),
    ]));
    assert.equal(formal.ok, true, authorAssociation);
    assert.equal(formal.provenance[0].kind, "review");
  }

  const repoComment = validateHandoffEvidence(emptyHandoff, sourceEvidence([commentRecord(reviewBlock([]))]));
  assert.equal(repoComment.ok, false);
  assert.match(repoComment.reason, /evidence가 없습니다/);

  for (const record of [
    reviewRecord(reviewBlock([]), { state: "COMMENTED" }),
    reviewRecord(reviewBlock([]), { commitId: "4".repeat(40) }),
    reviewRecord(reviewBlock([]), { authorAssociation: "NONE" }),
    reviewRecord(reviewBlock([]), { authorAssociation: "CONTRIBUTOR" }),
    commentRecord(reviewBlock([]), { authorAssociation: "CONTRIBUTOR" }),
  ]) {
    assert.equal(validateHandoffEvidence(emptyHandoff, sourceEvidence([record])).ok, false);
  }
});

test("tag 후보는 valid 하나와 malformed/invalid 하나가 공존해도 전체 fail-closed한다", () => {
  const valid = reviewRecord(reviewBlock(sourceFindings), { id: "valid" });
  const malformed = reviewRecord("```moawork-review-findings\n{\n```", { id: "malformed" });
  const invalid = reviewRecord("```moawork-review-findings\n{}\n```", { id: "invalid" });
  const unclosed = reviewRecord("```moawork-review-findings\n{", { id: "unclosed" });
  for (const hostile of [malformed, invalid, unclosed]) {
    const result = validateHandoffEvidence(handoffBlock(), sourceEvidence([valid, hostile]));
    assert.equal(result.ok, false, hostile.id);
  }
});

test("comments/reviews pagination은 page2와 100개 초과를 provenance 손실 없이 합친다", () => {
  const comments = parseReviewEvidencePages(JSON.stringify([
    Array.from({ length: 100 }, (_, index) => apiComment(index + 1)),
    [apiComment(101, reviewBlock(sourceFindings))],
  ]), "comment");
  assert.equal(comments.ok, true);
  assert.equal(comments.items.length, 101);
  assert.equal(comments.items[100].kind, "comment");
  assert.equal(comments.items[100].id, "101");

  const reviews = parseReviewEvidencePages(JSON.stringify([
    Array.from({ length: 100 }, (_, index) => apiReview(index + 1)),
    [apiReview(101, reviewBlock(sourceFindings))],
  ]), "review");
  assert.equal(reviews.ok, true);
  assert.equal(reviews.items.length, 101);
  assert.equal(reviews.items[100].commitId, SOURCE_HEAD);
});

test("page2 conflicting manifest와 partial page를 모두 차단한다", () => {
  const changed = structuredClone(sourceFindings);
  changed[0].title = "page2 conflict";
  const page1 = Array.from({ length: 100 }, (_, index) => apiReview(index + 1));
  page1[0] = apiReview(1, reviewBlock(sourceFindings));
  const parsed = parseReviewEvidencePages(JSON.stringify([page1, [apiReview(101, reviewBlock(changed))]]), "review");
  assert.equal(parsed.ok, true);
  const conflict = validateHandoffEvidence(handoffBlock(), sourceEvidence(parsed.items));
  assert.equal(conflict.ok, false);
  assert.match(conflict.reason, /서로 다른/);

  const partial = parseReviewEvidencePages(JSON.stringify([
    Array.from({ length: 99 }, (_, index) => apiComment(index + 1)),
    [apiComment(100)],
  ]), "comment");
  assert.equal(partial.ok, false);
  assert.match(partial.reason, /partial page/);
});

test("workflow runs pagination은 --slurp page를 100개 초과 단일 배열로 만들고 partial을 거부한다", () => {
  const pages = JSON.stringify([
    { total_count: 101, workflow_runs: Array.from({ length: 100 }, (_, index) => apiRun(index + 1)) },
    { total_count: 101, workflow_runs: [apiRun(101)] },
  ]);
  const result = parseWorkflowRunPages(pages);
  assert.equal(result.ok, true);
  assert.equal(result.items.length, 101);

  const partial = parseWorkflowRunPages(JSON.stringify([
    { total_count: 101, workflow_runs: Array.from({ length: 100 }, (_, index) => apiRun(index + 1)) },
    { total_count: 101, workflow_runs: [] },
  ]));
  assert.equal(partial.ok, false);
  assert.match(partial.reason, /partial/);
});

test("workflow run stable id·전역 unique·total snapshot을 fail-closed 검증한다", () => {
  const missingId = parseWorkflowRunPages(JSON.stringify([
    { total_count: 1, workflow_runs: [apiRun(1, { id: undefined })] },
  ]));
  assert.equal(missingId.ok, false);
  assert.match(missingId.reason, /stable integer id/);

  const invalidTimestamp = parseWorkflowRunPages(JSON.stringify([
    { total_count: 1, workflow_runs: [apiRun(1, { created_at: "not-a-time" })] },
  ]));
  assert.equal(invalidTimestamp.ok, false);
  assert.match(invalidTimestamp.reason, /timestamp/);

  const firstPage = Array.from({ length: 100 }, (_, index) => apiRun(index + 1));
  const omittedNewest = parseWorkflowRunPages(JSON.stringify([
    { total_count: 101, workflow_runs: firstPage },
    { total_count: 101, workflow_runs: [apiRun(100)] },
  ]));
  assert.equal(omittedNewest.ok, false);
  assert.match(omittedNewest.reason, /중복 workflow run id/);

  const totalRace = parseWorkflowRunPages(JSON.stringify([
    { total_count: 101, workflow_runs: firstPage },
    { total_count: 102, workflow_runs: [apiRun(101)] },
  ]));
  assert.equal(totalRace.ok, false);
  assert.match(totalRace.reason, /total_count/);
});

test("403/rate/network와 source metadata schema 실패는 controlled nonzero 판정으로 바뀐다", () => {
  const rate = loadPaginatedCollection(
    () => { throw new Error("HTTP 403 rate limit exceeded"); },
    (raw) => parseReviewEvidencePages(raw, "comment"),
    "원본 PR comments",
  );
  assert.equal(rate.ok, false);
  assert.match(rate.reason, /403 rate limit/);

  const metadata = parseSourcePrMetadata(JSON.stringify({ number: 583, body: reviewBlock([]), user: null }), 583);
  assert.equal(metadata.ok, false);
});
