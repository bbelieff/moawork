import type { Company } from "@/lib/types";

/**
 * 「업체 추가 — 회사명을 먼저 찾습니다」 의 검색.
 *
 * 목업(T.work 의 openPicker)이 이 흐름을 정의한다:
 *   기존 업체를 고르면 저장된 정보가 그대로 채워진다 — **같은 회사를 두 번 적지 않게.**
 *   그래서 같은 회사로 자금 건을 여러 번 진행할 수 있다.
 *
 * 목업은 «회사명 · 대표» 두 개만 훑는다.
 * 2026-08-26 총괄 직접 지시로 **회사에 붙은 고유정보 전부**를 훑는다 —
 *   「업체추가 할때 회사명 말고도 대표자이름, 연락처 등등 회사와 연결된 고유정보들만 검색해도 되도록」
 *   실무에서는 회사 이름이 기억 안 나고 «그 사장님» 이나 «그 번호» 만 기억나는 때가 많다.
 */

const CHO = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
] as const;

/** 한글 음절을 초성으로 바꾼다. 한글이 아니면 그대로 둔다(영문·숫자도 찾을 수 있게). */
export function chosung(value: string): string {
  return [...String(value)]
    .map((char) => {
      const offset = char.charCodeAt(0) - 0xac00;
      return offset >= 0 && offset < 11172 ? CHO[Math.floor(offset / 588)] : char;
    })
    .join("");
}

/**
 * 전화번호는 사람마다 다르게 적는다 — `010-1234-5678` · `01012345678` · `+82 10 …`.
 * 숫자만 남겨 견주면 그 차이가 사라진다.
 * ★ 국가번호 82 는 앞의 0 과 같은 자리다. `+8210…` 으로 저장된 번호를 `010…` 으로도 찾게 한다.
 */
export function digitsOnly(value: string): string {
  const digits = String(value).replace(/\D+/g, "");
  return digits.startsWith("82") ? `0${digits.slice(2)}` : digits;
}

/** 한 조각이 질의에 걸리나 — 원문·초성·초성끼리 셋 다 본다(목업 `hit` 과 같은 규칙). */
function matchesText(field: string, query: string): boolean {
  if (!field) return false;
  const lowerField = field.toLowerCase();
  const lowerQuery = query.toLowerCase();
  return lowerField.includes(lowerQuery)
    || chosung(field).includes(query)
    || chosung(field).includes(chosung(query));
}

/** 검색 대상이 되는 «회사 고유정보» — 여기 없는 칸은 검색되지 않는다. */
export function searchableFields(company: Company): string[] {
  return [
    company.name,
    company.owner_name ?? "",
    company.phone ?? "",
    company.email ?? "",
    company.biz_type ?? "",
    company.region ?? "",
    company.homepage ?? "",
  ].filter(Boolean);
}

export function companyMatches(company: Company, rawQuery: string): boolean {
  const query = rawQuery.trim();
  if (!query) return true;

  // 숫자가 섞인 질의는 «번호를 찾는 중» 일 가능성이 높다. 번호는 표기 차이를 지우고 본다.
  const queryDigits = digitsOnly(query);
  if (queryDigits.length >= 3) {
    for (const field of [company.phone, company.name]) {
      if (field && digitsOnly(field).includes(queryDigits)) return true;
    }
  }

  return searchableFields(company).some((field) => matchesText(field, query));
}

export interface CompanyPickerRow {
  company: Company;
  /** 이 회사로 이미 진행한 자금 건 수. 0 이면 «이력 없음». */
  dealCount: number;
}

/**
 * 목록 정렬 — «이미 거래한 회사» 를 위로 올린다.
 *
 * 왜: 이 화면의 목적이 «같은 회사를 두 번 적지 않게» 하는 것이다.
 *   이력이 있는 회사가 아래로 밀리면 사람이 못 보고 새로 만들어 버린다 — 그게 바로 중복이다.
 */
export function rankCompanies(rows: readonly CompanyPickerRow[], query: string): CompanyPickerRow[] {
  const trimmed = query.trim();
  return rows
    .filter((row) => companyMatches(row.company, trimmed))
    .sort((a, b) => {
      // 이름이 «질의로 시작» 하면 가장 위 — 사람이 친 그대로 맞은 것이다.
      const aStarts = a.company.name.toLowerCase().startsWith(trimmed.toLowerCase()) ? 0 : 1;
      const bStarts = b.company.name.toLowerCase().startsWith(trimmed.toLowerCase()) ? 0 : 1;
      if (trimmed && aStarts !== bStarts) return aStarts - bStarts;
      if (a.dealCount !== b.dealCount) return b.dealCount - a.dealCount;
      return a.company.name.localeCompare(b.company.name, "ko");
    });
}
