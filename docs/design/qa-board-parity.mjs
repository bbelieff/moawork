/* Actual app parity gate for product default boards. The mockup self-check lives in qa-mockup.mjs. */
import { createHash } from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  compareContracts,
  loadAppContract,
  loadParityOverrides,
  loadTypeScriptModule,
} from "./qa-app.mjs";
import { extractMockupContract } from "./dump-mockup.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const requested = process.argv.slice(2);
const selfTest = requested.includes("--self-test");
const requestedScopes = requested.filter((argument) => argument !== "--self-test");
const scopes = requestedScopes.length ? requestedScopes : ["new", "contact"];
const allowed = new Set(["new", "contact"]);
if (scopes.some((scope) => !allowed.has(scope))) throw new Error("qa-board-parity supports: new contact");

const app = loadAppContract();
const defaultTabsDir = process.env.QA_APP_DEFAULT_TABS_DIR
  ?? path.join(ROOT, "app/src/lib/default-tabs");
const newLeadExports = scopes.includes("new")
  ? loadTypeScriptModule(path.join(defaultTabsDir, "new-lead.ts"))
  : null;
const newLeadDetailOnlyKeys = new Set(newLeadExports?.NEW_LEAD_DETAIL_ONLY_KEYS ?? []);
const overrides = loadParityOverrides();
const failures = [];
const requireOverride = (scope) => {
  if (!overrides.some((entry) => entry.scope === scope)) failures.push(`${scope}: issue/date/rationale override 없음`);
};
const requireIssueOverride = (scope, issue) => {
  if (!overrides.some((entry) => entry.scope === scope && entry.issue === issue)) {
    failures.push(`${scope}: #${issue} exact override 없음`);
  }
};

const ISSUE_602_REVISION_4_COLUMN_KEYS = [
  "applied_on", "ad_name", "rep_name", "phone", "owner", "collaborators",
  "biz_reg_type", "industry", "founded_month", "revenue_band", "existing_loans",
  "credit_score_ncb", "credit_score_kcb", "closed_business", "export_status", "required_amount",
  "sido", "sigungu", "address_detail", "email", "existing_loan_records", "credit_score",
  "documents", "consult_notes", "dispatch_status", "contact_status", "absence_notice",
  "consult1_notice", "confirm2_notice", "delay_notice", "malicious_absence_notice",
  "feedback_status", "recall_at", "meeting_at", "recontact_on", "contract_fee",
  "consult_status", "contact_move",
];
// Hash of the revision-4 physical 38 after stable normalization below. Recompute only when a
// reviewed predecessor contract intentionally changes; #602 itself must leave this anchor intact.
const ISSUE_602_REVISION_4_SEMANTIC_SHA256 = "e6a81376aa3cbc9ac9c5ce7c55b87b3c9351a61a3d490071833ed3658dc9d4f4";
const normalizeMoveTo = (moveTo) => moveTo
  ? Object.fromEntries(Object.entries(moveTo).sort(([left], [right]) => left.localeCompare(right)))
  : null;
const normalizeAssigneeMove = (assigneeMove) => assigneeMove
  ? {
    unassignedValue: assigneeMove.unassignedValue ?? null,
    unassignedGroup: assigneeMove.unassignedGroup ?? null,
    assignments: (assigneeMove.assignments ?? []).map((assignment) => ({
      assigneeSlot: assignment.assigneeSlot ?? null,
      groupAssigneeSlot: assignment.groupAssigneeSlot ?? null,
    })),
  }
  : null;
const normalizeColumnSemantics = (column, detailOnlyKeys) => ({
  key: column.key,
  label: column.label,
  type: column.type,
  source: column.source,
  width: column.width ?? null,
  rightPinned: Boolean(column.rightPinned),
  readOnly: Boolean(column.readOnly),
  pendingReason: column.pendingReason ?? null,
  options: (column.options ?? []).map((option) => ({
    id: option.id ?? null,
    label: option.label,
    order: option.order ?? null,
    color: option.color ?? null,
    archived: option.archived ?? null,
  })),
  moveTo: normalizeMoveTo(column.moveTo),
  assigneeMove: normalizeAssigneeMove(column.assigneeMove),
  detailOnly: detailOnlyKeys.has(column.key),
});
const semanticFingerprint = (columns, detailOnlyKeys) => createHash("sha256")
  .update(JSON.stringify(columns.map((column) => normalizeColumnSemantics(column, detailOnlyKeys))))
  .digest("hex");

