"use client";

/**
 * ItemDetailOcr — 증빙 영역의 사업자등록증 OCR 진입점.
 *
 * 흐름:
 * 1. 버튼을 누르면 typed 읽기(`loadOcrCurrentAction`)로 정본 비교 기준
 *    (행 제목·연계 회사 사업자번호/intake 보관분)을 먼저 가져온 뒤 모달을
 *    연다. 파일은 서버로 보내지 않는다.
 * 2. 사용자가 로컬 파일을 고르면 DocumentOcrModal이 브라우저 안에서만
 *    OCR/파싱한다 (외부 전송 없음, 보호 스토리지 업로드와 무관).
 * 3. 추출값/기존값 diff에서 사용자가 필드별 선택·수정 후 명시적으로 적용.
 * 4. 적용은 별도 OCR 서버 액션(saveOcrFieldAction)으로만 보낸다.
 *    서버가 실제 board source·item/deal·컬럼을 재확인해 정본 키는
 *    정본 RPC(updateCanonicalNewLead/Meta/Title·154 초안 intake meta·
 *    연계 회사 RPC)로, 일반 필드는 기존 세부필드 저장 API로 분기한다.
 *    requestId는 필드별 안정 멱등 키로 전달된다.
 *    확인 전에는 canonical 값을 절대 덮어쓰지 않으며, 미지원 키와
 *    읽기전용 칸은 선택 불가 + 사유 표시로 보내지 않는다 (무음 저장 금지).
 * 5. 전부 성공하면 router.refresh()로 서버 재조회해 반영을 확인한다.
 *
 * 저장 대상 9종:
 * - 대표자·소재지·업태·과세(조건부)·개업연월: 기존 보드 셀 경로.
 * - 상호: 행 title → update_new_lead_title(110) + 연계 회사명 정정(사용자 확정 +
 *   비교 기준 CAS가 있어야 틀린 원본을 고친다, 154 초안).
 * - 생년월일·종목·미연계 사업자번호: 154 초안 intake meta.
 * - 연계 사업자번호: 연계 회사 원본 (체크섬+명시 확정, 생성·재연계 없음).
 * - 법인 형태: 정본 키가 없는 참고 정보라 미지원으로 남는다.
 */

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  loadOcrCurrentAction,
  saveOcrFieldAction,
} from "@/app/(app)/boards/ocr-actions";
import { DocumentOcrModal } from "@/components/document-ocr/DocumentOcrModal";
import { createDetailApplyHandler } from "@/lib/document-ocr/apply-adapter";
import { suggestBizRegTypeValue } from "@/lib/document-ocr/taxation";
import { isSourceEditable, isFieldSource } from "@/lib/field/source";
import type {
  OcrApplyHandler,
  OcrFieldKey,
} from "@/lib/document-ocr/types";
import type { BoardColumn, CellValue, ItemWithValues } from "@/lib/boards/types";
import type { DetailLayoutEntry } from "@/lib/boards/detail-layout";

/**
 * OCR 키 → 저장 대상 키.
 * - taxation: 키 매핑은 유지하되 값은 `suggestBizRegTypeValue`가 변환한다.
 *   OCR "일반과세자"를 그대로 사업자유형에 덮어쓰지 않으며, 현재값의
 *   개인/법인 base가 확실할 때만 유효 하위구분(예: "법인사업자(면세)")을
 *   제안한다. 모호하면 선택 불가 + 지원 안함 사유를 표시한다.
 * - openedOn: OCR "YYYY-MM-DD" vs founded_month "창업연월" — diff에서 확인.
 * - companyName/birthdate/businessItem/bizNo: 보드 셀이 없는 정본 대상
 *   (source "canonical"). 서버가 OCR 키 일치·deal·연계·값을 재확인한다.
 * - legalForm: 정본 키가 없어 미지원(선택 불가 + 사유 표시). 무음 저장 금지.
 */
export const OCR_UNSUPPORTED_REASON: Partial<Record<OcrFieldKey, string>> = {
  legalForm: "법인 형태는 과세 유형과 다른 참고 정보라 저장하지 않습니다.",
};
export const OCR_BOARD_KEY_CANDIDATES: Partial<Record<OcrFieldKey, string>> = {
  representative: "rep_name",
  businessAddress: "address_detail",
  businessCategory: "industry",
  taxation: "biz_reg_type",
  openedOn: "founded_month",
  companyName: "title",
  birthdate: "birthdate",
  businessItem: "business_item",
  bizNo: "biz_no",
};

const CANONICAL_TARGET_KEYS = new Set(["title", "birthdate", "business_item", "biz_no"]);

export type OcrBoardTarget = {
  boardKey: string;
  source: "column" | "detail" | "canonical";
};

