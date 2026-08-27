/**
 * takeover/supersedes PR 이 원본 exact-head 검수 결과까지 인계했는지 판정한다.
 *
 * 일반 PR 은 건드리지 않는다. 인계 의도가 명시된 PR 만 `moawork-handoff`
 * JSON block 을 요구하고, 원본 PR 의 `moawork-review-findings` block 과
 * P0/P1 항목을 exact 비교한다.
 */

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const FINDING_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const HANDOFF_TAG = "moawork-handoff";
const REVIEW_TAG = "moawork-review-findings";

function taggedBlocks(text, tag) {
  const blocks = [];
  const fence = /```([A-Za-z0-9_-]+)[ \t]*\r?\n([\s\S]*?)```/g;
  for (const match of String(text ?? "").matchAll(fence)) {
    if (match[1].toLowerCase() === tag) blocks.push(match[2].trim());
  }
  return blocks;
}

function parseJson(raw, label) {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, reason: `${label} JSON 을 읽지 못했습니다 — ${String(error?.message || error)}` };
  }
}

function nonBlank(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateFinding(finding, index, requireDisposition) {
  const at = `findings[${index}]`;
  if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
    return `${at} 가 객체가 아닙니다.`;
  }
  if (!nonBlank(finding.id) || !FINDING_ID_PATTERN.test(finding.id)) {
    return `${at}.id 는 영문·숫자·점·밑줄·대시로 된 고유값이어야 합니다.`;
  }
  if (finding.severity !== "P0" && finding.severity !== "P1") {
    return `${at}.severity 는 P0 또는 P1 이어야 합니다.`;
  }
  for (const field of ["title", "location", "reproduction"]) {
    if (!nonBlank(finding[field])) return `${at}.${field} 가 비었습니다.`;
  }
  if (!requireDisposition) return null;

  const disposition = finding.disposition;
  if (!disposition || typeof disposition !== "object" || Array.isArray(disposition)) {
    return `${at}.disposition 이 비었습니다.`;
  }
  if (disposition.kind === "fixed") {
    if (!nonBlank(disposition.evidence)) return `${at}.disposition.evidence 가 비었습니다.`;
    return null;
  }
  if (disposition.kind === "not_applicable") {
    if (!nonBlank(disposition.rationale)) return `${at}.disposition.rationale 가 비었습니다.`;
    return null;
  }
  if (disposition.kind === "deferred") {
    if (!Number.isInteger(disposition.issue) || disposition.issue <= 0) {
      return `${at}.disposition.issue 는 이월 GitHub Issue 번호여야 합니다.`;
    }
    return null;
  }
  return `${at}.disposition.kind 는 fixed/not_applicable/deferred 중 하나여야 합니다.`;
}

function validateFindingList(findings, requireDisposition) {
  if (!Array.isArray(findings)) return "findings 칸이 없습니다. 빈 배열 []은 ‘검수했지만 없음’, 칸 누락은 미확인입니다.";
  const ids = new Set();
  for (const [index, finding] of findings.entries()) {
    const problem = validateFinding(finding, index, requireDisposition);
    if (problem) return problem;
    if (ids.has(finding.id)) return `finding id ${finding.id} 가 중복됐습니다.`;
    ids.add(finding.id);
  }
  return null;
}