const expectIssue602MutationRed = (label, revision4Columns, detailOnlyKeys, mutate) => {
  const mutatedColumns = structuredClone(revision4Columns);
  const mutatedDetailOnlyKeys = new Set(detailOnlyKeys);
  mutate(mutatedColumns, mutatedDetailOnlyKeys);
  if (semanticFingerprint(mutatedColumns, mutatedDetailOnlyKeys) === ISSUE_602_REVISION_4_SEMANTIC_SHA256) {
    failures.push(`new: #602 semantic guard self-test ${label}가 RED 아님`);
  }
};

const runIssue602SemanticGuardSelfTest = (revision4Columns, detailOnlyKeys) => {
  const oldDetailKey = revision4Columns.find((column) => detailOnlyKeys.has(column.key))?.key;
  if (!oldDetailKey) {
    failures.push("new: #602 semantic guard self-test 대상 detail-only key 없음");
  } else {
    expectIssue602MutationRed("detail-only membership", revision4Columns, detailOnlyKeys, (_columns, keys) => {
      keys.delete(oldDetailKey);
    });
  }

  const optionColumnIndex = revision4Columns.findIndex((column) => (column.options?.length ?? 0) > 0);
  if (optionColumnIndex < 0) {
    failures.push("new: #602 semantic guard self-test 대상 option 없음");
  } else {
    expectIssue602MutationRed("option.archived", revision4Columns, detailOnlyKeys, (columns) => {
      const option = columns[optionColumnIndex].options[0];
      option.archived = option.archived === true ? false : true;
    });
  }

  const ownerIndex = revision4Columns.findIndex((column) => column.key === "owner");
  if (ownerIndex < 0) {
    failures.push("new: #602 semantic guard self-test 대상 owner 없음");
  } else {
    expectIssue602MutationRed("owner.assigneeMove", revision4Columns, detailOnlyKeys, (columns) => {
      const current = columns[ownerIndex].assigneeMove;
      columns[ownerIndex].assigneeMove = current
        ? { ...current, unassignedValue: `${current.unassignedValue}-changed` }
        : {
          unassignedValue: "__unassigned__",
          unassignedGroup: "신규고객",
          assignments: [{ assigneeSlot: 0, groupAssigneeSlot: 0 }],
        };
    });
  }
};

const ISSUE_601_OTHER_INFO = {
  key: "other_info",
  label: "기타정보",
  type: "other_info",
  source: "in",
  width: 170,
  rightPinned: false,
  readOnly: false,
  pendingReason: null,
  options: [],
  moveTo: null,
  assigneeMove: null,
  detailOnly: false,
};
const ISSUE_601_CONFIG = {
  new: {
    predecessorCount: 39,
    predecessorSemantic: "ef6df021a480b396d8514c404877a1048423456a55350f2da43ffcb4b36ef90a",
    index: 16,
    before: "export_status",
    after: "required_amount",
  },
  contact: {
    predecessorCount: 21,
    predecessorSemantic: "0fd430405386bb500a57785a5a0c5c5d6b185ca4c1d66d9c9ac020ea79ca6bb6",
    index: 11,
    before: "revenue",
    after: "contract_status",
  },
};

const issue601ContractPasses = (columns, detailOnlyKeys, config) => {
  const matches = columns.filter((column) => column.key === "other_info");
  const otherInfo = matches[0];
  const index = columns.indexOf(otherInfo);
  const predecessor = columns.filter((column) => column.key !== "other_info");
  return matches.length === 1
    && columns.length === config.predecessorCount + 1
    && predecessor.length === config.predecessorCount
    && semanticFingerprint(predecessor, detailOnlyKeys) === config.predecessorSemantic
    && JSON.stringify(normalizeColumnSemantics(otherInfo ?? {}, detailOnlyKeys)) === JSON.stringify(ISSUE_601_OTHER_INFO)
    && index === config.index
    && columns[index - 1]?.key === config.before
    && columns[index + 1]?.key === config.after;
};

