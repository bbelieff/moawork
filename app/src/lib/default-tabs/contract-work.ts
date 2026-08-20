/**
 * 제품 기본 탭 «계약업체 실무» — BBE-150.
 *
 * 목업 v6의 27개 컬럼·출처·표시 순서를 따르되, 목업이 생략한 구조는 BBE-144 판정대로
 * 먼데이 이관 매핑 사전의 전량(그룹 11·진행기관 18·진행상품 59·진행상항 14)을 보존한다.
 * 이 파일은 계산을 다시 구현하지 않는다. BBE-153이 저장하는 계산 key 5개를 읽기 전용
 * `calc` 컬럼으로 노출할 뿐이다.
 *
 * 2026-08-20 총괄 직접 지시로 컬럼 이름이 «구분 · 진행기관 · 상품명칭 · 세부명칭» 으로 재편됐다(28컬럼).
 * CLAUDE.md 「기준의 우선순위」 1번(총괄 직접 지시)이 2번(목업)보다 우선하므로 목업의
 * «자금명 · 진행 상품» 을 따르지 않는다. **key 는 얼어 있다** — 라벨만 바뀌었고 `fund_name`·
 * `product` 는 그대로다. key 를 바꾸면 `item_values.column_key` 로 붙어 있는 기존 셀 값이
 * 전부 고아가 되기 때문이다(003_boards_engine.sql:64-70 — FK 없이 문자열 key 로만 묶인다).
 *
 * 2026-08-20 총괄 직접 지시 3건 추가: (1) «담당자» 를 맨 앞으로, (2) «세부명칭» 을 «상품명칭»
 * 바로 뒤로, (3) 표시 라벨 «진행상항» → «진행상황». 여기서도 key 는 얼어 있다 — 순서와
 * 라벨만 바뀐다. 위 5번째 줄의 «진행상항 14» 는 먼데이 이관 매핑 **사전** 의 이름이라 그대로다:
 * 사전은 먼데이가 실제로 쓰는 철자를 기록하는 곳이고, 제품 라벨만 고친다
 * (work-management/template.ts:14 가 sourceAliases 로 세운 선례와 같은 규약).
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
  // 2026-08-20 총괄 직접 지시: «담당자» 가 맨 앞이다 — 표를 열었을 때 제일 먼저 보이는 것은
  // «누가 잡고 있는 건인가» 다. 순서만 옮겼을 뿐 key(`owner`)·타입·폭은 그대로다.
  { key: "owner", label: "담당자", type: "person", source: "act", width: 120 },
  // 2026-08-20 총괄 직접 지시: 모든 계약이 «자금» 인 것이 아니다(인증·지원금·기타용역이 섞인다).
  // 최상위 분류인 «구분» 을 맨 앞에 새로 둔다. 새 key 라서 기존 값이 딸려 오지 않는다.
  { key: "engagement_kind", label: "구분", type: "select", source: "act", options: optionsFromLabels(["자금", "지원금", "인증", "기타용역"]), width: 120 },
  { key: "institution", label: "진행기관", type: "select", source: "act", options: mappedOptions("진행 기관"), width: 170 },
  // ⚠ key `fund_name` 은 라벨과 «일부러» 다르다. key 는 `item_values.column_key`(003:64-70,
  //   FK 없음)의 정체성이라 바꾸면 기존 셀 값이 전부 고아가 된다. 라벨만 «자금명»→«상품명칭».
  { key: "fund_name", label: "상품명칭", type: "select", source: "act", options: optionsFromLabels(MOCKUP_FUND_NAMES), width: 170 },
  // ⚠ key `product` 도 라벨과 «일부러» 다르다(위 fund_name 과 같은 이유). 라벨만 «진행 상품»→«세부명칭».
  //   선택지는 손대지 않는다 — 이관 매핑 사전(`진행 상품`) 전량 59종 그대로다.
  //   2026-08-20 총괄 직접 지시로 «상품명칭» 바로 뒤로 옮겼다 — 큰 이름과 세부 이름은 붙어 있어야 읽힌다.
  { key: "product", label: "세부명칭", type: "select", source: "act", options: mappedOptions("진행 상품"), width: 180 },
  { key: "business_type", label: "사업자유형", type: "select", source: "lk", readOnly: true, options: POLICYFUND_OPTION_SETS.biz_reg_type.map((option) => ({ ...option })), width: 120 },
  { key: "founded_year", label: "창업년도", type: "number", source: "lk", readOnly: true, width: 100 },
  { key: "annual_revenue", label: "연 매출액", type: "text", source: "lk", readOnly: true, width: 120 },
  { key: "representative", label: "대표자명", type: "text", source: "lk", readOnly: true, width: 110 },
  { key: "phone", label: "전화번호", type: "phone", source: "lk", readOnly: true, width: 130 },
  { key: "industry", label: "업종/업태", type: "status", source: "lk", readOnly: true, options: mappedOptions("업종/업태"), width: 140 },
  { key: "sido", label: "시도", type: "select", source: "lk", readOnly: true, options: optionsFromLabels(["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"]), width: 100 },
  { key: "sigungu", label: "시군구", type: "select", source: "lk", readOnly: true, options: optionsFromLabels(["미정"]), width: 110 },
  {
    key: "progress_status",
    // 2026-08-20 총괄 직접 지시: 표시 라벨의 오탈자 «진행상항» → «진행상황».
    label: "진행상황",
    type: "status",
    source: "act",
    // ⚠ 인자 "진행상항" 은 라벨이 아니라 **먼데이 이관 매핑 사전의 조회 키**다(policyfund-work.ts:112,
    //   먼데이 원본 컬럼 id `color`). 사전은 «바깥 시스템이 실제로 뭐라고 적어 뒀는가» 의 기록이므로
    //   고치면 그 기록이 거짓말이 되고, mappedColumn 이 모듈 로드 시점에 throw 한다.
    //   위 fund_name·product 와 같은 «라벨≠출처» 를 일부러 남기는 것이다.
    //   work-management/template.ts:14 의 sourceAliases:["진행상항"] 과 같은 규약.
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
