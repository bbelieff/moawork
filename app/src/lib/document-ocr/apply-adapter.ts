/**
 * document-ocr/apply-adapter — 부모(ItemDetailPanel 측) 연동 계약.
 *
 * 이 파일은 ItemDetailPanel·intake·upload 코드를 import하지 않는다.
 * 부모가 아래契約대로 saveField를 넘기면, 모달의 onApply로 바로 쓸 수 있는
 * 핸들러를 돌려준다. 실제 저장은 부모의 권한 확인된
 * saveItemDetailFieldAction / setCells·detail 파이프라인이 수행한다.
 *
 * 보호 규칙 (무음 덮어쓰기 금지):
 * - 체크되지 않은 필드는 절대 보내지 않는다.
 * - 제안이 blank("")인데 기존값이 있으면 제외한다 (skippedBlank로 보고).
 * - 형식이 깨진 제안(valid === false)을 그대로 보내지 않는다.
 *   사용자가 직접 고친 값(edited)은 보낸다.
 * - 제안이 기존값과 동일하면 기본 미선택으로 둔다 (no-op 쓰기 방지).
 */

import type {
  OcrApplyHandler,
  OcrApplyRequest,
  OcrApplyResult,
  OcrFieldKey,
  OcrProposedField,
} from "./types";

export type OcrFieldState = {
  field: OcrProposedField;
  /** 현재(보드에 저장된) 값. 모달에 표시되고 비교 기준이 된다. */
  current: string;
  /** 사용자가 고친 제안값. */
  edited: string;
  /** 사용자 체크 상태. */
  checked: boolean;
  /** true면 선택 불가 — 체크박스가 잠기고 사유가 표시된다 (미지원 키 등). */
  disabled?: boolean;
  /** 선택 불가 사유. */
  disabledReason?: string;
  /**
   * true면 반영 체크와 별도로 명시 확정이 필요하다 (사업자등록번호 —
   * 체크섬 통과 + 사용자 확정 확인이 함께 있어야 저장된다).
   */
  needsConfirm?: boolean;
  /** 명시 확정 여부. 값을 고치면(edit) false로 돌아간다. */
  confirmed?: boolean;
};

/** 문서 세션·편집 의도별 멱등 키. 같은 의도의 재시도는 바꾸지 않는다. */
export function newOcrRequestId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    // 아래 fallback으로 계속한다.
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * 필드별 안정 멱등 키.
 *
 * SQL `new_lead_requests`는 PK(org_id, request_id)에 payload/operation을
 * 묶는다(087·110·120 — 같은 ID에 다른 payload면 22023, 재시도는 replay).
 * 세션 base ID를 N개 필드에 그대로 돌리면 첫 필드가 영수증을 차지하고
 * 두 번째부터 전부 22023이며, 그 상태의 재시도는 영원히 실패한다.
 * 그래서 base ID + OCR 키 + 저장 대상 키 + 값에서 결정적 UUID를 만든다:
 * - 같은 의도(같은 값) 재시도 → 같은 ID → 서버 replay 또는 신규 성공.
 * - 값을 고치면(새 의도) → 다른 ID → 새 영수증.
 * - 필드·대상이 다르면 → 다른 ID → 영수증 충돌 없음.
 * - 정본 필드/update·title/meta/회사 동작이 달라도 OCR 키·대상 키가
 *   다르므로 ID가 겹치지 않는다.
 *
 * 동기 해시(cyrb53 ×2 → 128bit)라 브라우저·Node 모두 추가 의존 없이
 * 동작한다. 버전·variant 비트를 고정해 SQL uuid 컬럼에 그대로 들어간다.
 */
export function deriveOcrFieldRequestId(
  baseRequestId: string,
  fieldKey: string,
  targetKey: string,
  value: string,
): string {
  const h1 = cyrb53(`${baseRequestId}\n${fieldKey}\n${targetKey}\n${value}`, 0x9e3779b9);
  const h2 = cyrb53(`${value}\n${targetKey}\n${fieldKey}\n${baseRequestId}`, 0x85ebca6b);
  const hex = (n: number) =>
    (n >>> 0).toString(16).padStart(8, "0") +
    (Math.floor(n / 0x100000000) >>> 0).toString(16).padStart(8, "0");
  // h1/h2는 각각 53bit이므로 상위 hex 2자리는 0으로 채워진다 — 그대로 쓴다.
  const raw = (hex(h1) + hex(h2)).replace(/[^0-9a-f]/g, "0");
  const p = (raw + "0".repeat(32)).slice(0, 32);
  // version 4 · variant 8 고정 (SQL uuid·서버 UUID 정규식 통과).
  return (
    `${p.slice(0, 8)}-${p.slice(8, 12)}-4${p.slice(13, 16)}-8${p.slice(17, 20)}-${p.slice(20, 32)}`
  );
}