const runIssue601SemanticGuard = (scope, columns, detailOnlyKeys) => {
  const config = ISSUE_601_CONFIG[scope];
  if (!issue601ContractPasses(columns, detailOnlyKeys, config)) {
    failures.push(`${scope}: #601 predecessor 보존/other_info 단일 additive 위치·의미 계약 불일치`);
    return;
  }
  const mutations = [
    ["predecessor source", (items) => { items[0].source = `${items[0].source}-changed`; }],
    ["other_info type", (items) => { items.find((column) => column.key === "other_info").type = "text"; }],
    ["other_info order", (items) => { items.push(...items.splice(config.index, 1)); }],
    ["other_info visibility", (_items, keys) => { keys.add("other_info"); }],
  ];
  for (const [label, mutate] of mutations) {
    const mutatedColumns = structuredClone(columns);
    const mutatedKeys = new Set(detailOnlyKeys);
    mutate(mutatedColumns, mutatedKeys);
    if (issue601ContractPasses(mutatedColumns, mutatedKeys, config)) {
      failures.push(`${scope}: #601 semantic guard self-test ${label}가 RED 아님`);
    }
  }
};

// QA #884 (belie 2026-10-13): 탭 사이 칸 이름 통일 · 미팅 일시 한 곳 저장(읽기 전용) · 계약상황 취소/보류 이동.
// 이 변경만 정확히 되돌린 열 목록이 기존 #601/#602 선행 정본 fingerprint와 그대로 맞아야 한다.
// 즉 #884가 허용하는 것은 아래 열의 아래 속성뿐이고, 다른 열·속성 변경은 계속 RED다.
const stableJson = (value) => JSON.stringify(value, (_key, item) => (item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)))
  : item));
const ISSUE_884_CONTACT_MOVE_TO = {
  "계약 보류": "💰 계약보류(온/오프)",
  "미팅보류": "📍 미팅보류",
  "미팅취소": "📍 미팅취소",
  "계약취소": "📍 계약취소",
};
const ISSUE_884_CONFIG = {
  new: {
    revision: 7,
    previousRevision: { revision: 6, columns: { meeting_at: { label: "대면미팅 일시" } } },
    changes: {
      meeting_at: { before: { label: "대면미팅 일시" }, after: { label: "미팅 일시" } },
    },
  },
  contact: {
    revision: 4,
    previousRevision: {
      revision: 3,
      columns: {
        ad_name: { readOnly: true },
        applied_on: { readOnly: true },
        phone: { readOnly: true },
        industry: { readOnly: true },
        rep_name: { readOnly: true },
        email: { readOnly: true },
        revenue: { readOnly: true, label: "매출액" },
        founded_year: { label: "창업년도" },
        meeting_at: { label: "전자계약 / 미팅일정", readOnly: false },
        contract_fee_status: { label: "계약금 완료여부" },
        contract_status: { moveRule: "empty" },
      },
    },
    changes: {
      founded_year: { before: { label: "창업년도" }, after: { label: "창업연도" } },
      revenue: { before: { label: "매출액" }, after: { label: "매출" } },
      meeting_at: {
        before: { label: "전자계약 / 미팅일정", readOnly: undefined },
        after: { label: "미팅 일시", readOnly: true },
      },
      contract_fee_status: { before: { label: "계약금 완료여부" }, after: { label: "계약금 입금여부" } },
      contract_status: { before: { moveTo: undefined }, after: { moveTo: ISSUE_884_CONTACT_MOVE_TO } },
    },
  },
};

/** #884 변경이 정확히 들어 있으면 그 변경만 되돌린 열 목록을, 아니면 null을 돌려준다. */
const revertIssue884 = (scope, columns) => {
  const config = ISSUE_884_CONFIG[scope];
  const reverted = structuredClone(columns);
  for (const [key, change] of Object.entries(config.changes)) {
    const matches = reverted.filter((column) => column.key === key);
    if (matches.length !== 1) return null;
    const column = matches[0];
    for (const [property, expected] of Object.entries(change.after)) {
      if (stableJson(column[property] ?? null) !== stableJson(expected ?? null)) return null;
    }
    for (const [property, previous] of Object.entries(change.before)) {
      if (previous === undefined) delete column[property];
      else column[property] = previous;
    }
  }
  return reverted;
};

