"use client";

import { useState } from "react";
import { BoardWorkspace } from "@/components/board/BoardWorkspace";
import { ConsultationPanel } from "@/components/consultation/ConsultationPanel";
import type { Board, BoardGroup, ItemWithValues } from "@/lib/boards/types";
import type { ConsultationBoardMap, ConsultationView } from "@/lib/consultation/boardView";
import { blankChecklist, CHECKLIST_STEPS, unconfirmStep } from "@/lib/consultation/checklist";
import { REMOTE_PHASES, INPERSON_PHASES, CONSULTATION_PHASE_LABEL, phaseNeedsSchedule } from "@/lib/consultation/phases";
import { VisualAppearanceProbe } from "./VisualAppearanceProbe";

// Synthetic layout/interaction QA only (1440×900 and 375×812).
// Real BoardWorkspace/ConsultationPanel and real server authorization remain intact.
// These deliberately non-UUID IDs cannot identify stored records. No mutation or
// authenticated read is mocked as successful. Panel success-state QA needs an
// authorized fixture through the real server; this page covers its error/retry UI.
const ORG = "visual-consultation-org";
const BOARD = "visual-consultation-board";
const GROUP = "visual-consultation-group";
const USER = "visual-consultation-member";
const AT = "2026-09-26T09:00:00.000Z";
const members = [{ id: USER, label: "가상 상담 담당자" }];
const board: Board = {
  id: BOARD, org_id: ORG, name: "상담 단계 QA", description: null, icon: null,
  source: "core.default-tab/contact", is_system: false, sort_order: 0,
  created_by: USER, created_at: AT, updated_at: AT, row_order_version: 0,
};
const groups: BoardGroup[] = [{
  id: GROUP, org_id: ORG, board_id: BOARD, name: "가상 상담 담당", color: null, sort_order: 0,
}];

function checked(count: number) {
  const checklist = blankChecklist();
  for (const step of CHECKLIST_STEPS.slice(0, count)) {
    checklist[step] = { confirmed: true, actorId: USER, at: AT };
  }
  return checklist;
}

const rows: ItemWithValues[] = [];
const consultationByItem: Record<string, ConsultationBoardMap[string]> = {};
for (const mode of ["remote", "inperson"] as const) {
  for (let index = 0; index < 6; index += 1) {
    const itemId = `visual-consultation-${mode}-${index}`;
    const dealId = `visual-consultation-deal-${mode}-${index}`;
    const title = `${mode === "remote" ? "비대면" : "대면"} 가상 회사 ${index + 1} · ${
      index === 5 ? "앞 단계 취소 · 뒤 확인 무효" : index === 4 ? "4단계 완료" : `${index}/4 확인`
    }`;
    rows.push({
      id: itemId, org_id: ORG, board_id: BOARD, group_id: GROUP, title,
      assigned_to: USER, deal_id: dealId, sort_order: rows.length,
      created_at: AT, updated_at: AT, values: {},
    });
    consultationByItem[itemId] = {
      itemId, dealId, companyId: `visual-consultation-company-${mode}-${index}`,
      mode, phase: "contract", version: index + 1, meetingAt: "2026-10-01T01:00:00.000Z",
      checklist: index === 5
        ? unconfirmStep(checked(4), "signed_copy_sent", USER, AT).state
        : checked(index),
      ready: index === 4, missing: index === 4 ? [] : ["계약 수동 확인 필요"],
      sealApproved: index === 4, sealDetail: index === 4 ? "합성 직인 승인 상태" : "합성 직인 대기 상태",
      dealStageKind: "meeting",
    };
  }
}

// Actual phase groups, separate from the explicit contract 0–4 fixture above.
for (const mode of ["remote", "inperson"] as const) {
  for (const phase of (mode === "remote" ? REMOTE_PHASES : INPERSON_PHASES).filter((value) => value !== "contract")) {
    const itemId = `visual-phase-${mode}-${phase}`;
    const dealId = `visual-phase-deal-${mode}-${phase}`;
    rows.push({ id: itemId, org_id: ORG, board_id: BOARD, group_id: GROUP,
      title: `가상 회사 · ${CONSULTATION_PHASE_LABEL[phase]}`, assigned_to: USER, deal_id: dealId,
      sort_order: rows.length, created_at: AT, updated_at: AT, values: {} });
    consultationByItem[itemId] = { itemId, dealId, companyId: null, mode, phase, version: 1,
      meetingAt: phaseNeedsSchedule(phase) ? "2026-10-01T01:00:00.000Z" : null,
      checklist: blankChecklist(), ready: false, missing: [], sealApproved: false, sealDetail: "", dealStageKind: "meeting" };
  }
}

export function VisualConsultationProbe() {
  const [view, setView] = useState<ConsultationView>("remote");
  return (
    <main className="min-h-screen min-w-0 bg-mw-bg p-3 text-mw-fg sm:p-4" data-visual-consultation>
      <VisualAppearanceProbe accent={view === "inperson" ? "inperson" : "contact"} controls={false} />
      <header className="mb-4 space-y-2">
        <h1 className="text-lg font-semibold">상담 화면 QA</h1>
        <p className="text-xs leading-5 text-mw-sub">
          합성 데이터 · 계약 0–4단계와 앞 단계 취소 후 상태입니다. 보기 전환은 같은 행 목록을 필터링합니다.
          저장·발송·입금은 수행하지 않습니다.
        </p>
        <nav aria-label="합성 상담 단계 보기" className="flex flex-wrap gap-2">
          {([
            ["remote", "비대면 STEP2"], ["inperson", "대면 STEP3"], ["all", "전체 상담"],
          ] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)}
              className="min-h-10 rounded border border-mw-line bg-mw-card px-3 text-sm aria-pressed:bg-mw-bg aria-pressed:font-bold">
              {label}
            </button>
          ))}
        </nav>
      </header>
      <section className="min-w-0" aria-label="실제 상담 보드 합성 상태">
        <BoardWorkspace
          board={board} columns={[]} groups={groups} rows={rows}
          columnOrder={{}} cellFlash={null} assigneeLabels={{ [USER]: members[0].label }}
          consultationView={view} consultationByItem={consultationByItem}
        />
      </section>
      <section className="mt-6 w-full max-w-2xl" aria-label="실제 상담 패널 조회 오류 QA">
        <h2 className="text-sm font-semibold">실제 패널 · 인증 및 합성 행 조회 오류 확인</h2>
        <p className="mt-1 text-xs leading-5 text-mw-sub">
          아래 패널과 표의 ‘확인 열기’는 실제 서버 조회를 사용합니다. 합성 행의 조회 실패는 예상된 결과이며,
          체크 저장·취소 성공과 인계 검증을 뜻하지 않습니다.
        </p>
        <ConsultationPanel
          itemId="visual-consultation-panel-unavailable" title="합성 상담 · 조회 실패와 다시 읽기"
          initialMeetingAt="2026-10-01T01:00:00.000Z" currentAssigneeId={USER}
          members={members} initialCompanyName="가상 상담 회사"
        />
      </section>
    </main>
  );
}