export function hasHandoffIntent(body) {
  const text = String(body ?? "");
  if (/<!--\s*moawork-handoff\s*-->/i.test(text)) return true;
  if (/```moawork-handoff\b/i.test(text)) return true;
  return [
    /\b(?:supersedes|superseding|takeover)\s+(?:PR\s*)?#?\d+/i,
    /(?:인계|대체)\s*(?:PR|pull request)\s*#?\d+/i,
    /원본\s*PR\s*#?\d+[\s\S]{0,200}(?:인계|대체)/i,
  ].some((pattern) => pattern.test(text));
}

/** PR 본문만으로 판정 가능한 형식·disposition 검증. */
export function inspectHandoffBody(body) {
  const required = hasHandoffIntent(body);
  if (!required) return { ok: true, required: false, reason: "일반 PR — 인계 evidence 비대상" };

  const blocks = taggedBlocks(body, HANDOFF_TAG);
  if (blocks.length !== 1) {
    return {
      ok: false,
      required: true,
      reason: `takeover/supersedes PR 은 ${HANDOFF_TAG} JSON block 이 정확히 1개여야 합니다 (현재 ${blocks.length}개).`,
    };
  }
  const parsed = parseJson(blocks[0], HANDOFF_TAG);
  if (!parsed.ok) return { ...parsed, required: true };
  const evidence = parsed.value;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return { ok: false, required: true, reason: `${HANDOFF_TAG} 가 객체가 아닙니다.` };
  }
  if (evidence.version !== 1) return { ok: false, required: true, reason: "handoff version 은 1이어야 합니다." };
  if (evidence.kind !== "takeover" && evidence.kind !== "supersedes") {
    return { ok: false, required: true, reason: "handoff kind 는 takeover 또는 supersedes 여야 합니다." };
  }
  if (!Number.isInteger(evidence.sourcePr) || evidence.sourcePr <= 0) {
    return { ok: false, required: true, reason: "sourcePr 가 유효한 원본 PR 번호가 아닙니다." };
  }
  if (!nonBlank(evidence.sourceExactHead) || !SHA_PATTERN.test(evidence.sourceExactHead)) {
    return { ok: false, required: true, reason: "sourceExactHead 는 원본 검수 exact 40자리 SHA여야 합니다." };
  }
  if (evidence.reviewStatus !== "reviewed" && evidence.reviewStatus !== "not_run") {
    return { ok: false, required: true, reason: "reviewStatus 는 reviewed 또는 not_run 이어야 합니다. 빈칸은 허용하지 않습니다." };
  }
  const findingProblem = validateFindingList(evidence.findings, true);
  if (findingProblem) return { ok: false, required: true, reason: findingProblem };
  if (evidence.reviewStatus === "not_run" && evidence.findings.length !== 0) {
    return { ok: false, required: true, reason: "reviewStatus=not_run 이면 findings 는 명시적 빈 배열 []이어야 합니다." };
  }
  return { ok: true, required: true, evidence, reason: "handoff 본문 형식 통과" };
}

function inspectReviewManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: "review manifest가 객체가 아닙니다." };
  if (value.version !== 1) return { ok: false, reason: "review manifest version은 1이어야 합니다." };
  if (!Number.isInteger(value.pr) || value.pr <= 0) return { ok: false, reason: "review manifest pr이 유효하지 않습니다." };
  if (!nonBlank(value.exactHead) || !SHA_PATTERN.test(value.exactHead)) return { ok: false, reason: "review manifest exactHead가 40자리 SHA가 아닙니다." };
  if (value.status !== "reviewed" && value.status !== "not_run") {
    return { ok: false, reason: "review manifest status는 reviewed 또는 not_run이어야 합니다." };
  }
  const findingProblem = validateFindingList(value.findings, false);
  if (findingProblem) return { ok: false, reason: findingProblem };
  if (value.status === "not_run" && value.findings.length !== 0) {
    return { ok: false, reason: "review manifest status=not_run이면 findings는 []이어야 합니다." };
  }
  return { ok: true, value };
}

function findingCore(finding) {
  return {
    id: finding.id,
    severity: finding.severity,
    title: finding.title.trim(),
    location: finding.location.trim(),
    reproduction: finding.reproduction.trim(),
  };
}

/** 원본 PR 본문·댓글·review body의 manifest와 handoff 항목을 exact 대조한다. */
export function validateHandoffEvidence(body, sourceTexts = []) {
  const inspected = inspectHandoffBody(body);
  if (!inspected.ok || !inspected.required) return inspected;
  const evidence = inspected.evidence;

  const matching = [];
  let malformed = 0;
  for (const text of sourceTexts) {
    for (const raw of taggedBlocks(text, REVIEW_TAG)) {
      const parsed = parseJson(raw, REVIEW_TAG);
      if (!parsed.ok) { malformed += 1; continue; }
      const review = inspectReviewManifest(parsed.value);
      if (!review.ok) { malformed += 1; continue; }
      if (review.value.pr === evidence.sourcePr && review.value.exactHead === evidence.sourceExactHead) {
        matching.push(review.value);
      }
    }
  }
  if (matching.length === 0) {
    return {
      ok: false,
      required: true,
      reason: `원본 PR #${evidence.sourcePr} exact ${evidence.sourceExactHead.slice(0, 7)}의 ${REVIEW_TAG} evidence가 없습니다${malformed ? ` (읽지 못한 block ${malformed}개)` : ""}.`,
    };
  }

  const canonical = matching.map((review) => JSON.stringify({
    status: review.status,
    findings: review.findings.map(findingCore).sort((a, b) => a.id.localeCompare(b.id)),
  }));
  if (new Set(canonical).size !== 1) {
    return { ok: false, required: true, reason: "같은 원본 exact의 review manifests가 서로 다른 findings를 주장합니다." };
  }
  if (matching[0].status !== evidence.reviewStatus) {
    return {
      ok: false,
      required: true,
      reason: `원본 review status(${matching[0].status})와 인계 reviewStatus(${evidence.reviewStatus})가 다릅니다.`,
    };
  }

  const sourceFindings = new Map(matching[0].findings.map((finding) => [finding.id, findingCore(finding)]));
  const handedFindings = new Map(evidence.findings.map((finding) => [finding.id, findingCore(finding)]));
  const missing = [...sourceFindings.keys()].filter((id) => !handedFindings.has(id));
  const extra = [...handedFindings.keys()].filter((id) => !sourceFindings.has(id));
  if (missing.length > 0) return { ok: false, required: true, reason: `원본 P0/P1 finding이 인계에서 누락됐습니다 — ${missing.join(", ")}.` };
  if (extra.length > 0) return { ok: false, required: true, reason: `원본 review manifest에 없는 finding이 인계 목록에 섞였습니다 — ${extra.join(", ")}.` };

  for (const [id, source] of sourceFindings) {
    const handed = handedFindings.get(id);
    for (const field of ["severity", "title", "location", "reproduction"]) {
      if (source[field] !== handed[field]) {
        return { ok: false, required: true, reason: `finding ${id}의 ${field}가 원본 exact review와 다릅니다.` };
      }
    }
  }
  return {
    ok: true,
    required: true,
    evidence,
    reason: evidence.reviewStatus === "not_run"
      ? "원본 exact 검수 미실시 evidence를 명시적으로 보존함"
      : `원본 exact P0/P1 ${sourceFindings.size}건을 항목별로 보존·처리함`,
  };
}