export function resolveOcrBoardTargets(
  layouts: ReadonlyArray<ReadonlyArray<DetailLayoutEntry>>,
  columns: readonly BoardColumn[],
): Partial<Record<OcrFieldKey, OcrBoardTarget>> {
  const detailKeys = new Set<string>();
  for (const entries of layouts) {
    for (const entry of entries) {
      if (entry.source === "detail") detailKeys.add(entry.key);
    }
  }
  const columnKeys = new Set(columns.map((column) => column.key));
  const targets: Partial<Record<OcrFieldKey, OcrBoardTarget>> = {};
  for (const [ocrKey, boardKey] of Object.entries(OCR_BOARD_KEY_CANDIDATES)) {
    if (!boardKey) continue;
    // 셀 없는 정본 대상은 보드 배치가 아니라 deal·서버가 소유한다.
    if (CANONICAL_TARGET_KEYS.has(boardKey)) {
      targets[ocrKey as OcrFieldKey] = { boardKey, source: "canonical" };
      continue;
    }
    if (detailKeys.has(boardKey)) {
      targets[ocrKey as OcrFieldKey] = { boardKey, source: "detail" };
    } else if (columnKeys.has(boardKey)) {
      targets[ocrKey as OcrFieldKey] = { boardKey, source: "column" };
    }
    // 둘 다 없으면 미매핑 — 조용히 저장하지 않고 모달이 사유를 보여준다.
  }
  return targets;
}

/**
 * 확정 체크가 필요한 OCR 키.
 * - 사업자등록번호: 체크섬 통과 확인에 사용자 확정이 함께 있어야 한다.
 * - 연계 회사명: 틀린 원본을 고치는 정정이라 사용자 확정이 있어야 한다.
 *   미연계 title만 바꿀 때는 확정이 필요 없다.
 */
export function ocrRequireConfirm(key: OcrFieldKey, linkedCompany: boolean): boolean {
  return key === "bizNo" || (key === "companyName" && linkedCompany);
}

/** 실제 컬럼 정의 기준 읽기전용·자동계산 칸 (UI도 잠그고 서버도 막는다). */
export function ocrReadonlyReason(
  columns: readonly BoardColumn[],
  boardKey: string,
): string | undefined {
  const column = columns.find((candidate) => candidate.key === boardKey);
  if (!column) return undefined;
  if (column.is_readonly) return "자동 계산되는 칸이라 손으로 고칠 수 없습니다.";
  if (!isFieldSource(column.source) || !isSourceEditable(column.source)) {
    return "자동으로 채워지는 칸은 직접 바꿀 수 없습니다.";
  }
  return undefined;
}

