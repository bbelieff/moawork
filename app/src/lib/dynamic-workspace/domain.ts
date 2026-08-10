/**
 * Dynamic Workspace의 순수 편집 도메인.
 *
 * 이 모듈은 저장소/RPC/UI를 호출하지 않는다. 호출자는 인증된 owner 범위의
 * draft를 로드한 뒤 이 전이 결과를 원자적으로 저장해야 한다.
 */

export type DynamicWorkspaceId = string;
export type DynamicOrgId = string;
export type DynamicTabId = string;
export type DynamicBoardId = string;
export type DynamicMatrixId = string;
export type DynamicSourceId = string;
export type DynamicRelationId = string;

export type MatrixSource =
  | { mode: "same_source_view"; sourceId: DynamicSourceId; viewId: string }
  | { mode: "independent"; sourceId: DynamicSourceId }
  | { mode: "relational"; sourceId: DynamicSourceId; relationId: DynamicRelationId; relatedSourceId: DynamicSourceId };

export interface DynamicMatrix {
  id: DynamicMatrixId;
  source: MatrixSource;
  order: number;
}

export interface DynamicTab {
  id: DynamicTabId;
  boardId: DynamicBoardId;
  label: string;
  order: number;
  matrices: DynamicMatrix[];
}

export interface DynamicWorkspaceDraft {
  orgId: DynamicOrgId;
  workspaceId: DynamicWorkspaceId;
  version: number;
  tabs: DynamicTab[];
  audit: readonly DynamicAuditEvent[];
}

export interface DynamicAuditEvent {
  type: "tab_added" | "matrix_added" | "tab_renamed" | "tab_reordered" | "matrix_removed";
  targetId: string;
  version: number;
}

export interface DynamicWorkspacePublication {
  workspaceId: DynamicWorkspaceId;
  orgId: DynamicOrgId;
  revision: number;
  publishedBy: string;
  draft: DynamicWorkspaceDraft;
}

export interface CsvDryRunSeam {
  dryRun(input: { orgId: DynamicOrgId; sourceId: DynamicSourceId; mappingVersion: string }): Promise<{
    accepted: boolean;
    issueCount: number;
  }>;
}

export class DynamicWorkspaceRuleError extends Error {}
export class DynamicWorkspaceStaleVersionError extends DynamicWorkspaceRuleError {}

function nextVersion(draft: DynamicWorkspaceDraft, event: Omit<DynamicAuditEvent, "version">): DynamicWorkspaceDraft {
  const version = draft.version + 1;
  return { ...draft, version, audit: [...draft.audit, { ...event, version }] };
}

function requireVersion(draft: DynamicWorkspaceDraft, expectedVersion: number) {
  if (draft.version !== expectedVersion) {
    throw new DynamicWorkspaceStaleVersionError("다른 변경이 먼저 저장되어 최신 상태를 다시 확인해야 합니다.");
  }
}

function requireTab(draft: DynamicWorkspaceDraft, tabId: DynamicTabId): DynamicTab {
  const tab = draft.tabs.find((candidate) => candidate.id === tabId);
  if (!tab) throw new DynamicWorkspaceRuleError("탭을 찾을 수 없습니다.");
  return tab;
}

function normaliseLabel(label: string) {
  return label.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
}

function reindex<T extends { order: number }>(items: readonly T[]): T[] {
  return items.map((item, order) => ({ ...item, order }));
}

function validateSource(source: MatrixSource) {
  if (!source.sourceId) throw new DynamicWorkspaceRuleError("데이터 원본을 선택해야 합니다.");
  if (source.mode === "same_source_view" && !source.viewId) {
    throw new DynamicWorkspaceRuleError("같은 데이터 보기는 viewId가 필요합니다.");
  }
  if (source.mode === "relational") {
    if (!source.relationId || !source.relatedSourceId || source.relatedSourceId === source.sourceId) {
      throw new DynamicWorkspaceRuleError("관계형 보기는 서로 다른 원본과 관계 ID가 필요합니다.");
    }
  }
}

export function createDynamicWorkspaceDraft(input: {
  orgId: DynamicOrgId;
  workspaceId: DynamicWorkspaceId;
}): DynamicWorkspaceDraft {
  if (!input.orgId || !input.workspaceId) throw new DynamicWorkspaceRuleError("조직과 Workspace 범위가 필요합니다.");
  return { ...input, version: 0, tabs: [], audit: [] };
}

export function addTab(
  draft: DynamicWorkspaceDraft,
  expectedVersion: number,
  input: { id: DynamicTabId; boardId: DynamicBoardId; label: string },
): DynamicWorkspaceDraft {
  requireVersion(draft, expectedVersion);
  const label = input.label.trim();
  if (!input.id || !input.boardId || !label) throw new DynamicWorkspaceRuleError("탭 ID, 보드 ID, 이름이 필요합니다.");
  if (draft.tabs.some((tab) => tab.id === input.id)) throw new DynamicWorkspaceRuleError("같은 탭 ID를 다시 사용할 수 없습니다.");
  if (draft.tabs.some((tab) => normaliseLabel(tab.label) === normaliseLabel(label))) {
    throw new DynamicWorkspaceRuleError("같은 Workspace 안에 같은 탭 이름을 사용할 수 없습니다.");
  }
  const next = nextVersion(draft, { type: "tab_added", targetId: input.id });
  return { ...next, tabs: [...next.tabs, { ...input, label, order: next.tabs.length, matrices: [] }] };
}

