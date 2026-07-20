/**
 * 기본 보드 템플릿 (T02). 보드 생성 시 프로비저닝되는 컬럼 정의.
 * 먼데이 컬럼 미러 — 입력 컬럼 + 수식 컬럼 4개.
 * (컬럼 옵션/커스터마이징 확장은 T05 core.custom)
 */

import type { ColumnType, FormulaKey } from "./types";
import { INPUT_KEYS } from "./formulas";
import { COMPLETED_DATE_KEY } from "./pipeline";

export interface ColumnTemplate {
  key: string;
  title: string;
  type: ColumnType;
  position: number;
  settings?: { formulaKey?: FormulaKey; labels?: string[] };
}

/**
 * 영업 파이프라인 기본 컬럼 세트.
 * 입력: 고객명·연락처·계약금액·수수료율·계약일. 수식: 수수료·총매출·D+180·D+365.
 */
export const DEFAULT_COLUMNS: ColumnTemplate[] = [
  { key: "customer", title: "고객명", type: "text", position: 0 },
  { key: "phone", title: "연락처", type: "text", position: 1 },
  { key: INPUT_KEYS.contractAmount, title: "계약금액", type: "number", position: 2 },
  { key: INPUT_KEYS.commissionRate, title: "수수료율(%)", type: "number", position: 3 },
  { key: INPUT_KEYS.contractDate, title: "계약일", type: "date", position: 4 },
  { key: "commission", title: "수수료", type: "formula", position: 5, settings: { formulaKey: "commission" } },
  { key: "total_revenue", title: "총매출", type: "formula", position: 6, settings: { formulaKey: "total_revenue" } },
  { key: "d_plus_180", title: "D+180", type: "formula", position: 7, settings: { formulaKey: "d_plus_180" } },
  { key: "d_plus_365", title: "D+365", type: "formula", position: 8, settings: { formulaKey: "d_plus_365" } },
  { key: COMPLETED_DATE_KEY, title: "완료일", type: "date", position: 9 },
];