export function ocrCellText(value: CellValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

export function ItemDetailOcr({
  boardId,
  itemId,
  dealId,
  values,
  columns,
  boardLayout,
  layout,
  canEditItems,
}: {
  boardId: string;
  itemId: string;
  /** linked 신규리드 행의 deal. 정본 보드에서만 정본 RPC로 분기된다. */
  dealId?: string | null;
  values: ItemWithValues["values"];
  columns: readonly BoardColumn[];
  boardLayout: readonly DetailLayoutEntry[];
  layout: readonly DetailLayoutEntry[];
  canEditItems: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loadingCurrent, setLoadingCurrent] = useState(false);
  const [extraCurrent, setExtraCurrent] = useState<{
    title: string;
    bizNo: string;
    birthdate: string;
    businessItem: string;
    linkedCompany: boolean;
    linkedCompanyName: string;
  } | null>(null);
  const [loadError, setLoadError] = useState("");

  const handleOpen = useCallback(async () => {
    setLoadError("");
    setLoadingCurrent(true);
    try {
      // 정본 비교 기준 typed 읽기 — 실패하면 모달을 열지 않는다.
      // 비교 기준 없이 적용 버튼이 켜지는 일은 없다 (deny apply until loaded).
      const result = await loadOcrCurrentAction({ boardId, itemId });
      if (!result.ok) {
        setLoadError(result.message);
        setExtraCurrent(null);
        return;
      }
      setExtraCurrent({
        title: result.current.title,
        bizNo: result.current.bizNo,
        birthdate: result.current.birthdate,
        businessItem: result.current.businessItem,
        linkedCompany: result.current.linkedCompany,
        linkedCompanyName: result.current.linkedCompanyName,
      });
      setOpen(true);
    } finally {
      setLoadingCurrent(false);
    }
  }, [boardId, itemId]);

  if (!canEditItems) return null;
  return (
    <>
      <div className="grid gap-1">
        <button
          type="button"
          onClick={() => void handleOpen()}
          disabled={loadingCurrent}
          className="rounded-lg border border-mw-line px-3 py-2 text-xs font-bold"
        >
          {loadingCurrent ? "비교 기준 읽는 중…" : "사업자등록증 OCR로 읽기"}
        </button>
        <p className="text-xs text-mw-sub">
          파일은 이 브라우저 안에서만 읽습니다. 체크한 필드만 직접 반영됩니다.
        </p>
        {loadError ? (
          <p className="text-xs text-mw-sub" role="alert">
            {loadError} 다시 시도하려면 위 버튼을 누르세요.
          </p>
        ) : null}
      </div>
      {open ? (
        <ItemDetailOcrDialog
          boardId={boardId}
          itemId={itemId}
          dealId={dealId}
          values={values}
          columns={columns}
          boardLayout={boardLayout}
          layout={layout}
          extraCurrent={extraCurrent}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/** useRouter는 모달이 실제로 열릴 때만 호출한다 (테스트·SSR 안전). */
function ItemDetailOcrDialog({
  boardId,
  itemId,
  dealId,
  values,
  columns,
  boardLayout,
  layout,
  extraCurrent,
  onClose,
}: {
  boardId: string;
  itemId: string;
  dealId?: string | null;
  values: ItemWithValues["values"];
  columns: readonly BoardColumn[];
  boardLayout: readonly DetailLayoutEntry[];
  layout: readonly DetailLayoutEntry[];
  extraCurrent: {
    title: string;
    bizNo: string;
    birthdate: string;
    businessItem: string;
    linkedCompany: boolean;
    linkedCompanyName: string;
  } | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const linkedCompany = extraCurrent?.linkedCompany === true;
  const { fieldMap, byBoardKey, current } = useMemo(() => {
    const targets = resolveOcrBoardTargets([boardLayout, layout], columns);
    const map: Partial<Record<OcrFieldKey, string>> = {};
    const keys: Record<string, OcrBoardTarget> = {};
    const cur: Partial<Record<OcrFieldKey, string>> = {};
    const extra: Partial<Record<OcrFieldKey, string>> = {
      companyName: extraCurrent?.title ?? "",
      bizNo: extraCurrent?.bizNo ?? "",
      birthdate: extraCurrent?.birthdate ?? "",
      businessItem: extraCurrent?.businessItem ?? "",
    };
    for (const [ocrKey, target] of Object.entries(targets)) {
      if (!target) continue;
      const key = ocrKey as OcrFieldKey;
      map[key] = target.boardKey;
      keys[target.boardKey] = target;
      cur[key] =
        target.source === "canonical" ? (extra[key] ?? "") : ocrCellText(values[target.boardKey]);
    }
    return { fieldMap: map, byBoardKey: keys, current: cur };
  }, [boardLayout, layout, columns, values, extraCurrent]);

  // 과세 라벨 → 사업자유형 전체 문자열. base 모호 시 선택 불가 + 사유.
  // 읽기전용·자동계산 칸도 여기서 잠근다 (서버가 최종 판정).
  const suggest = useCallback(
    (key: OcrFieldKey, proposed: string, currentValue: string) => {
      const boardKey = fieldMap[key];
      if (boardKey) {
        const locked = ocrReadonlyReason(columns, boardKey);
        if (locked) return { value: proposed, unsupportedReason: locked };
      }
      if (key !== "taxation") return { value: proposed };
      const decided = suggestBizRegTypeValue(currentValue, proposed);
      if (decided.supported) return { value: decided.value };
      return { value: proposed, unsupportedReason: decided.reason };
    },
    [columns, fieldMap],
  );

  const unsupportedReason = useCallback(
    (key: OcrFieldKey) => OCR_UNSUPPORTED_REASON[key],
    [],
  );

  // 사업자등록번호는 체크섬 통과분만, 연계 회사명은 원본 정정이므로 명시 확정
  // 대상이다 (미연계 title만 바꿀 때는 확정 없이 저장된다).
  const requireConfirm = useCallback(
    (key: OcrFieldKey) => ocrRequireConfirm(key, linkedCompany),
    [linkedCompany],
  );

  const handleApply: OcrApplyHandler = useMemo(
    () =>
      (async (request) => {
        const base = createDetailApplyHandler({
          fieldMap,
          saveField: async (boardKey, value, meta) => {
            const target = byBoardKey[boardKey];
            if (!target) throw new Error("보드 필드 매핑이 없습니다.");
            const selection = request.selections.find((s) => s.fieldKey === meta.fieldKey);
            // 정본 보드의 정본 키는 서버가 정본 RPC로 분기한다.
            // requestId는 필드별 안정 멱등 키로 그대로 전달된다.
            // 회사명은 비교 화면의 이전값을 CAS로 함께 보내 틀린 원본만 고친다.
            const result = await saveOcrFieldAction({
              boardId,
              itemId,
              dealId: dealId ?? null,
              ocrKey: meta.fieldKey,
              fieldKey: boardKey,
              source: target.source === "canonical" ? "canonical" : target.source,
              value,
              requestId: meta.requestId,
              confirmed: selection?.confirmed === true,
              expected:
                meta.fieldKey === "companyName" && target.source === "canonical"
                  ? (extraCurrent?.linkedCompanyName ?? null)
                  : undefined,
            });
            if (!result.ok) throw new Error(result.message);
          },
        });
        const result = await base(request);
        // 저장 후 재조회 — 성공분만 서버 값으로 다시 읽어 확인한다.
        if (result.ok) router.refresh();
        return result;
      }),
    [fieldMap, byBoardKey, boardId, itemId, dealId, router, extraCurrent?.linkedCompanyName],
  );

  return (
    <DocumentOcrModal
      open
      current={current}
      fieldMap={fieldMap}
      onApply={handleApply}
      onClose={onClose}
      suggest={suggest}
      unsupportedReason={unsupportedReason}
      requireConfirm={requireConfirm}
    />
  );
}