export function addMatrix(
  draft: DynamicWorkspaceDraft,
  expectedVersion: number,
  tabId: DynamicTabId,
  input: { id: DynamicMatrixId; source: MatrixSource },
): DynamicWorkspaceDraft {
  requireVersion(draft, expectedVersion);
  const tab = requireTab(draft, tabId);
  validateSource(input.source);
  if (!input.id || draft.tabs.some((candidate) => candidate.matrices.some((matrix) => matrix.id === input.id))) {
    throw new DynamicWorkspaceRuleError("같은 Matrix ID를 다시 사용할 수 없습니다.");
  }
  const next = nextVersion(draft, { type: "matrix_added", targetId: input.id });
  return {
    ...next,
    tabs: next.tabs.map((candidate) => candidate.id === tab.id
      ? { ...candidate, matrices: [...candidate.matrices, { ...input, order: candidate.matrices.length }] }
      : candidate),
  };
}

export function renameTab(
  draft: DynamicWorkspaceDraft,
  expectedVersion: number,
  tabId: DynamicTabId,
  label: string,
): DynamicWorkspaceDraft {
  requireVersion(draft, expectedVersion);
  const tab = requireTab(draft, tabId);
  const nextLabel = label.trim();
  if (!nextLabel) throw new DynamicWorkspaceRuleError("탭 이름을 입력해야 합니다.");
  if (draft.tabs.some((candidate) => candidate.id !== tab.id && normaliseLabel(candidate.label) === normaliseLabel(nextLabel))) {
    throw new DynamicWorkspaceRuleError("같은 Workspace 안에 같은 탭 이름을 사용할 수 없습니다.");
  }
  const next = nextVersion(draft, { type: "tab_renamed", targetId: tabId });
  return { ...next, tabs: next.tabs.map((candidate) => candidate.id === tabId ? { ...candidate, label: nextLabel } : candidate) };
}

export function reorderTabs(
  draft: DynamicWorkspaceDraft,
  expectedVersion: number,
  orderedTabIds: readonly DynamicTabId[],
): DynamicWorkspaceDraft {
  requireVersion(draft, expectedVersion);
  if (orderedTabIds.length !== draft.tabs.length || new Set(orderedTabIds).size !== draft.tabs.length) {
    throw new DynamicWorkspaceRuleError("탭 순서에는 현재 탭을 한 번씩만 포함해야 합니다.");
  }
  const byId = new Map(draft.tabs.map((tab) => [tab.id, tab]));
  const ordered = orderedTabIds.map((id) => byId.get(id));
  if (ordered.some((tab) => !tab)) throw new DynamicWorkspaceRuleError("다른 Workspace의 탭을 이동할 수 없습니다.");
  const next = nextVersion(draft, { type: "tab_reordered", targetId: draft.workspaceId });
  return { ...next, tabs: reindex(ordered as DynamicTab[]) };
}

export function removeMatrix(
  draft: DynamicWorkspaceDraft,
  expectedVersion: number,
  tabId: DynamicTabId,
  matrixId: DynamicMatrixId,
): DynamicWorkspaceDraft {
  requireVersion(draft, expectedVersion);
  const tab = requireTab(draft, tabId);
  if (!tab.matrices.some((matrix) => matrix.id === matrixId)) throw new DynamicWorkspaceRuleError("이 탭에 Matrix가 없습니다.");
  const next = nextVersion(draft, { type: "matrix_removed", targetId: matrixId });
  return {
    ...next,
    tabs: next.tabs.map((candidate) => candidate.id === tabId
      ? { ...candidate, matrices: reindex(candidate.matrices.filter((matrix) => matrix.id !== matrixId)) }
      : candidate),
  };
}

/**
 * 게시 경계는 owner 권한을 이미 서버에서 확인한 호출자만 통과한다.
 * 복사본을 반환하므로 저장 실패 시 호출자는 기존 publication을 그대로 유지할 수 있다.
 */
export function publishDraft(
  draft: DynamicWorkspaceDraft,
  actor: { userId: string; isOwner: boolean },
): DynamicWorkspacePublication {
  if (!actor.isOwner) throw new DynamicWorkspaceRuleError("Workspace Owner만 게시할 수 있습니다.");
  if (!actor.userId) throw new DynamicWorkspaceRuleError("게시 주체가 필요합니다.");
  if (draft.tabs.length === 0) throw new DynamicWorkspaceRuleError("게시할 탭이 없습니다.");
  return {
    orgId: draft.orgId,
    workspaceId: draft.workspaceId,
    revision: draft.version,
    publishedBy: actor.userId,
    draft: structuredClone(draft),
  };
}

/**
 * rollback은 과거 publication의 동일 tenant snapshot만 새 draft로 복원한다.
 * 교차 tenant publication은 오류이며 호출자의 현재 draft는 변경되지 않는다.
 */
export function rollbackToPublication(
  current: DynamicWorkspaceDraft,
  expectedVersion: number,
  publication: DynamicWorkspacePublication,
): DynamicWorkspaceDraft {
  requireVersion(current, expectedVersion);
  if (publication.orgId !== current.orgId || publication.workspaceId !== current.workspaceId) {
    throw new DynamicWorkspaceRuleError("다른 Workspace의 게시본으로 되돌릴 수 없습니다.");
  }
  return {
    ...structuredClone(publication.draft),
    version: current.version + 1,
    audit: [...current.audit, { type: "tab_reordered", targetId: publication.workspaceId, version: current.version + 1 }],
  };
}
