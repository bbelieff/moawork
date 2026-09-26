import { isConsultationPhase, type ConsultationPhase } from "./phases";
/**
 * 상담 단계 보기 — 일괄 조회 매퍼 + 순수 보기 도우미.
 *
 * STEP2(비대면)·STEP3(대면) 탭은 같은 리드컨택 정본 보드의 단계 보기다.
 * 회사·딜·아이템을 복제하지 않고, 152 RPC `read_consultation_board_view` 로
 * 보드 한 번 조회에 끝낸 뒤 mode 로 걸러 보여준다(행마다 스냅샷 조회 = N+1 금지).
 *
 * 이 모듈은 서버·클라이언트 공용이다. 서버 전용 import 를 두지 않는다 —
 * 서버 로더는 `./boardViewServer` 에 따로 둔다.
 */

import type { ChecklistState, ChecklistStep } from "./checklist";
import { CHECKLIST_LABEL, CHECKLIST_STEPS } from "./checklist";
import type { ConsultationStage } from "./stages";

/** 단계 보기 식별자 — `all` 은 기존 리드컨택 전체 보기(호환 유지). */
export type ConsultationView = "all" | "remote" | "inperson";

/**
 * 상담 진행 가상 컬럼 키 — DB 컬럼이 아니다. 표에서만 계약 진행을 읽히는
 * 표시 전용 칸이며, 일괄 편집·검색 대상에서 제외한다(값 쓰기 없음).
 */
export const CONSULTATION_PROGRESS_KEY = "consultation_progress";

/** URL 단계 보기 파라미터 — 서버가 검증한다. 모르면 null(전체 보기). */
export function parseConsultationView(value: unknown): "remote" | "inperson" | null {
  return value === "remote" || value === "inperson" ? value : null;
}

/** 152 행의 camelCase 투영 — 단일 스냅샷(`store.ts`)과 같은 눈이다. */
export interface ConsultationBoardEntry {
  itemId: string;
  dealId: string | null;
  companyId: string | null;
  mode: "remote" | "inperson";
  version: number;
  meetingAt: string | null;
  phase?: ConsultationPhase;
  checklist: ChecklistState;
  ready: boolean;
  missing: string[];
  sealApproved: boolean;
  sealDetail: string;
  dealStageKind: string | null;
}

export type ConsultationBoardMap = Readonly<Record<string, ConsultationBoardEntry>>;

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function checklistFrom(value: unknown): ChecklistState {
  const base: ChecklistState = {
    contract_sent: { confirmed: false, actorId: null, at: null },
    signed_copy_sent: { confirmed: false, actorId: null, at: null },
    counterparty_signature_confirmed: { confirmed: false, actorId: null, at: null },
    deposit_confirmed: { confirmed: false, actorId: null, at: null },
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;
  const source = value as Record<string, { confirmed?: unknown; actor?: unknown; at?: unknown }>;
  for (const step of Object.keys(base) as (keyof ChecklistState)[]) {
    const entry = source[step];
    if (!entry || typeof entry !== "object") continue;
    base[step] = {
      confirmed: entry.confirmed === true,
      actorId: typeof entry.actor === "string" ? entry.actor : null,
      at: typeof entry.at === "string" ? entry.at : null,
    };
  }
  return base;
}

/** 152 RPC 한 행 → 화면 항목. 형식이 깨지면 던진다(조용히 빈 값으로 때우지 않는다). */
export function boardEntryFromRow(value: Record<string, unknown>): ConsultationBoardEntry {
  const mode = value.mode;
  if (mode !== "remote" && mode !== "inperson") {
    throw new Error("상담 단계 보기 형식이 올바르지 않습니다.");
  }
  const missing = Array.isArray(value.missing)
    ? value.missing.filter((entry): entry is string => typeof entry === "string")
    : [];
  return {
    itemId: String(value.item_id),
    dealId: typeof value.deal_id === "string" ? value.deal_id : null,
    companyId: typeof value.company_id === "string" ? value.company_id : null,
    mode,
    version: typeof value.version === "number" ? value.version : 0,
    meetingAt: text(value.meeting_at),
    phase: isConsultationPhase(value.phase) ? value.phase : undefined,
    checklist: checklistFrom(value.checklist),
    ready: value.ready === true,
    missing,
    sealApproved: value.seal_approved === true,
    sealDetail: text(value.seal_detail) ?? "",
    dealStageKind: text(value.deal_stage_kind),
  };
}

/** 152 RPC 클라이언트 — Supabase `rpc()` 와 같은 모양이면 된다. */
export type ConsultationBoardRpcClient = Readonly<{
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;
}>;

/** F7: 한 번에 묶어 보내는 ID 상한. PostgREST 암묵 절단을 피한다. */
export const CONSULTATION_BOARD_VIEW_CHUNK_SIZE = 200;
/** F7: 한 번에 읽는 행 상한(SQL 기본 200, 상한 500과 같은 눈). */
export const CONSULTATION_BOARD_VIEW_PAGE_LIMIT = 200;

/** 보드 일괄 조회 — 행마다 조회하지 않는다. F7 bounded IDs + 명시 pagination. */
export async function readConsultationBoardView(
  client: ConsultationBoardRpcClient,
  input: Readonly<{
    orgId: string;
    boardId: string;
    itemIds?: readonly string[];
    limit?: number;
    offset?: number;
  }>,
): Promise<ConsultationBoardMap> {
  const { data, error } = await client.rpc("read_consultation_board_view_v2", {
    p_org_id: input.orgId,
    p_board_id: input.boardId,
    ...(input.itemIds !== undefined ? { p_item_ids: [...input.itemIds] } : {}),
    ...(input.limit !== undefined ? { p_limit: input.limit } : {}),
    ...(input.offset !== undefined ? { p_offset: input.offset } : {}),
  });
  if (error) {
    const rpcError = new Error(error.message || "상담 단계 보기를 읽지 못했습니다.");
    (rpcError as { code?: string }).code = error.code ?? "";
    throw rpcError;
  }
  const rows = Array.isArray(data) ? data : [];
  const entries: Record<string, ConsultationBoardEntry> = {};
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const entry = boardEntryFromRow(row as Record<string, unknown>);
    entries[entry.itemId] = entry;
  }
  return entries;
}

