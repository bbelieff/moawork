/** BBE-151 — product default notice-management tab from mockup v6. */

import type { FieldOption } from "@/lib/types";
import { STATUS_EMPTY_COLOR, STATUS_PALETTE } from "@/lib/boards/status-palette";
import { NOTICE_TAB_SOURCE, type DefaultTab } from "./types";

const statusOptions: FieldOption[] = [
  { id: "작업 중", label: "작업 중", order: 0, color: STATUS_EMPTY_COLOR },
  { id: "공지완료", label: "공지완료", order: 1, color: STATUS_PALETTE[5] },
];

export const NOTICE_GROUPS = {
  monthlyRenewal: "📂 매 월 공문리뉴얼",
  directLoanWaiting: "소상공인 직대 접수 대기 업체",
  specialGuarantee: "특례보증",
  supportProgram: "지원사업",
  completed: "공지 완료",
} as const;

export const NOTICE_TAB: DefaultTab = {
  key: "notice",
  source: NOTICE_TAB_SOURCE,
  name: "공지사항",
  icon: "📢",
  description: "공문과 지원사업 공지를 그룹별로 관리합니다.",
  groups: [
    { name: NOTICE_GROUPS.monthlyRenewal, color: STATUS_PALETTE[3] },
    { name: NOTICE_GROUPS.directLoanWaiting, color: STATUS_PALETTE[4] },
    { name: NOTICE_GROUPS.specialGuarantee, color: STATUS_PALETTE[6] },
    { name: NOTICE_GROUPS.supportProgram, color: STATUS_PALETTE[1] },
    { name: NOTICE_GROUPS.completed, color: STATUS_PALETTE[5] },
  ],
  columns: [
    { key: "audience", label: "대상", type: "people", source: "act", width: 140 },
    { key: "read_count", label: "읽음", type: "calc", source: "calc", readOnly: true, width: 90 },
    { key: "author", label: "작성자", type: "person", source: "auto", readOnly: true, width: 110 },
    {
      key: "official_pdf",
      label: "공문PDF",
      type: "file",
      source: "in",
      readOnly: true,
      width: 130,
      pendingReason: "서명 URL·만료·조직 경계가 적용된 파일 선택기로 연결됩니다.",
    },
    { key: "summary", label: "내용 정리", type: "longtext", source: "in", width: 220 },
    { key: "low_score_companies", label: "점수 미달인 업체", type: "select", source: "in", width: 150 },
    { key: "tax_delinquent_companies", label: "세금 미납인 업체", type: "select", source: "in", width: 150 },
    { key: "not_selected_companies", label: "미선정 업체", type: "select", source: "in", width: 140 },
    {
      key: "status",
      label: "상태",
      type: "status",
      source: "act",
      options: statusOptions,
      moveTo: { 공지완료: NOTICE_GROUPS.completed },
      rightPinned: true,
      width: 110,
    },
    { key: "created_on", label: "작성일", type: "date", source: "auto", readOnly: true, width: 120 },
  ],
  transitions: [],
};
