// T09 · 테스트 픽스처 — 002_seed 의 구조를 그대로 본뜬 합성 프리셋.
//
// 실 도메인 문자열 대신 카테고리별 기대 개수만큼 합성 옵션을 채운다.
// 목적: 로더(SOURCES 매핑)·보드 추출 코드의 배선을 검증(값이 아닌 구조/개수).
// 실제 값·개수(218/59/…)는 별도로 002_seed 전수 파싱으로 확인됨.

import type { PolicyfundPresets } from "./types";

/** n개의 합성 옵션 라벨. */
function fill(prefix: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
}

/**
 * 기대 개수대로 채운 완전 픽스처.
 * board_columns 의 보드/컬럼 라벨은 실제 시드와 동일하게 두어 SOURCES 매핑을 검증.
 */
export function fullPresets(): PolicyfundPresets {
  return {
    pipeline_stages: [
      { name: "신규고객", kind: "marketing" },
      { name: "컨텍관리", kind: "meeting" },
      { name: "계약", kind: "contract" },
      { name: "업무관리", kind: "work" },
      { name: "수납·정산", kind: "settle" },
      { name: "사후관리", kind: "post" },
    ],
    board_columns: {
      신규고객: [
        { label: "Name", type: "title" },
        { label: "신청일", type: "date" },
        { label: "상담 상황", type: "select", options: fill("상담", 16) },
        { label: "계약금", type: "number" },
      ],
      컨텍관리: [
        { label: "Name", type: "title" },
        { label: "지역", type: "select", options: { ref: "region" } },
        { label: "계약상황", type: "select", options: fill("계약", 11) },
      ],
      업무관리: [
        { label: "이름", type: "title" },
        { label: "지역", type: "select", options: { ref: "region" } },
        { label: "진행 기관", type: "select", options: fill("기관", 18) },
        { label: "진행 상품", type: "select", options: { ref: "product" } },
        { label: "진행상항", type: "select", options: fill("진행", 14) },
        { label: "실행액", type: "number" },
        { label: "수수료(%)", type: "number" },
        {
          label: "수수료(원)",
          type: "formula",
          formula: "{실행액}×{수수료%}",
        },
        { label: "계약금", type: "number" },
      ],
      공지사항: [
        { label: "Name", type: "title" },
        {
          label: "점수 미달인 업체",
          type: "select",
          options: { redacted: "실제 고객사명 제외" },
        },
      ],
      회계_연도차이: {
        "25년": [{ label: "품목", type: "select", options: fill("자금", 28) }],
      },
    },
    field_presets: {
      region: fill("지역", 218),
      product: fill("상품", 59),
      biz_type: fill("업종", 10),
      biz_reg_type: fill("사업자", 6),
    },
    formulas: {
      fee_amount: "round(실행액 * 수수료% / 100)",
      total_revenue: "계약금 + 수수료(원)",
      d180: "수수료입금일 + 180일",
      d365: "수수료입금일 + 365일",
    },
  };
}
