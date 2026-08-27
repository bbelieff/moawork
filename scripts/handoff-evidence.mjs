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
const PAGE_SIZE = 100;
const REPO_REVIEWER_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

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

function parseSlurpedPages(raw, label) {
  const parsed = parseJson(raw, label);
  if (!parsed.ok) return parsed;
  if (!Array.isArray(parsed.value) || parsed.value.length === 0) {
    return { ok: false, reason: `${label} pagination 결과가 page 배열이 아닙니다.` };
  }
  return { ok: true, pages: parsed.value };
}

function completePageItems(pages, label, readPage) {
  const items = [];
  for (const [pageIndex, page] of pages.entries()) {
    const read = readPage(page, pageIndex);
    if (!read.ok) return read;
    if (read.items.length > PAGE_SIZE) {
      return { ok: false, reason: `${label} page ${pageIndex + 1}가 ${PAGE_SIZE}개를 초과했습니다.` };
    }
    if (pageIndex < pages.length - 1 && read.items.length !== PAGE_SIZE) {
      return { ok: false, reason: `${label} page ${pageIndex + 1}가 ${read.items.length}개에서 끊긴 partial page입니다.` };
    }
    items.push(...read.items);
  }
  return { ok: true, items };
}

function evidenceRecord(item, kind, at) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return { ok: false, reason: `${at}가 객체가 아닙니다.` };
  }
  const id = typeof item.id === "number" || typeof item.id === "string" ? String(item.id) : "";
  const author = item.user?.login;
  const authorAssociation = item.author_association;
  const body = item.body;
  if (!id || !nonBlank(author) || !nonBlank(authorAssociation) || (typeof body !== "string" && body !== null)) {
    return { ok: false, reason: `${at}의 id/user.login/author_association/body schema가 불완전합니다.` };
  }
  if (kind === "comment") {
    if (!nonBlank(item.created_at)) return { ok: false, reason: `${at}.created_at이 비었습니다.` };
    return { ok: true, value: {
      kind,
      id,
      author,
      authorAssociation,
      state: null,
      createdAt: item.created_at,
      commitId: null,
      body: body ?? "",
    } };
  }
  if (!nonBlank(item.state) || (item.submitted_at !== null && !nonBlank(item.submitted_at)) || (item.commit_id !== null && !nonBlank(item.commit_id))) {
    return { ok: false, reason: `${at}의 state/submitted_at/commit_id schema가 불완전합니다.` };
  }
  return { ok: true, value: {
    kind,
    id,
    author,
    authorAssociation,
    state: item.state,
    createdAt: item.submitted_at,
    commitId: item.commit_id,
    body: body ?? "",
  } };
}

/** `gh api --paginate --slurp` comments/reviews 결과를 provenance 보존 배열로 바꾼다. */
export function parseReviewEvidencePages(raw, kind) {
  if (kind !== "comment" && kind !== "review") return { ok: false, reason: "evidence kind는 comment/review여야 합니다." };
  const label = `원본 PR ${kind}`;
  const parsed = parseSlurpedPages(raw, label);
  if (!parsed.ok) return parsed;
  const complete = completePageItems(parsed.pages, label, (page, pageIndex) => {
    if (!Array.isArray(page)) return { ok: false, reason: `${label} page ${pageIndex + 1}가 배열이 아닙니다.` };
    const values = [];
    for (const [itemIndex, item] of page.entries()) {
      const normalized = evidenceRecord(item, kind, `${label} page ${pageIndex + 1}[${itemIndex}]`);
      if (!normalized.ok) return normalized;
      values.push(normalized.value);
    }
    return { ok: true, items: values };
  });
  if (!complete.ok) return complete;
  const ids = new Set();
  for (const item of complete.items) {
    const key = `${item.kind}:${item.id}`;
    if (ids.has(key)) return { ok: false, reason: `${label} pagination에 중복 id ${item.id}가 있습니다.` };
    ids.add(key);
  }
  return complete;
}