const issue884ContractPasses = (scope, tab, columns, detailOnlyKeys) => {
  const config = ISSUE_884_CONFIG[scope];
  if (tab.revision !== config.revision || stableJson(tab.previousRevision) !== stableJson(config.previousRevision)) return false;
  const reverted = revertIssue884(scope, columns);
  return Boolean(reverted) && issue601ContractPasses(reverted, detailOnlyKeys, ISSUE_601_CONFIG[scope]);
};

const runIssue884Guard = (scope, tab, detailOnlyKeys) => {
  requireIssueOverride(scope, 884);
  if (!issue884ContractPasses(scope, tab, tab.columns, detailOnlyKeys)) {
    failures.push(`${scope}: #884 revision ${ISSUE_884_CONFIG[scope].revision}/이름·읽기 전용·이동 규칙 exact 변경 계약 불일치`);
    return null;
  }
  const firstChanged = Object.keys(ISSUE_884_CONFIG[scope].changes)[0];
  const untouched = tab.columns.find((column) => column.key !== "other_info" && !(column.key in ISSUE_884_CONFIG[scope].changes));
  const mutations = [
    ["old label kept", (columns) => { columns.find((column) => column.key === firstChanged).label = ISSUE_884_CONFIG[scope].changes[firstChanged].before.label; }],
    ["unrelated label", (columns) => { columns.find((column) => column.key === untouched.key).label = `${untouched.label}-changed`; }],
    ["meeting_at readOnly", (columns) => { const column = columns.find((item) => item.key === "meeting_at"); column.readOnly = !column.readOnly; }],
    ["revision", (_columns, mutatedTab) => { mutatedTab.revision += 1; }],
  ];
  if (scope === "contact") {
    mutations.push(["contract_status extra move", (columns) => {
      columns.find((column) => column.key === "contract_status").moveTo["다시전화"] = "📍 미팅보류";
    }]);
  }
  for (const [label, mutate] of mutations) {
    const mutatedTab = { revision: tab.revision, previousRevision: structuredClone(tab.previousRevision) };
    const mutatedColumns = structuredClone(tab.columns);
    mutate(mutatedColumns, mutatedTab);
    if (issue884ContractPasses(scope, mutatedTab, mutatedColumns, detailOnlyKeys)) {
      failures.push(`${scope}: #884 semantic guard self-test ${label}가 RED 아님`);
    }
  }
  return revertIssue884(scope, tab.columns);
};

