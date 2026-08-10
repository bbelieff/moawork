/**
 * 업체 마스터 — 검색·중복판정 도메인 타입 (BBE-125).
 *
 * `companies`/`deals` 테이블 스키마는 아직 없다 — BBE-108(회계 원장, blocked_by)이
 * 미착수라 `docs/design/업체·자금건_데이터모델_v1.md` §2 확정본으로 migration을 내는 건
 * 이 카드 범위 밖으로 미룬다. 여기 타입은 그 설계서 §2-1 필드명을 camelCase로 옮긴
 * "미래 companies 행의 부분집합"이며, DB 연동 전까지는 호출자가 임의 출처(픽스처·API
 * 응답 등)에서 채워 넣는다.
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

/** `pickCompany`로 새 행을 만들 때 자동으로 채워지는 필드(목업 fillFrom 1:1). */
export interface CompanyAutoFillFields {
  ceoName: string | null;
  bizType: string | null;
  industry: string | null;
  phone: string | null;
  regionSido: string | null;
  regionSigungu: string | null;
  foundedOn: string | null;
  revenue: string | null;
}

/** 신규 업체 등록/이관 시 중복 판정에 필요한 입력. */
export interface CompanyIdentityInput {
  name: string;
  bizNo?: string | null;
  ceoName?: string | null;
}

export type DuplicateMatchKind =
  /** 사업자등록번호가 일치 — 같은 회사로 확정(설계서 §2-1 "유일 키"). */
  | "confirmed"
  /** 정규화 회사명 + 대표자명이 일치하나 사업자등록번호가 없거나 다름 — 자동 병합 금지(D40). */
  | "suspected";

export interface DuplicateMatch {
  kind: DuplicateMatchKind;
  candidate: CompanyCandidate;
}