/**
 * F7: bounded chunk 로 나눠 읽는다. 호출자가 정본 후보 ID(보드 행)를 넘기면
 * SQL 이 권한 안에서만 돌려주고, 권한 밖은 제외한다(fail-closed).
 */
export async function readConsultationBoardViewInChunks(
  client: ConsultationBoardRpcClient,
  input: Readonly<{
    orgId: string;
    boardId: string;
    itemIds: readonly string[];
    chunkSize?: number;
  }>,
): Promise<ConsultationBoardMap> {
  const chunk = Math.max(1, Math.min(input.chunkSize ?? CONSULTATION_BOARD_VIEW_CHUNK_SIZE, 500));
  const merged: Record<string, ConsultationBoardEntry> = {};
  for (let offset = 0; offset < input.itemIds.length; offset += chunk) {
    const slice = input.itemIds.slice(offset, offset + chunk);
    const entries = await readConsultationBoardView(client, {
      orgId: input.orgId,
      boardId: input.boardId,
      itemIds: slice,
      limit: CONSULTATION_BOARD_VIEW_PAGE_LIMIT,
      offset: 0,
    });
    Object.assign(merged, entries);
  }
  return merged;
}

/**
 * F5: 행의 상담 모드 — 맵에 있으면 그 값이 정본이다(기록 없는 contact 행의
 * remote·version 0 도 SQL 이 명시로 준 «의도된 기본값»). 맵에 없으면(미조회·권한밖·오류)
 * null 로 돌려주고 절대 remote 로 때우지 않는다. 기존 valid unspecialized remote 와
 * fetch omission(null)은 호출자가 구분한다.
 */
export function consultationModeForRow(
  itemId: string,
  map: ConsultationBoardMap,
): "remote" | "inperson" | null {
  return map[itemId]?.mode ?? null;
}

/** 단계 보기 필터 — 같은 정본 행을 mode 로 가른다. 복제 없음. 미조회(null)는 특정 보기에 넣지 않는다. */
export function filterRowIdsByConsultationView(
  itemIds: readonly string[],
  map: ConsultationBoardMap,
  view: ConsultationView,
): string[] {
  if (view === "all") return [...itemIds];
  return itemIds.filter((itemId) => consultationModeForRow(itemId, map) === view);
}

/** 다음에 확인할 단계 — 없으면(4완료) null. */
export function nextPendingStep(checklist: ChecklistState): ChecklistStep | null {
  return CHECKLIST_STEPS.find((step) => !checklist[step].confirmed) ?? null;
}

/** 표에 읽히는 진행 요약 — `2/4 · 다음: 상대 서명 확인`. */
export function consultationProgressSummary(checklist: ChecklistState): {
  done: number;
  total: number;
  nextLabel: string | null;
} {
  const done = CHECKLIST_STEPS.filter((step) => checklist[step].confirmed).length;
  const next = nextPendingStep(checklist);
  return { done, total: CHECKLIST_STEPS.length, nextLabel: next ? CHECKLIST_LABEL[next] : null };
}

/**
 * 계약 단계 그룹 키 — 첫 미완료 단계가 그 행의 자리다. 4완료는 `done`.
 * 비대면·대면 «각각» 의 보드가 이 키로 같은 정본 행을 묶는다(가상 묶음 — DB 변경 없음).
 */
export type ContractStepGroupKey = ChecklistStep | "done";

export function contractStepGroupKey(checklist: ChecklistState): ContractStepGroupKey {
  return nextPendingStep(checklist) ?? "done";
}

export const CONTRACT_STEP_GROUPS: ReadonlyArray<{
  key: ContractStepGroupKey;
  title: string;
  hint: string;
}> = [
  { key: "contract_sent", title: "계약 확인 1단계 · 계약서 송부", hint: "워크스페이스 회사 → 고객사 (수동 확인)" },
  { key: "signed_copy_sent", title: "계약 확인 2단계 · 서명본 발송", hint: "워크스페이스 회사 → 고객사 (수동 확인)" },
  {
    key: "counterparty_signature_confirmed",
    title: "계약 확인 3단계 · 상대 서명 확인",
    hint: "고객사 서명을 사람이 직접 확인",
  },
  {
    key: "deposit_confirmed",
    title: "계약 확인 4단계 · 착수금 입금 확인",
    hint: "입금을 사람이 직접 확인 (자동 조회 없음)",
  },
  { key: "done", title: "계약 확인 완료", hint: "4단계를 모두 확인 — 실무 인계 가능" },
];

/** 상담 단계 라벨 — Sidebar·보드 헤더가 같은 말을 쓴다. */
export function consultationViewLabel(view: ConsultationView): string {
  switch (view) {
    case "remote":
      return "비대면 상담";
    case "inperson":
      return "대면 상담";
    case "all":
      return "전체";
  }
}

/** Sidebar STEP 대응 — STEP1=신규리드(/newcust), STEP2=비대면, STEP3=대면. */
export function consultationStageOfView(view: "remote" | "inperson"): ConsultationStage {
  return view;
}