function cyrb53(str: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export type OcrSelectionInput = {
  states: OcrFieldState[];
  /** OCR 키 → 보드 컬럼/상세 키. 매핑 없는 키는 적용 대상에서 빠진다. */
  fieldMap: Partial<Record<OcrFieldKey, string>>;
};

export type OcrPayload = {
  selections: {
    fieldKey: OcrFieldKey;
    boardKey: string;
    value: string;
    confirmed: boolean;
  }[];
  skippedBlank: OcrFieldKey[];
  blockedInvalid: OcrFieldKey[];
  unmapped: OcrFieldKey[];
  /** 체크는 됐으나 명시 확정이 없어 보내지 않은 키. */
  unconfirmed: OcrFieldKey[];
};

export function defaultChecked(field: OcrProposedField, current: string): boolean {
  if (!field.value) return false;
  if (field.valid === false) return false;
  if (field.value === current) return false;
  return true;
}

export function buildApplyPayload(input: OcrSelectionInput): OcrPayload {
  const selections: OcrPayload["selections"] = [];
  const skippedBlank: OcrFieldKey[] = [];
  const blockedInvalid: OcrFieldKey[] = [];
  const unmapped: OcrFieldKey[] = [];
  const unconfirmed: OcrFieldKey[] = [];
  for (const state of input.states) {
    if (!state.checked) continue;
    // 선택 불가(미지원) 행은 payload에 넣지 않는다 — 사유는 행에 표시된다.
    if (state.disabled) continue;
    const value = state.edited.trim();
    if (!value) {
      if (state.current.trim()) skippedBlank.push(state.field.key);
      continue;
    }
    if (state.field.valid === false && value === state.field.value) {
      blockedInvalid.push(state.field.key);
      continue;
    }
    const boardKey = input.fieldMap[state.field.key];
    if (!boardKey) {
      unmapped.push(state.field.key);
      continue;
    }
    // 명시 확정이 필요한 행(사업자등록번호)은 확정 확인 없이 보내지 않는다.
    if (state.needsConfirm && !state.confirmed) {
      unconfirmed.push(state.field.key);
      continue;
    }
    selections.push({
      fieldKey: state.field.key,
      boardKey,
      value,
      confirmed: state.confirmed === true,
    });
  }
  return { selections, skippedBlank, blockedInvalid, unmapped, unconfirmed };
}

/**
 * 부모 저장 함수. boardKey는 fieldMap이 준 보드 컬럼/상세 키다.
 * 한 필드씩 순차 호출하며, 실패해도 나머지는 계속한다(부분 적용).
 */
export type SaveOcrField = (
  boardKey: string,
  value: string,
  meta: { fieldKey: OcrFieldKey; requestId: string; confirmed: boolean },
) => Promise<void>;

export function createDetailApplyHandler(options: {
  saveField: SaveOcrField;
  fieldMap: Partial<Record<OcrFieldKey, string>>;
}): OcrApplyHandler {
  return async (request: OcrApplyRequest): Promise<OcrApplyResult> => {
    const fieldErrors: Partial<Record<OcrFieldKey, string>> = {};
    for (const selection of request.selections) {
      const boardKey = options.fieldMap[selection.fieldKey];
      if (!boardKey) {
        fieldErrors[selection.fieldKey] = "보드 필드 매핑이 없습니다.";
        continue;
      }
      try {
        // 세션 base ID를 그대로 돌리면 SQL 영수증 PK(org, request_id)가
        // 첫 필드에 묶여 나머지가 전부 22023이 된다. 필드별 안정 ID로
        // 분리한다 — 같은 값 재시도는 같은 ID(서버 replay), 편집은 새 ID.
        const requestId = deriveOcrFieldRequestId(
          request.requestId,
          selection.fieldKey,
          boardKey,
          selection.value,
        );
        await options.saveField(boardKey, selection.value, {
          fieldKey: selection.fieldKey,
          requestId,
          confirmed: selection.confirmed === true,
        });
      } catch (error) {
        fieldErrors[selection.fieldKey] =
          error instanceof Error ? error.message : "저장에 실패했습니다.";
      }
    }
    const failed = Object.keys(fieldErrors).length;
    return {
      ok: failed === 0,
      fieldErrors,
      message:
        failed === 0
          ? "선택한 필드를 모두 반영했습니다."
          : `${request.selections.length}개 중 ${failed}개 실패. 성공분은 유지되고 실패분은 다시 시도할 수 있습니다.`,
    };
  };
}

/**
 * 반영 결과를 다음 diff 상태로 접는다 (순수).
 *
 * - 성공한 필드: 선택을 풀고 current를 저장된 값으로 갱신한다.
 *   같은 값을 다시 저장하는 재저장을 막는다.
 * - 실패한 필드: 초안(edited)·선택을 그대로 둔다. 같은 requestId로
 *   실패분만 다시 시도할 수 있다.
 */
export function applyOcrResultToStates(
  states: OcrFieldState[],
  applied: Partial<Record<OcrFieldKey, string>>,
  fieldErrors: Partial<Record<OcrFieldKey, string>>,
): OcrFieldState[] {
  return states.map((state) => {
    const key = state.field.key;
    if (fieldErrors[key]) return state;
    const saved = applied[key];
    if (saved === undefined) return state;
    return { ...state, checked: false, current: saved };
  });
}

/**
 * 부모 통합 예시 (복붙용, 실행 코드 아님):
 *
 * ```tsx
 * import { saveOcrFieldAction } from "@/app/(app)/boards/ocr-actions";
 * const fieldMap = { representative: "rep_name", ... };
 * const handleApply = createDetailApplyHandler({
 *   fieldMap,
 *   saveField: (boardKey, value, { requestId }) =>
 *     saveOcrFieldAction({ boardId, itemId, dealId, fieldKey: boardKey, source: "column", value, requestId })
 *       .then((r) => { if (!r.ok) throw new Error(r.message); }),
 * });
 * <DocumentOcrModal current={...} fieldMap={fieldMap} onApply={handleApply} onClose={...} />
 * ```
 */
export const APPLY_CONTRACT_NOTE = "apply-adapter contract v1";
