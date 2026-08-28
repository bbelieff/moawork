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

/** 한글 초성 자모(ㄱ~ㅎ). 이 글자가 질의에 있으면 «초성으로 찾는 중» 이다. */
const CHOSUNG_JAMO = /[\u3131-\u314e]/;

/** 질의 한 글자가 대상 한 글자에 걸리나. 자모면 초성끼리, 아니면 글자끼리 견준다. */
function charMatches(fieldChar: string, queryChar: string): boolean {
  if (CHOSUNG_JAMO.test(queryChar)) return chosung(fieldChar) === queryChar;
  return fieldChar.toLowerCase() === queryChar.toLowerCase();
}

/**
 * 한 조각이 질의에 걸리나 — «글자 단위» 로 견준다.
 *
 * ★ 왜 글자 단위인가. 전에는 세 조건을 통째로 봤다.
 *     ① 원문끼리        ② 대상만 초성으로       ③ 대상과 질의 «둘 다» 초성으로
 *   ③ 이 과매칭을 만들었다 — 「대성」을 ㄷㅅ 로 낮춰서 「다스산업」·「동서물류」가 걸렸다.
 *
 *   그런데 ③ 을 «그냥 빼면» 다른 것이 깨진다. 실측으로 확인했다 —
 *     「ㄷ성」·「대ㅅ」 처럼 완성형과 자모가 «섞인» 질의가 0건이 된다.
 *   한글 IME 에서 「대성」을 치다 백스페이스하면 「대ㅅ」을 지나가므로 흔한 입력이다.
 *   그때 목록이 통째로 비고 「찾은 업체가 없습니다」가 뜬다 —
 *   과매칭(정답 + 노이즈)을 무매칭(빈 목록)으로 바꾸는 것이라 «더 나쁘다».
 *
 * ★ 그래서 조건을 빼는 대신 «자리를 맞춰» 본다.
 *     질의 글자가 자모면      그 자리 대상 글자의 초성과 견준다
 *     질의 글자가 완성형이면  그 자리 대상 글자와 그대로 견준다
 *
 * ★ 목업과 «다른 점» — 여기가 유일하다. 되돌리려면 이 함수 하나만 바꾸면 된다.
 *   목업(UI목업_워크스페이스_최종_v6.html 의 hit)은 셋째 조건을 그대로 갖고 있다.
 *   목업에는 회사가 8곳뿐이라 과매칭이 «보이지 않는다». 실제 데이터에서는 보인다 —
 *   그래서 #588 ⑤ 가 이걸 결함으로 적었다(PR #583 검수가 남긴 항목).
 *   belie 가 목업 그대로를 원하면 이 함수를 목업의 세 조건으로 되돌리면 된다.
 *
 *   대성 → 대성산업 ○ · 다스산업 ✕   (과매칭이 없어진다)
 *   ㄷㅅ → 대성산업 ○ · 다스산업 ○   (초성 검색은 그대로다)
 *   ㄷ성 → 대성산업 ○ · 다스산업 ✕   (섞인 질의도 산다)
 *   대ㅅ → 대성산업 ○ · 다스산업 ✕
 * ★ 빈 질의는 «호출부 책임» 이다. 여기서는 false 를 준다.
 *   companyMatches·matchesQuery 가 앞에서 「빈 질의는 전부 통과」를 처리한다.
 *   세 번째 호출부를 만들 사람이 그걸 기대하면 목록이 통째로 빈다.
 */
export function matchesText(field: string, query: string): boolean {
  if (!field || !query) return false;
  // 자모가 없는 질의는 네이티브 includes 로 끝난다 — 첫 키 입력이 가장 자주 밟는 자리다.
  // 아래 글자 단위 비교와 «같은 답» 을 준다(자모가 없으면 글자끼리 견주는 것과 같다).
  if (field.toLowerCase().includes(query.toLowerCase())) return true;
  const target = [...field];
  const needle = [...query];
  for (let start = 0; start + needle.length <= target.length; start += 1) {
    let hit = true;
    for (let index = 0; index < needle.length; index += 1) {
      if (!charMatches(target[start + index], needle[index])) { hit = false; break; }
    }
    if (hit) return true;
  }
  return false;
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
