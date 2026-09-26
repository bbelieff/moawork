/**
 * document-ocr — 브라우저 로컬 사업자등록증 OCR + 사용자 확인 diff 타입.
 *
 * 원칙:
 * - 문서는 브라우저를 벗어나지 않는다. OCR·파싱 모두 same-origin 에셋으로 로컬 수행.
 * - OCR은 제안(proposed)만 만든다. 확정 저장은 사용자가 체크한 필드에 한해
 *   부모가 전달한 onApply를 통해서만 일어난다. 자동 최종 저장은 없다.
 * - 빈 제안값은 양호한 기존값을 대체하지 않는다(blank protection).
 */

/** 사업자등록증에서 추출을 시도하는 필드 키. VAT 증빙 필드는 명세 불가 → pending. */
export const OCR_FIELD_KEYS = [
  "taxation",
  "companyName",
  "representative",
  "birthdate",
  "openedOn",
  "businessAddress",
  "businessCategory",
  "businessItem",
  "bizNo",
  "legalForm",
] as const;

export type OcrFieldKey = (typeof OCR_FIELD_KEYS)[number];

/** 과세 유형 — 법인이 아닌 세금 범주. 법인 형태(legalForm)와 분리한다. */
export const TAXATION_VALUES = ["general", "simplified", "exempt"] as const;
export type TaxationValue = (typeof TAXATION_VALUES)[number];

export const TAXATION_LABEL: Record<TaxationValue, string> = {
  general: "일반과세자",
  simplified: "간이과세자",
  exempt: "면세사업자",
};

/** 필드별 한글 라벨 (diff UI 표시용). */
export const OCR_FIELD_LABEL: Record<OcrFieldKey, string> = {
  taxation: "과세 유형",
  companyName: "상호 (법인명)",
  representative: "대표자 성명",
  birthdate: "생년월일",
  openedOn: "개업연월일",
  businessAddress: "사업장 소재지",
  businessCategory: "업태",
  businessItem: "종목",
  bizNo: "사업자등록번호",
  legalForm: "법인 형태 (참고)",
};

/** 단일 필드 제안. value="" 는 미추출(보호 대상)이다. */
export type OcrProposedField = {
  key: OcrFieldKey;
  /** 편집 가능한 제안값. 미추출이면 "". */
  value: string;
  /** 0~1. 라벨 일치·형식 정합·체크섬 등으로 산출한 경험적 수치다. */
  confidence: number;
  /** 사람이 읽을 경고 (반복 라벨, 형식 의심, 주민번호 무시 등). */
  warnings: string[];
  /** 원문 근거 스니펫 (디버그/신뢰 표시용, 개인정보는 마스킹하지 않으므로 화면 노출 주의). */
  evidence?: string;
  /** bizNo 등 형식 검증 결과. 검증 실패 제안은 기본 미선택. */
  valid?: boolean;
};

export type OcrParseResult = {
  fields: Record<OcrFieldKey, OcrProposedField>;
  /** 전체 텍스트 대비 파서가 살린 정도 등 사람이 볼 요약 경고. */
  documentWarnings: string[];
  /** OCR 원문 길이 (0이면 텍스트층 직접 추출). */
  sourceChars: number;
  /** 텍스트 확보 경로. */
  sourceKind: "ocr" | "pdf-text";
};

/** OCR 실행 단계 (진행률 UI용). */
export type OcrStage =
  | "validating"
  | "pdf-text"
  | "pdf-render"
  | "recognizing"
  | "parsing"
  | "done";

export type OcrProgress = {
  stage: OcrStage;
  /** 0~1. recognizer가 주지 않으면 단계별 추정치다. */
  ratio: number;
  message: string;
};

export const OCR_STAGE_LABEL: Record<OcrStage, string> = {
  validating: "파일 확인 중",
  "pdf-text": "PDF 텍스트층 읽는 중",
  "pdf-render": "PDF 첫 페이지 그리는 중",
  "recognizing": "문자 인식 중",
  done: "완료",
  parsing: "필드 추출 중",
};

/**
 * diff 모달이 부모 onApply에 넘기는 확정 요청. requestId는 문서 세션의
 * base 의도 ID(세션 내내 고정)다. 실제 저장 호출에는 필드별로
 * `deriveOcrFieldRequestId`를 거친 안정 ID를 쓴다 — SQL 영수증
 * PK(org, request_id)가 payload에 묶이므로 base ID 공용은 22023을 낸다.
 */
export type OcrApplySelection = {
  fieldKey: OcrFieldKey;
  value: string;
  /** 명시 확정 행(사업자등록번호)의 확정 여부 — 서버도 재확인한다. */
  confirmed?: boolean;
};

export type OcrApplyRequest = {
  requestId: string;
  selections: OcrApplySelection[];
};

export type OcrApplyResult = {
  ok: boolean;
  /** 필드별 실패 메시지. 없는 키는 성공으로 간주. */
  fieldErrors: Partial<Record<OcrFieldKey, string>>;
  message?: string;
};

export type OcrApplyHandler = (
  request: OcrApplyRequest,
) => Promise<OcrApplyResult>;
