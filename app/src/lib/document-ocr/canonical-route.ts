/**
 * document-ocr/canonical-route — OCR 필드 저장 경로의 순수 판정.
 *
 * 배경: linked 신규리드 보드의 대표자/주소/업종/사업자유형은 canonical
 * deal/item/audit 경로(`update_new_lead_fields` 등 정본 RPC)가 소유한다.
 * 일반 `setCells`/`setValues`로 우회 저장하면 정본 보호에 막히거나
 * 감사 추적을 잃는다. 이 판정은 UI 플래그가 아니라 서버가 재확인한
 * 실제 board source + item/deal 일치 + 컬럼/배치 존재를 기준으로 분기한다.
 *
 * - 정본 보드 + deal 일치 + 정본 키 → canonical-update / canonical-meta.
 * - 그 외 배치에 있는 키 → generic (기존 세부필드 저장 API 위임).
 * - 배치에 없는 키·OCR 저장 대상이 아닌 키 → reject (명시 거부, 무음 저장 금지).
 *
 * 정본 키 의미는 `@/lib/new-lead/detail-field-patch` 단일 정의를 쓴다
 * (new-lead-actions의 DETAIL_FIELD_PATCH와 동일 객체 — 복제 아님).
 */

import { NEW_LEAD_TAB_SOURCE } from "@/lib/default-tabs/types";
import { NEW_LEAD_DETAIL_FIELD_PATCH } from "@/lib/new-lead/detail-field-patch";
import type { NewLeadFieldPatch, OcrPrecompanyPatch } from "@/lib/new-lead/canonical-contract";
import type { OcrFieldKey } from "./types";

/**
 * OCR이 저장 명령으로 보낼 수 있는 대상 키. 보드 셀 5종 + 보드 셀이 아닌
 * 정본 대상 4종(title·birthdate·business_item·biz_no)이다. 나머지는
 * 모달에서 선택 불가다.
 */
export const OCR_SAVABLE_BOARD_KEYS = [
  "rep_name",
  "address_detail",
  "industry",
  "biz_reg_type",
  "founded_month",
  "title",
  "birthdate",
  "business_item",
  "biz_no",
] as const;

export type OcrSavableBoardKey = (typeof OCR_SAVABLE_BOARD_KEYS)[number];

export type OcrRouteInput = {
  /** 서버가 재조회한 실제 보드 source. */
  boardSource: string;
  /** 어느 OCR 필드에서 왔는지 (값 검증·동작 분기용, 클라이언트 주장 아님). */
  ocrKey: OcrFieldKey;
  /** 저장하려는 보드 컬럼/상세 키 (셀 없는 정본 대상은 논리 키). */
  fieldKey: string;
  /** 서버가 행에서 재확인한 deal id (불일치면 호출 전에 거부되므로 여기선 일치 가정). */
  dealId: string | null;
  /** 서버가 deals에서 재확인한 연계 회사 유무 (biz_no 분기용). */
  linkedCompany: boolean;
  /** 현재 보드의 실제 컬럼 키. */
  columnKeys: readonly string[];
  /** 현재 상세 배치의 실제 detail 키. */
  detailKeys: readonly string[];
};

export type OcrRoute =
  | { route: "canonical-update"; patchKey: keyof NewLeadFieldPatch }
  | { route: "canonical-meta" }
  | { route: "canonical-title" }
  | { route: "ocr-meta"; metaKey: keyof OcrPrecompanyPatch }
  | { route: "company-bizno" }
  | { route: "generic" }
  | { route: "reject"; reason: string };

const CANONICAL_UPDATE_KEYS = new Set<string>([
  "rep_name",
  "industry",
  "biz_reg_type",
]);

/** 보드 셀이 없는 정본 대상 (title·intake meta·연계 회사). */
const NON_CELL_TARGETS: Record<string, OcrFieldKey> = {
  title: "companyName",
  birthdate: "birthdate",
  business_item: "businessItem",
  biz_no: "bizNo",
};

export function routeOcrBoardField(input: OcrRouteInput): OcrRoute {
  const { boardSource, ocrKey, fieldKey, dealId, linkedCompany, columnKeys, detailKeys } = input;
  if (!(OCR_SAVABLE_BOARD_KEYS as readonly string[]).includes(fieldKey)) {
    return {
      route: "reject",
      reason: `이 필드(${fieldKey})는 OCR 저장 대상이 아닙니다. 자동 생성·짜 저장을 하지 않으므로 직접 입력해 주세요.`,
    };
  }
  const nonCellKey = NON_CELL_TARGETS[fieldKey];
  if (nonCellKey) {
    // 셀 없는 정본 대상: 클라이언트 source 주장과 무관하게 OCR 키 일치를
    // 요구하고 정본 deal이 있어야 한다. 값 검증은 호출자(서버 액션)가 한다.
    if (ocrKey !== nonCellKey) {
      return {
        route: "reject",
        reason: `요청한 저장 위치와 실제 배치가 일치하지 않습니다(${fieldKey}). 새로고침 후 다시 시도하세요. 저장하지 않았습니다.`,
      };
    }
    if (!dealId) {
      return {
        route: "reject",
        reason: "연결된 신규리드가 없어 정본에 저장하지 않았습니다. 새로고침 후 다시 시도하세요.",
      };
    }
    if (fieldKey === "title") return { route: "canonical-title" };
    if (fieldKey === "birthdate") return { route: "ocr-meta", metaKey: "birthdate" };
    if (fieldKey === "business_item") return { route: "ocr-meta", metaKey: "business_item" };
    // biz_no: 연계 회사가 있으면 그 원본에, 없으면 intake 보관분으로
    // (회사 생성·재연계 없음 — 나중 명시적 handoff가 전달한다).
    return linkedCompany ? { route: "company-bizno" } : { route: "ocr-meta", metaKey: "biz_no" };
  }
  if (!columnKeys.includes(fieldKey) && !detailKeys.includes(fieldKey)) {
    return {
      route: "reject",
      reason: `현재 보드 배치에 없는 필드입니다(${fieldKey}). 배치가 바뀌었을 수 있으니 새로고침 후 다시 시도하세요. 저장하지 않았습니다.`,
    };
  }
  if (boardSource === NEW_LEAD_TAB_SOURCE && dealId) {
    if (fieldKey === "address_detail") return { route: "canonical-meta" };
    if (CANONICAL_UPDATE_KEYS.has(fieldKey)) {
      const patchKey = NEW_LEAD_DETAIL_FIELD_PATCH[
        fieldKey as keyof typeof NEW_LEAD_DETAIL_FIELD_PATCH
      ] as keyof NewLeadFieldPatch;
      return { route: "canonical-update", patchKey };
    }
  }
  // founded_month(정본 보드 포함)는 기존 단일 액션과 같은 setCells 경로로 간다.
  return { route: "generic" };
}
