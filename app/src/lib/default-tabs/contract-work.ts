/**
 * 제품 기본 탭 «계약업체 실무» — BBE-150.
 *
 * 목업 v6의 27개 컬럼·출처·표시 순서를 따르되, 목업이 생략한 구조는 BBE-144 판정대로
 * 먼데이 이관 매핑 사전의 전량(그룹 11·진행기관 18·진행상품 59·진행상항 14)을 보존한다.
 * 이 파일은 계산을 다시 구현하지 않는다. BBE-153이 저장하는 계산 key 5개를 읽기 전용
 * `calc` 컬럼으로 노출할 뿐이다.
 */

import type { FieldOption } from "@/lib/types";
import { POLICYFUND_OPTION_SETS } from "@/lib/migration/monday-mapping/policyfund-pack";
import { POLICYFUND_WORK_BOARD } from "@/lib/migration/monday-mapping/policyfund-work";
import type { DefaultTab, DefaultTabColumn } from "./types";

export const CONTRACT_WORK_TAB_SOURCE = "core.default-tab/contract-work";

function optionsFromLabels(labels: readonly string[]): FieldOption[] {
  return labels.map((label, order) => ({ id: label, label, order }));
}

function mappedColumn(label: string) {
  const column = POLICYFUND_WORK_BOARD.columns.find((candidate) => candidate.label === label);
  if (!column) throw new Error(`계약업체 이관 매핑 컬럼을 찾을 수 없습니다: ${label}`);
  return column;
}

function mappedOptions(label: string): FieldOption[] {
  const column = mappedColumn(label);
  if (!column.options?.length) throw new Error(`계약업체 이관 매핑 선택지가 비었습니다: ${label}`);
  return column.options.map((option, order) => ({ ...option, order }));
}

const MOCKUP_FUND_NAMES = [
  "혁신성장자금",
  "신용취약소상공인자금",
  "일시적경영애로자금",
  "재도전특별자금",
  "청년고용연계자금",
  "스마트공장자금",
] as const;

function productGroupName(name: string): string {
  if (name === "대출불가") return "⛔ 대출불가";
  return name.replace(/^(\p{Extended_Pictographic}(?:\uFE0F)?)(?!\s)/u, "$1 ");
}

const workGroups = POLICYFUND_WORK_BOARD.sections.map((section) => ({
  name: productGroupName(section.groupName),
  color: section.color,
}));

const groupByPlainName = (plain: string): string => {
  const group = workGroups.find(({ name }) => name.replace(/^\P{L}+/u, "").trim() === plain);
  if (!group) throw new Error(`계약업체 이동 대상 그룹을 찾을 수 없습니다: ${plain}`);
  return group.name;
};

const columns: DefaultTabColumn[] = [
  { key: "institution", label: "진행기관", type: "select", source: "act", options: mappedOptions("진행 기관"), width: 170 },
  { key: "fund_name", label: "자금명", type: "select", source: "act", options: optionsFromLabels(MOCKUP_FUND_NAMES), width: 170 },
  { key: "owner", label: "담당자", type: "person", source: "act", width: 120 },
  { key: "business_type", label: "사업자유형", type: "select", source: "lk", readOnly: true, options: POLICYFUND_OPTION_SETS.biz_reg_type.map((option) => ({ ...option })), width: 120 },
  { key: "founded_year", label: "창업년도", type: "number", source: "lk", readOnly: true, width: 100 },
  { key: "annual_revenue", label: "연 매출액", type: "text", source: "lk", readOnly: true, width: 120 },
  { key: "representative", label: "대표자명", type: "text", source: "lk", readOnly: true, width: 110 },
  { key: "phone", label: "전화번호", type: "phone", source: "lk", readOnly: true, width: 130 },
  { key: "industry", label: "업종/업태", type: "status", source: "lk", readOnly: true, options: mappedOptions("업종/업태"), width: 140 },
  { key: "sido", label: "시도", type: "select", source: "lk", readOnly: true, options: optionsFromLabels(["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"]), width: 100 },
  { key: "sigungu", label: "시군구", type: "select", source: "lk", readOnly: true, options: optionsFromLabels(["미정"]), width: 110 },
  { key: "product", label: "진행 상품", type: "select", source: "act", options: mappedOptions("진행 상품"), width: 180 },
  {
    key: "progress_status",
    label: "진행상항",
    type: "status",
    source: "act",
    options: mappedOptions("진행상항"),
    rightPinned: true,
    moveTo: {
      "진행중": groupByPlainName("진행중"),
      "심사 중": groupByPlainName("심사 중"),
      "승인": groupByPlainName("승인"),
      "불가": groupByPlainName("대출불가"),
    },
    width: 150,
  },
  { key: "visit_application_date", label: "방문 및 신청 일", type: "date", source: "in", width: 130 },
  { key: "inspection_date", label: "실사일", type: "date", source: "in", width: 110 },
  { key: "expected_review_end", label: "예상 심사 종료", type: "date", source: "in", width: 130 },
  { key: "review_dday", label: "ƒ심사 D-day", type: "calc", source: "calc", readOnly: true, width: 120 },
  { key: "execution_amount", label: "실행액", type: "money", source: "in", width: 120 },
  { key: "fee_percent", label: "수수료(%)", type: "number", source: "in", width: 110 },
  { key: "fee_amount", label: "ƒ수수료(원)", type: "calc", source: "calc", readOnly: true, width: 130 },
  { key: "fee_paid_on", label: "수수료_입금일", type: "date", source: "in", width: 130 },
  { key: "total_revenue", label: "ƒ총 매출액", type: "calc", source: "calc", readOnly: true, width: 130 },
  { key: "funded_on", label: "조달일", type: "date", source: "in", width: 110 },
  { key: "reapply_notice_date", label: "ƒ재신청 안내일", type: "calc", source: "calc", readOnly: true, width: 140 },
  { key: "d180", label: "ƒD+180", type: "calc", source: "calc", readOnly: true, width: 110 },
  { key: "contract_deposit", label: "계약금", type: "money", source: "in", width: 120 },
  { key: "contract_deposit_paid_on", label: "계약금_입금일", type: "date", source: "in", width: 130 },
];

export const CONTRACT_WORK_TAB: DefaultTab = {
  key: "work",
  source: CONTRACT_WORK_TAB_SOURCE,
  name: "계약업체 실무",
  icon: "🔁",
  description: "계약 이후 기관·상품별 진행과 자동 계산 결과를 관리한다",
  groups: workGroups,
  columns,
  transitions: [],
};