/** `gh api --paginate --slurp` workflow-runs 결과를 누락 없는 단일 배열로 바꾼다. */
export function parseWorkflowRunPages(raw) {
  const label = "CI 실행 목록";
  const parsed = parseSlurpedPages(raw, label);
  if (!parsed.ok) return parsed;
  let totalCount = null;
  const complete = completePageItems(parsed.pages, label, (page, pageIndex) => {
    if (!page || typeof page !== "object" || Array.isArray(page) || !Number.isInteger(page.total_count) || !Array.isArray(page.workflow_runs)) {
      return { ok: false, reason: `${label} page ${pageIndex + 1} schema가 불완전합니다.` };
    }
    if (totalCount === null) totalCount = page.total_count;
    else if (totalCount !== page.total_count) return { ok: false, reason: `${label} total_count가 page 사이에서 바뀌었습니다.` };
    for (const [itemIndex, run] of page.workflow_runs.entries()) {
      const stableId = Number.isSafeInteger(run?.id) && run.id > 0;
      const validCreatedAt = nonBlank(run?.created_at) && Number.isFinite(Date.parse(run.created_at));
      if (!stableId || !validCreatedAt || !run || typeof run !== "object" || !nonBlank(run.path) || !nonBlank(run.head_sha) || !nonBlank(run.event)
        || !nonBlank(run.status) || !nonBlank(run.created_at) || (run.conclusion !== null && typeof run.conclusion !== "string")) {
        return { ok: false, reason: `${label} page ${pageIndex + 1}[${itemIndex}]의 positive stable integer id/timestamp/schema가 불완전합니다.` };
      }
    }
    return { ok: true, items: page.workflow_runs };
  });
  if (!complete.ok) return complete;
  const runIds = new Set();
  for (const run of complete.items) {
    const id = String(run.id);
    if (runIds.has(id)) return { ok: false, reason: `${label} pagination에 중복 workflow run id ${id}가 있습니다.` };
    runIds.add(id);
  }
  if (complete.items.length !== totalCount) {
    return { ok: false, reason: `${label}이 partial입니다 — total ${totalCount}, fetched ${complete.items.length}.` };
  }
  return complete;
}

/** 네트워크/403/rate 실패를 예외 대신 controlled fail-closed 결과로 바꾸는 순수 fetch seam. */
export function loadPaginatedCollection(fetchSlurped, parser, label) {
  try {
    const parsed = parser(fetchSlurped());
    return parsed.ok ? parsed : { ok: false, reason: `${label} 실패 — ${parsed.reason}` };
  } catch (error) {
    return { ok: false, reason: `${label} 조회 실패 — ${String(error?.message || error)}` };
  }
}

