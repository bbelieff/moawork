/**
 * 기본 탭 «리드컨택 관리» — BBE-149.
 *
 * 정본: `docs/design/UI목업_워크스페이스_최종_v6.html` tab `contact`.
 * 그룹 7 · 컬럼 21 · 담당자 기준 이동 4규칙 · 우측 고정 «업무이동».
 * 보드 간 이동 실행과 직인 이중 잠금은 BBE-152 소유이며 여기서는 계약만 선언한다.
 */

import type { FieldOption } from "@/lib/types";
import { STATUS_EMPTY_COLOR, STATUS_PALETTE } from "@/lib/boards/status-palette";
import { CANONICAL_REGIONS } from "@/lib/structure-packs/region-options";
import { CONTACT_TAB_SOURCE, type DefaultTab, type DefaultTabColumn } from "./types";
import { OTHER_INFO_COLUMN_KEY } from "@/lib/boards/structured-field";

const option = (label: string, order: number, color?: string): FieldOption => ({
  id: label,
  label,
  order,
  ...(color ? { color } : {}),
});

const options = (...labels: readonly string[]): FieldOption[] =>
  labels.map((label, order) => option(label, order));

const idleAnd = (...labels: readonly string[]): FieldOption[] => [
  option(labels[0], 0, STATUS_EMPTY_COLOR),
  ...labels.slice(1).map((label, index) => option(label, index + 1)),
];

const SIDO = [
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
  "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
] as const;

function sigunguOptions(): FieldOption[] {
  const labels = new Set<string>();
  for (const region of CANONICAL_REGIONS) {
    const name = region.split("_")[1];
    if (name) labels.add(name);
  }
  return [...labels].sort((a, b) => a.localeCompare(b, "ko"))
    .concat("기타")
    .map((label, order) => option(label, order));
}

export const CONTACT_GROUPS = {
  unassigned: "💰 컨텍",
  assignee1: "💰 담당자 1",
  assignee2: "💰 담당자 2",
  contractHold: "💰 계약보류(온/오프)",
  meetingHold: "📍 미팅보류",
  meetingCancelled: "📍 미팅취소",
  contractCancelled: "📍 계약취소",
} as const;

const COLUMNS: DefaultTabColumn[] = [
  { key: "ad_name", label: "광고 명", type: "text", source: "lk", width: 130 },
  {
    key: "owner",
    label: "담당자",
    type: "person",
    source: "act",
    width: 120,
    assigneeMove: {
      unassignedValue: "미배정",
      unassignedGroup: CONTACT_GROUPS.unassigned,
      assignments: [
        { assigneeSlot: 0, groupAssigneeSlot: 0 },
        { assigneeSlot: 1, groupAssigneeSlot: 1 },
        { assigneeSlot: 2, groupAssigneeSlot: 1 },
      ],
    },
  },
  { key: "applied_on", label: "신청일", type: "date", source: "lk", width: 120 },
  { key: "phone", label: "연락처", type: "phone", source: "lk", width: 130 },
  { key: "industry", label: "업종/업태", type: "status", source: "lk", width: 120 },
  {
    key: "biz_reg_type",
    label: "사업자유형",
    type: "select",
    source: "in",
    options: options("개인/면세", "개인/간이", "개인/일반", "개인/성실", "법인", "법인/성실"),
    width: 110,
  },
  { key: "founded_year", label: "창업년도", type: "number", source: "in", width: 100 },
  { key: "sido", label: "시도", type: "select", source: "in", options: options(...SIDO), width: 90 },
  { key: "sigungu", label: "시군구", type: "select", source: "in", options: sigunguOptions(), width: 110 },
  { key: "rep_name", label: "대표자명", type: "text", source: "lk", width: 110 },
  { key: "revenue", label: "매출액", type: "text", source: "lk", width: 110 },
  { key: OTHER_INFO_COLUMN_KEY, label: "기타정보", type: "other_info", source: "in", width: 170 },
  {
    key: "contract_status",
    label: "계약상황",
    type: "status",
    source: "act",
    options: idleAnd(
      "계약 전", "계약서 요청", "계약서 작성완료", "계약 보류", "계약고민", "연결안됨",
      "다시전화", "진행했다함", "미팅보류", "미팅취소", "계약취소",
    ),
    width: 130,
  },
  { key: "meeting_at", label: "전자계약 / 미팅일정", type: "datetime", source: "in", width: 165 },
  {
    key: "meeting_confirm_message",
    label: "미팅확정 메세지",
    type: "status",
    source: "msg",
    options: idleAnd("미팅 미지정", "보내기기"),
    width: 145,
  },
  { key: "meeting_done", label: "미팅", type: "checkbox", source: "in", width: 80 },
  { key: "recontact_on", label: "재접촉일", type: "date", source: "in", width: 120 },
  { key: "contract_fee", label: "계약금", type: "money", source: "in", width: 110 },
  {
    key: "contract_fee_status",
    label: "계약금 완료여부",
    type: "status",
    source: "act",
    options: idleAnd("계약금 미", "계약금 완"),
    width: 140,
  },
  {
    key: "seal_status",
    label: "직인 완료",
    type: "status",
    source: "act",
    options: idleAnd("대기", "완료"),
    width: 110,
  },
  {
    key: "work_move",
    label: "업무이동",
    type: "status",
    source: "act",
    options: idleAnd(
      "업무 진행 전", "업무관리 이동", "계약보류", "미팅보류", "미팅취소", "계약취소", "뒤로가기",
    ),
    rightPinned: true,
    width: 135,
  },
  { key: "email", label: "이메일", type: "email", source: "lk", width: 160 },
];

export const CONTACT_TAB: DefaultTab = {
  revision: 3,
  previousRevision: {
    revision: 2,
    // 기록이 없는 revision 1 보드의 linked-field 교정도 계속 감지한다.
    // revision 2 상태가 있으면 저장된 false baseline이 우선하므로 회사 수정값은 덮지 않는다.
    columns: Object.fromEntries([
      "ad_name", "applied_on", "phone", "industry", "rep_name", "revenue", "email",
    ].map((key) => [key, { readOnly: true }])),
  },
  key: "contact",
  source: CONTACT_TAB_SOURCE,
  name: "리드컨택 관리",
  icon: "💰",
  description: "리드를 담당자와 계약 상황에 따라 관리한다",
  groups: [
    { name: CONTACT_GROUPS.unassigned, color: STATUS_PALETTE[5] },
    { name: CONTACT_GROUPS.assignee1, color: STATUS_PALETTE[3], assigneeSlot: 0 },
    { name: CONTACT_GROUPS.assignee2, color: STATUS_PALETTE[4], assigneeSlot: 1 },
    { name: CONTACT_GROUPS.contractHold, color: STATUS_PALETTE[1] },
    { name: CONTACT_GROUPS.meetingHold, color: STATUS_PALETTE[6] },
    { name: CONTACT_GROUPS.meetingCancelled, color: STATUS_PALETTE[8] },
    { name: CONTACT_GROUPS.contractCancelled, color: STATUS_PALETTE[2] },
  ],
  columns: COLUMNS,
  // BBE-152가 소비할 계약만 선언한다. 이 카드에서는 보드 간 이동을 실행하지 않는다.
  transitions: [
    {
      columnKey: "work_move",
      value: "업무관리 이동",
      to: "work",
      guard: { columnKey: "seal_status", value: "완료" },
    },
  ],
};
