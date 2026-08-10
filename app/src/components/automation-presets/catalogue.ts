export type AutomationDraft = {
  id: string;
  triggerStatus: string;
  targetGroup: string;
  confidence: "high";
  state: "draft_disabled";
};

export type QuarantinedAutomation = {
  id: string;
  reason: "unsupported_external_action" | "missing_recipe" | "ambiguous_dependency";
};

// 내부 납품 검토용 일반화 catalog. Workspace, 사용자, 보드, 실제 항목은 포함하지 않는다.
export const HIGH_CONFIDENCE_STATUS_TO_GROUP_DRAFTS: readonly AutomationDraft[] = [
  ["draft-status-group-01", "준비", "시작 전"],
  ["draft-status-group-02", "확인", "검토 중"],
  ["draft-status-group-03", "진행", "진행 중"],
  ["draft-status-group-04", "보류", "대기"],
  ["draft-status-group-05", "완료", "완료"],
  ["draft-status-group-06", "재검토", "검토 중"],
  ["draft-status-group-07", "승인 대기", "대기"],
  ["draft-status-group-08", "승인", "진행 중"],
  ["draft-status-group-09", "중단", "보류"],
  ["draft-status-group-10", "후속 필요", "확인"],
  ["draft-status-group-11", "기록 완료", "완료"],
].map(([id, triggerStatus, targetGroup]) => ({
  id,
  triggerStatus,
  targetGroup,
  confidence: "high" as const,
  state: "draft_disabled" as const,
}));

export const QUARANTINED_AUTOMATIONS: readonly QuarantinedAutomation[] = [
  { id: "quarantine-01", reason: "unsupported_external_action" },
  { id: "quarantine-02", reason: "missing_recipe" },
  { id: "quarantine-03", reason: "ambiguous_dependency" },
  { id: "quarantine-04", reason: "unsupported_external_action" },
  { id: "quarantine-05", reason: "missing_recipe" },
  { id: "quarantine-06", reason: "ambiguous_dependency" },
  { id: "quarantine-07", reason: "unsupported_external_action" },
  { id: "quarantine-08", reason: "missing_recipe" },
];

export const AUTOMATION_ACTIVATION_BLOCK_MESSAGE =
  "자동화 저장소와 권한 확인이 준비된 뒤에만 켤 수 있어요. 지금은 초안만 검토할 수 있어요.";
