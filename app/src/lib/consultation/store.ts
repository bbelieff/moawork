/**
 * 상담 보호 상태 — 151 RPC 위의 읽기 전용 타입.
 *
 * 진실은 DB(`consultation_states` + `consultation_events` + `consultation_requests`)에 있다.
 * EAV(`consultation_ledger`/checkbox 거울)는 정본이 아니며 이 모듈은 EAV를 쓰지 않는다.
 * 쓰기는 `execute_consultation_transition` RPC로만 일어나고(원자 CAS + 자문잠금),
 * 읽기는 `read_consultation_snapshot` RPC 또는 RLS SELECT 로 한다.
 */

import type { ChecklistState } from "./checklist";
import type { ConsultationStage } from "./stages";

export type ConsultationMode = "remote" | "inperson";

/** 스냅샷 읽기 결과 — `read_consultation_snapshot` 행의 camelCase 투영. */
export interface ConsultationSnapshot {
  itemId: string;
  dealId: string | null;
  /** deal.company_id 실측 — 인계 전에는 null 일 수 있다. */
  companyId: string | null;
  boardSource: string | null;
  /** contact 보드: remote|inperson. new-lead 보드: new_lead(읽기만). */
  stage: ConsultationStage;
  version: number;
  meetingAt: string | null;
  phase?: import("./phases").ConsultationPhase;
  assigneeId?: string | null;
  history?: readonly import("./phases").ConsultationHistory[];
  checklist: ChecklistState;
  ready: boolean;
  /** 미완료 라벨 + 단계/직인 차단 사유. */
  missing: string[];
  seal: { approved: boolean; detail: string };
  dealStageKind: string | null;
}

/** 전이 쓰기 결과 — `execute_consultation_transition` 행의 투영. */
export interface ConsultationTransitionResult {
  itemId: string;
  dealId: string | null;
  companyId: string | null;
  mode: ConsultationMode;
  version: number;
  replayed: boolean;
}

/** 정식 직인 게이트: work_move AND 보드 거울(seal_status) AND 계약 정본(deals.custom 직인). 인계는 069 deal-branch 계약 정본을 따른다. */
export const WORK_MOVE_COLUMN_KEY = "work_move";
export const WORK_MOVE_VALUE = "업무관리 이동";
export const SEAL_STATUS_COLUMN_KEY = "seal_status";
export const SEAL_APPROVED_VALUE = "완료";
