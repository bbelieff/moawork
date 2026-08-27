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
const scopes = requestedScopes.length ? requestedScopes : (selfTest ? ["new"] : ["new", "contact"]);
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

for (const scope of scopes) {
  requireOverride(scope);
  const tab = app.tabs.get(scope);
  if (!tab) { failures.push(`${scope}: actual DefaultTab 없음`); continue; }
  if (scope === "new") {
    // #589의 38개 물리 컬럼을 그대로 보존하고 #602가 숫자 매출 컬럼 하나만 additive로 더한다.
    // 불투명한 app-only fingerprint만 갱신하지 않도록 rev4 전체 의미와 rev5 delta를 함께 검증한다.
    if (tab.revision !== 5 || JSON.stringify(tab.previousRevision) !== JSON.stringify({ revision: 4, columns: {} })) {
      failures.push("new: #602 revision 5/predecessor 4 계약 불일치");
    }
    if (tab.columns.length !== 39) failures.push(`new: columns ${tab.columns.length}/39`);
    const revenueColumns = tab.columns.filter((column) => column.key === "revenue_3y_million");
    const revenue = revenueColumns[0];
    const revenueIndex = tab.columns.indexOf(revenue);
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
      || revenueIndex !== 10 || tab.columns[revenueIndex - 1]?.key !== "revenue_band"
      || tab.columns[revenueIndex + 1]?.key !== "existing_loans") {
      failures.push("new: #602 revenue_3y_million 단일 additive 위치/의미 계약 불일치");
    }
    const revision4Columns = tab.columns.filter((column) => column.key !== "revenue_3y_million");
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
  }
  if (scope === "contact") {
    if (tab.columns.length !== 21) failures.push(`contact: columns ${tab.columns.length}/21`);
    if (tab.groups.filter((group) => group.assigneeSlot !== undefined).length !== 2) failures.push("contact: dynamic member groups 불일치");
    const linked = tab.columns.filter((column) => column.source === "lk");
    if (linked.some((column) => column.readOnly === true)) failures.push("contact: linked provenance가 편집 잠금됨");
    const transition = tab.transitions.find((entry) => entry.columnKey === "work_move");
    if (!transition || transition.guard?.columnKey !== "seal_status") failures.push("contact: transition seal guard 상실");
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
  console.log("qa-board-parity #602 semantic guard self-test: GREEN 1 + RED 3");
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
