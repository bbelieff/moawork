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

/**
 * 브라우저의 업체 선택기에 필요한 최소 회사 정보.
 *
 * 서버의 `Company` 전체를 넘기면 화면이 쓰지 않는 조직 id·매출·담당자 id·생성시각까지
 * RSC payload에 실린다. 권한 안의 값이라도 클라이언트에 필요 없는 값은 보내지 않는다.
 */
export interface CompanyPickerCompany {
  id: string;
  name: string;
  biz_type: string | null;
  region: string | null;
  owner_name: string | null;
  phone: string | null;
  email: string | null;
  homepage: string | null;
}

/**
 * 질의가 «초성만» 으로 이루어졌나.
 *
 * 완성된 한글 음절(가~힣)이 하나라도 있으면 아니다. 영문·숫자·자음은 초성 질의로 친다.
 */
export function isChosungQuery(query: string): boolean {
  return !/[가-힣]/.test(query);
}

/**
 * 한 조각이 질의에 걸리나 — 원문과 초성 둘을 본다.
 *
 * ★ 전에는 셋째로 `chosung(field).includes(chosung(query))` 가 있었다. 즉 «질의까지»
 *   초성으로 낮춰서 견줬다. 그게 과매칭의 원인이다 —
 *     「대성」 → ㄷㅅ  →  「다스산업」(ㄷㅅㅅㅇ)·「동서물류」(ㄷㅅㅁㄹ) 이 다 걸린다.
 *
 * ★ 그런데 그 조건은 «질의가 이미 초성뿐일 때» 둘째 조건과 하는 일이 똑같다
 *   (chosung(query) === query 이므로). 즉 셋째가 «추가로» 걸리는 경우는 질의에
 *   완성형 글자가 있을 때뿐이고, 그게 정확히 사람이 원하지 않는 매칭이다.
 *
 *   그래서 초성끼리 비교는 «질의가 초성일 때만» 한다. 초성 검색 기능은 그대로 살아 있다.
 */
function matchesText(field: string, query: string): boolean {
  if (!field) return false;
  const lowerField = field.toLowerCase();
  const lowerQuery = query.toLowerCase();
  if (lowerField.includes(lowerQuery)) return true;
  // 질의가 초성일 때만 초성으로 견준다. 다 쓴 이름을 초성으로 낮추지 않는다.
  return isChosungQuery(query) && chosung(field).includes(query);
}

/** 검색 대상이 되는 «회사 고유정보» — 여기 없는 칸은 검색되지 않는다. */
export function searchableFields(company: CompanyPickerCompany): string[] {
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

export function companyMatches(company: CompanyPickerCompany, rawQuery: string): boolean {
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
  company: CompanyPickerCompany;
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