for (const scope of scopes) {
  requireOverride(scope);
  requireIssueOverride(scope, 601);
  const tab = app.tabs.get(scope);
  if (!tab) { failures.push(`${scope}: actual DefaultTab 없음`); continue; }
  if (scope === "new") {
    // #884 rev7은 meeting_at 이름만 바꿨다. 그 변경을 되돌린 rev6 열에 기존 #601/#602 guard를 그대로 실행한다.
    const revision6Columns = runIssue884Guard("new", tab, newLeadDetailOnlyKeys);
    if (!revision6Columns) continue;
    // #601 rev6에서 other_info를 걷어 낸 rev5를 대상으로 기존 #602 guard를 그대로 실행한다.
    const revision5Columns = revision6Columns.filter((column) => column.key !== "other_info");
    if (revision5Columns.length !== 39) failures.push(`new: #602 predecessor columns ${revision5Columns.length}/39`);
    const revenueColumns = revision5Columns.filter((column) => column.key === "revenue_3y_million");
    const revenue = revenueColumns[0];
    const revenueIndex = revision5Columns.indexOf(revenue);
    const expectedRevenue = {
      key: "revenue_3y_million",
      label: "3개년매출(백만원)",
      type: "number",
      source: "in",
      width: 150,
      rightPinned: false,
      readOnly: false,
      pendingReason: null,
      options: [],
      moveTo: null,
      assigneeMove: null,
      detailOnly: false,
    };
    if (revenueColumns.length !== 1
      || JSON.stringify(normalizeColumnSemantics(revenue ?? {}, newLeadDetailOnlyKeys)) !== JSON.stringify(expectedRevenue)
      || revenueIndex !== 10 || revision5Columns[revenueIndex - 1]?.key !== "revenue_band"
      || revision5Columns[revenueIndex + 1]?.key !== "existing_loans") {
      failures.push("new: #602 revenue_3y_million 단일 additive 위치/의미 계약 불일치");
    }
    const revision4Columns = revision5Columns.filter((column) => column.key !== "revenue_3y_million");
    if (revision4Columns.map((column) => column.key).join("|") !== ISSUE_602_REVISION_4_COLUMN_KEYS.join("|")) {
      failures.push("new: #602 rev4 물리 key/order 보존 실패");
    }
    if (semanticFingerprint(revision4Columns, newLeadDetailOnlyKeys) !== ISSUE_602_REVISION_4_SEMANTIC_SHA256) {
      failures.push("new: #602 rev4 column fields/options/move/assignee/detail-only 의미 보존 실패");
    }
    if (newLeadDetailOnlyKeys.has("revenue_3y_million")) failures.push("new: #602 revenue_3y_million detail-only visibility 불일치");
    runIssue602SemanticGuardSelfTest(revision4Columns, newLeadDetailOnlyKeys);
    for (const key of ["revenue_band", "credit_score_ncb", "credit_score_kcb", "founded_month"]) {
      if (tab.columns.filter((column) => column.key === key).length !== 1) failures.push(`new: #602 durable ${key} 보존 실패`);
    }
    if (tab.columns.some((column) => column.key === "credit_scores")) failures.push("new: #602 synthetic credit_scores 물리 컬럼 생성");
    const visibleGroups = tab.groups.map((group) => group.name.replace(/^[^가-힣A-Za-z0-9]+\s*/, ""));
    if (visibleGroups.join("|") !== "신규고객|2차 상담고객|1차 부재|보류|거절") failures.push("new: explicit group order 불일치");
    if (Object.keys(tab.columns.find((column) => column.key === "consult_status")?.moveTo ?? {}).length !== 6) failures.push("new: move rules 6 아님");
    runIssue601SemanticGuard("new", revision6Columns, newLeadDetailOnlyKeys);
  }
  if (scope === "contact") {
    // #884 rev4의 이름·읽기 전용·이동 규칙 변경만 되돌린 rev3 열에 기존 #601 guard를 그대로 실행한다.
    const revision3Columns = runIssue884Guard("contact", tab, new Set());
    if (!revision3Columns) continue;
    if (tab.columns.length !== 22) failures.push(`contact: columns ${tab.columns.length}/22`);
    if (tab.groups.filter((group) => group.assigneeSlot !== undefined).length !== 2) failures.push("contact: dynamic member groups 불일치");
    const linked = tab.columns.filter((column) => column.source === "lk");
    if (linked.some((column) => column.readOnly === true)) failures.push("contact: linked provenance가 편집 잠금됨");
    const transition = tab.transitions.find((entry) => entry.columnKey === "work_move");
    if (!transition || transition.guard?.columnKey !== "seal_status") failures.push("contact: transition seal guard 상실");
    runIssue601SemanticGuard("contact", revision3Columns, new Set());
  }
  const pinned = tab.columns.filter((column) => column.rightPinned);
  if (pinned.length !== 1) failures.push(`${scope}: pinned workflow gate ${pinned.length}/1`);
}

const parity = compareContracts(extractMockupContract(), app, overrides);
if (parity.differences !== 0) failures.push(`mockup/override: ${parity.differences} unexplained diff(s)`);

if (failures.length) {
  console.error(failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}

if (selfTest) {
  console.log("qa-board-parity #884/#602/#601 semantic guards: GREEN 5 + RED 20");
  process.exit(0);
}

const runtime = spawnSync(process.execPath, [path.join(ROOT, "node_modules/vitest/vitest.mjs"), "run",
  "src/lib/default-tabs/board-parity.contract.test.ts",
  "src/lib/default-tabs/new-lead.render.test.tsx",
  "src/lib/default-tabs/contact.render.test.tsx",
  "src/lib/default-tabs/contact.test.ts",
  "src/components/board/MemberPicker.test.tsx",
  "src/lib/crm/contactPipeline.test.ts",
], {
  cwd: path.join(ROOT, "app"),
  stdio: "inherit",
  env: { ...process.env, QA_BOARD_SCOPES: scopes.join(",") },
});
if (runtime.status !== 0) process.exit(runtime.status ?? 2);
console.log(`qa-board-parity ${scopes.join(" ")}: 0 unexplained diffs`);