export function parseSourcePrMetadata(raw, expectedPr) {
  const parsed = parseJson(raw, "원본 PR metadata");
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  if (!value || typeof value !== "object" || Array.isArray(value) || value.number !== expectedPr || !nonBlank(value.user?.login)) {
    return { ok: false, reason: "원본 PR number/author metadata가 불완전합니다." };
  }
  return { ok: true, value: { number: value.number, author: value.user.login } };
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
  return `${at}.disposition.kind 는 fixed 또는 not_applicable 이어야 합니다. P0/P1은 후속 Issue로 이월할 수 없습니다.`;
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

const HANDOFF_REFERENCE_PATTERNS = [
  /^\s*(?:supersedes|takeover)\s+PR\s+#?(\d+)\s*$/i,
  /^\s*(?:인계|대체)\s*(?:PR|pull request)\s*#?(\d+)\s*$/i,
];

function explicitHandoffReferences(body, title) {
  const lines = [String(title ?? ""), ...String(body ?? "").split(/\r?\n/)];
  const refs = [];
  for (const line of lines) {
    for (const pattern of HANDOFF_REFERENCE_PATTERNS) {
      const matched = pattern.exec(line);
      if (matched) {
        refs.push(Number(matched[1]));
        break;
      }
    }
  }
  return refs;
}

export function hasHandoffIntent(body, { title = "" } = {}) {
  const text = String(body ?? "");
  if (/```moawork-handoff\b/i.test(text)) return true;
  return explicitHandoffReferences(text, title).length > 0;
}

/** PR title+body와 current PR 번호만으로 판정 가능한 형식·disposition 검증. */
export function inspectHandoffBody(body, { title = "", currentPr = null } = {}) {
  const refs = explicitHandoffReferences(body, title);
  const required = hasHandoffIntent(body, { title });
  if (!required) return { ok: true, required: false, reason: "일반 PR — 인계 evidence 비대상" };

  if (refs.length !== 1) {
    return {
      ok: false,
      required: true,
      reason: `handoff source marker는 title 또는 독립 line에 정확히 1개여야 합니다 (현재 ${refs.length}개).`,
    };
  }

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
  if (evidence.sourcePr !== refs[0]) {
    return { ok: false, required: true, reason: `명시한 source PR #${refs[0]}과 manifest sourcePr #${evidence.sourcePr}가 다릅니다.` };
  }
  if (Number.isInteger(currentPr) && evidence.sourcePr === currentPr) {
    return { ok: false, required: true, reason: `sourcePr #${evidence.sourcePr}가 현재 PR과 같습니다. 자기 자신을 인계 source로 삼을 수 없습니다.` };
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

function provenanceProblem(record, sourcePr) {
  if (!record || typeof record !== "object" || Array.isArray(record) || !nonBlank(record.id)
    || !nonBlank(record.author) || !nonBlank(record.authorAssociation) || typeof record.body !== "string") {
    return "review evidence provenance schema가 불완전합니다.";
  }
  if (record.author.toLowerCase() === sourcePr.author.toLowerCase()) {
    return `원본 PR author(${record.author})가 남긴 ${record.kind}는 독립 검수 증거가 아닙니다.`;
  }
  if (record.kind !== "review") {
    return `review evidence kind(${record.kind})는 canonical formal review가 아닙니다.`;
  }
  const state = String(record.state || "").toUpperCase();
  if (state !== "APPROVED" && state !== "CHANGES_REQUESTED") {
    return `formal review ${record.id} state(${state || "없음"})는 검수 증거가 아닙니다.`;
  }
  if (!REPO_REVIEWER_ASSOCIATIONS.has(String(record.authorAssociation).toUpperCase())) {
    return `formal review ${record.id} authorAssociation(${record.authorAssociation})은 trusted repo reviewer가 아닙니다.`;
  }
  if (!nonBlank(record.commitId) || !SHA_PATTERN.test(record.commitId)) {
    return `formal review ${record.id} commitId가 유효한 exact SHA가 아닙니다.`;
  }
  if (!nonBlank(record.createdAt)) return `formal review ${record.id} createdAt이 비었습니다.`;
  return null;
}

/** 원본 PR body/comment는 제외하고 provenance가 보존된 formal review manifest만 exact 대조한다. */
export function validateHandoffEvidence(body, source = null, context = {}) {
  const inspected = inspectHandoffBody(body, context);
  if (!inspected.ok || !inspected.required) return inspected;
  const evidence = inspected.evidence;

  if (!source || typeof source !== "object" || Array.isArray(source)
    || !source.pr || source.pr.number !== evidence.sourcePr || !nonBlank(source.pr.author)
    || !Array.isArray(source.records)) {
    return { ok: false, required: true, reason: "원본 PR author와 paginated review provenance를 확인하지 못했습니다." };
  }

  const matching = [];
  for (const record of source.records) {
    // GitHub comments는 minimized lifecycle을 이 endpoint에서 증명할 수 없다.
    // self-assertion을 피하려고 canonical evidence에서 완전히 제외한다.
    if (record?.kind === "comment") continue;
    if (!record || typeof record.body !== "string") {
      return { ok: false, required: true, reason: "review evidence record schema가 불완전합니다." };
    }
    const tagged = new RegExp("```" + REVIEW_TAG + "\\b", "i").test(record.body);
    if (!tagged) continue;
    const provenance = provenanceProblem(record, source.pr);
    if (provenance) return { ok: false, required: true, reason: provenance };
    const blocks = taggedBlocks(record.body, REVIEW_TAG);
    if (blocks.length === 0) {
      return { ok: false, required: true, reason: `${record.kind} ${record.id}의 ${REVIEW_TAG} block이 닫히지 않았습니다.` };
    }
    for (const raw of blocks) {
      const parsed = parseJson(raw, REVIEW_TAG);
      if (!parsed.ok) return { ...parsed, required: true };
      const review = inspectReviewManifest(parsed.value);
      if (!review.ok) return { ...review, required: true };
      if (review.value.pr !== evidence.sourcePr) {
        return { ok: false, required: true, reason: `${record.kind} ${record.id}의 review manifest PR #${review.value.pr}가 source PR #${evidence.sourcePr} context와 다릅니다.` };
      }
      if (record.kind === "review" && record.commitId !== review.value.exactHead) {
        return { ok: false, required: true, reason: `formal review ${record.id} commitId가 해당 manifest exact와 다릅니다.` };
      }
      // 같은 source PR의 schema/provenance-valid 과거 exact는 durable history다.
      // 적대적 후보 검증은 위에서 이미 끝냈고, target exact canonical set에서만 제외한다.
      if (review.value.exactHead !== evidence.sourceExactHead) continue;
      matching.push({ manifest: review.value, provenance: {
        kind: record.kind,
        id: record.id,
        author: record.author,
        state: record.state,
        createdAt: record.createdAt,
        commitId: record.commitId,
      } });
    }
  }
  if (matching.length === 0) {
    return {
      ok: false,
      required: true,
      reason: `원본 PR #${evidence.sourcePr} exact ${evidence.sourceExactHead.slice(0, 7)}의 독립 ${REVIEW_TAG} evidence가 없습니다.`,
    };
  }

  const canonical = matching.map(({ manifest }) => JSON.stringify({
    status: manifest.status,
    findings: manifest.findings.map(findingCore).sort((a, b) => a.id.localeCompare(b.id)),
  }));
  if (new Set(canonical).size !== 1) {
    return { ok: false, required: true, reason: "같은 원본 exact의 review manifests가 서로 다른 findings를 주장합니다." };
  }
  if (matching[0].manifest.status !== evidence.reviewStatus) {
    return {
      ok: false,
      required: true,
      reason: `원본 review status(${matching[0].manifest.status})와 인계 reviewStatus(${evidence.reviewStatus})가 다릅니다.`,
    };
  }

  const sourceFindings = new Map(matching[0].manifest.findings.map((finding) => [finding.id, findingCore(finding)]));
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
    provenance: matching.map(({ provenance }) => provenance),
    reason: evidence.reviewStatus === "not_run"
      ? "원본 exact 검수 미실시 evidence를 명시적으로 보존함"
      : `원본 exact P0/P1 ${sourceFindings.size}건을 항목별로 보존·처리함`,
  };
}
