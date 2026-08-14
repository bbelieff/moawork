/**
 * 업체 마스터 — 검색·중복판정 도메인 타입 (BBE-125).
 *
 * `companies`/`deals` 정본 위에 BBE-125가 추가한 식별·검색·참조 계약이다.
 * UI는 이 타입의 값을 딜에 복제하지 않고 `companyId`로 회사 마스터를 다시 읽는다.
 */

/** 검색·픽커에 필요한 최소 필드. 실제 companies 컬럼이 늘어도 이 계약은 좁게 유지한다. */
export interface CompanyCandidate {
  id: string;
  /** 사업자등록번호. 없으면 null — 식별 1순위(설계서 §2-1). */
  bizNo: string | null;
  name: string;
  ceoName: string | null;
  /** 사업자 유형(법인/개인/개인·간이 등). */
  bizType: string | null;
  /** 업종/업태. */
  industry: string | null;
  /** 시도 (예: "경남"). */
  regionSido: string | null;
  /** 시군구 (예: "김해시"). */
  regionSigungu: string | null;
  phone: string | null;
  foundedOn: string | null;
  revenue: string | null;
  /** 진행 이력 건수 — 표시용. 0이면 "이력 없음". */
  dealCount: number;
  /** 가장 최근 진행 내역 한 줄 요약. dealCount가 0이면 null. */
  lastActivity: string | null;
}

/**
 * 딜 화면에서 회사 마스터를 읽어 표시할 7개 개념 필드.
 *
 * 값 자체를 반환하지 않는다. 딜은 `companyId`만 저장하고 화면이 아래 키로 회사 행을
 * 조회해야 한다. 지역은 시도·시군구 두 칸이지만 하나의 `region` 개념으로 묶는다.
 */
export const COMPANY_REFERENCE_FIELDS = [
  "ceoName",
  "businessType",
  "industry",
  "region",
  "phone",
  "foundedOn",
  "revenue",
] as const;

export type CompanyReferenceField = (typeof COMPANY_REFERENCE_FIELDS)[number];

export interface CompanyReference {
  companyId: string;
  fields: readonly CompanyReferenceField[];
}

/** 신규 업체 등록/이관 시 중복 판정에 필요한 입력. */
export interface CompanyIdentityInput {
  name: string;
  bizNo?: string | null;
  ceoName?: string | null;
}

/** 계약 이관에서 회사 마스터에 저장되는 값. */
export interface CompanyHandoffInput extends CompanyIdentityInput {
  dealId: string;
  existingCompanyId?: string | null;
  bizType?: string | null;
  industry?: string | null;
  regionSido?: string | null;
  regionSigungu?: string | null;
  phone?: string | null;
  foundedOn?: string | null;
  revenue?: string | null;
}

export type CompanyHandoffResult =
  | Readonly<{ mode: "created"; company: CompanyCandidate; reference: CompanyReference }>
  | Readonly<{ mode: "existing"; company: CompanyCandidate; reference: CompanyReference }>
  | Readonly<{
      mode: "created_needs_review";
      company: CompanyCandidate;
      candidates: readonly CompanyCandidate[];
      reference: CompanyReference;
    }>;

export type DuplicateMatchKind =
  /** 사업자등록번호가 일치 — 같은 회사로 확정(설계서 §2-1 "유일 키"). */
  | "confirmed"
  /** 정규화 회사명 + 대표자명이 일치하나 사업자등록번호가 없거나 다름 — 자동 병합 금지(D40). */
  | "suspected";

export interface DuplicateMatch {
  kind: DuplicateMatchKind;
  candidate: CompanyCandidate;
}
