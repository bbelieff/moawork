/**
 * document-ocr/taxation — 과세 유형 OCR 제안 → 사업자유형 저장값 변환.
 *
 * 정본 분류(`@/lib/new-lead/business-types`)가 소유한 규칙을 그대로 쓴다:
 * - base는 "개인사업자"·"법인사업자" 둘 중 하나여야 한다 (개인/법인 형태).
 * - 과세 하위구분은 접미사로만 붙는다 ("개인사업자(간이)" 등).
 * - "일반과세자"는 개인/법인의 형태가 아니라 세금 범주라서, 전체
 *   사업자유형 문자열을 "일반과세자"로 대체해서는 안 된다.
 *
 * base가 모호하거나(둘 다 없음·둘 다 있음·"그외" 등) 기존값이 이미 다른
 * 하위구분을 달고 있으면 자동 제안을 하지 않는다 (supported=false + 사유).
 * 호출자는 이 경우 체크를 풀고 "지원 안함"을 명시해야 한다.
 */

import {
  NEW_LEAD_CORPORATE_BUSINESS_SUBTYPES,
  NEW_LEAD_PERSONAL_BUSINESS_SUBTYPES,
  resolveNewLeadBusinessSubtype,
} from "@/lib/new-lead/business-types";
import { TAXATION_LABEL, type TaxationValue } from "./types";

const TAXATION_TO_SUBTYPE: Record<TaxationValue, string> = {
  general: "일반",
  simplified: "간이",
  exempt: "면세",
};

export type TaxationSuggestion =
  | { supported: true; value: string }
  | { supported: false; reason: string };

function baseOf(current: string): "개인사업자" | "법인사업자" | null {
  const hasPersonal = current.includes("개인사업자");
  const hasCorporate = current.includes("법인사업자");
  if (hasPersonal === hasCorporate) return null;
  return hasPersonal ? "개인사업자" : "법인사업자";
}

function currentSuffix(current: string, base: string): string | null {
  const rest = current.slice(current.indexOf(base) + base.length).trim();
  if (!rest) return null;
  const m = rest.match(/^\((.+)\)$/);
  return m ? m[1].trim() : null;
}

/**
 * OCR 과세 라벨(예: "일반과세자") + 현재 사업자유형(예: "법인사업자") →
 * 저장용 전체 문자열(예: "법인사업자"). base가 확실할 때만 제안한다.
 */
export function suggestBizRegTypeValue(
  currentBizRegType: string,
  taxationLabel: string,
): TaxationSuggestion {
  const label = taxationLabel.trim();
  if (!label) return { supported: false, reason: "과세 유형을 읽지 못했습니다." };
  const entry = (Object.entries(TAXATION_LABEL) as [TaxationValue, string][]).find(
    ([, text]) => text === label,
  );
  if (!entry) {
    return { supported: false, reason: `알 수 없는 과세 표기(${label})는 사업자유형으로 바꾸지 않습니다.` };
  }
  const [taxationKey] = entry;
  const subtype = TAXATION_TO_SUBTYPE[taxationKey];
  const current = currentBizRegType.trim();
  const base = baseOf(current);
  if (!base) {
    return {
      supported: false,
      reason:
        "현재 사업자유형이 개인/법인으로 확정되지 않아 과세 구분을 덧붙이지 않습니다. 사업자유형을 먼저 확정해 주세요.",
    };
  }
  const allowed =
    base === "개인사업자"
      ? (NEW_LEAD_PERSONAL_BUSINESS_SUBTYPES as readonly string[])
      : (NEW_LEAD_CORPORATE_BUSINESS_SUBTYPES as readonly string[]);
  if (!allowed.includes(subtype)) {
    return {
      supported: false,
      reason: `${base}에는 '${subtype}' 구분을 덧붙이지 않습니다. 직접 확인해 주세요.`,
    };
  }
  const suffix = currentSuffix(current, base);
  if (suffix !== null && suffix !== subtype && !(base === "법인사업자" && suffix === "유한")) {
    // "(유한)"은 형태 표기라 세금 구분과 같은 선상이 아니다 — 아래에서 별도 처리.
    return {
      supported: false,
      reason: `기존 하위구분(${base}(${suffix}))과 OCR 과세(${label})가 다릅니다. 직접 확인해 주세요.`,
    };
  }
  if (suffix === "유한") {
    // 정본 주석: "법인사업자(유한)"은 형태 표기이며 과세 미확정 — 임의 환원 금지.
    return {
      supported: false,
      reason:
        "법인사업자(유한)는 법인 형태 표기라 과세 미확정으로 읽습니다. 일반/면세로 임의 환원하지 않습니다.",
    };
  }
  const value = resolveNewLeadBusinessSubtype(base, subtype, "");
  if (!value) {
    return { supported: false, reason: "사업자유형 제안값을 만들지 못했습니다." };
  }
  return { supported: true, value };
}
