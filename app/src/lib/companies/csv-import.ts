/**
 * 고객사 CSV 가져오기 — «CSV 한 줄 → 회사 한 건» 매핑.
 *
 * ★ 이 모듈은 순수 함수다. DB·네트워크를 모른다. 그래서 테스트가 실제 규칙을 잰다.
 *
 * ★★ 먼데이 전용으로 짜지 않는다.
 *   docs/design/먼데이-마이그레이션-기준.md §4 의 «표준 필드» 를 목표로 두고,
 *   CRM 별 헤더 이름은 별칭 표로 «추가» 한다. 다음 CRM 이 오면 별칭만 늘리면 된다.
 *   지금은 먼데이 헤더와 한국어 일반 헤더를 1번 기준으로 넣는다.
 */

import type { NewCompany } from "@/lib/repo";
import { parseNumericInput } from "@/lib/format/number";
import { normalizeCompanyName } from "@/lib/company/match";

/** 표준 필드 → 받아들이는 헤더 이름들(소문자·공백제거 후 비교). */
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  name: ["회사명", "업체명", "상호", "company", "companyname", "name"],
  owner_name: ["대표자명", "대표자이름", "대표자", "대표", "ceo", "ceoname", "owner"],
  phone: ["전화번호", "연락처", "휴대폰", "phone", "tel", "mobile"],
  email: ["이메일", "email", "mail"],
  region: ["지역", "region", "소재지"],
  biz_type: ["업종", "업태", "업종업태", "사업자유형", "biztype", "industry"],
  homepage: ["홈페이지", "페이지링크", "링크", "homepage", "website", "url"],
  revenue: ["매출액", "연매출액", "매출", "revenue"],
  founded_on: ["창업년도", "설립일", "창업일", "foundedon", "founded"],
};

const normalizeHeader = (raw: string) => raw.replace(/[\s_()/]/g, "").toLowerCase();

/** 헤더 목록 → { 표준필드: 원본헤더 }. 못 알아본 헤더는 담지 않는다. */
export function resolveHeaderMap(headers: readonly string[]): Readonly<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const header of headers) {
    const key = normalizeHeader(header);
    for (const [field, aliases] of Object.entries(ALIASES)) {
      if (map[field]) continue;
      if (aliases.includes(key)) { map[field] = header; break; }
    }
  }
  return map;
}

/** "1,200만" 같은 표기는 «해석하지 않는다» — 숫자로 못 읽으면 null 이다. 지어내지 않는다. */
export function parseRevenue(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[,\s원]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const parsed = parseNumericInput(cleaned, { allowDecimal: cleaned.includes(".") });
  return parsed.ok ? parsed.value : null;
}

/** YYYY-MM-DD 로 읽히는 것만 받는다. 2024, 2024.03, 2024/03/05 도 받는다. */
export function parseFoundedOn(raw: string | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (/^\d{4}$/.test(value)) return `${value}-01-01`;
  const parts = value.split(/[.\-/]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 2 && /^\d{4}$/.test(parts[0])) {
    return `${parts[0]}-${parts[1].padStart(2, "0")}-01`;
  }
  if (parts.length === 3 && /^\d{4}$/.test(parts[0])) {
    return `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
  }
  return null;
}

export type ImportRow = Readonly<{ title: string; values: Record<string, string>; line?: number }>;

export type MappedRow = Readonly<{ input: NewCompany; line: number }>;

/**
 * QA #885 — 같은 회사 판정 키: 정규화 회사명 + 대표자명(없으면 빈 칸).
 * 사업자번호는 CSV 별칭에 없어 쓰지 않는다. 자동 병합하지 않고 «건너뛴다» 만 한다(D40).
 */
export function companyDuplicateKey(name: string, ownerName: string | null | undefined): string {
  return `${normalizeCompanyName(name)}|${(ownerName ?? "").trim()}`;
}
export type RejectedRow = Readonly<{ line: number; title: string; reason: string }>;

export type MappingResult = Readonly<{
  mapped: readonly MappedRow[];
  rejected: readonly RejectedRow[];
  recognized: readonly string[];
  unrecognized: readonly string[];
}>;

export const IMPORT_ROW_CAP = 500;

/**
 * CSV 행들을 회사 입력으로 바꾼다.
 *
 * 규칙:
 *   · 첫 열(title)이 회사명이다. 헤더에 «회사명» 이 따로 있으면 그쪽이 이긴다.
 *   · 이름이 비면 그 행은 «거절» 이다 — 이름 없는 회사를 만들지 않는다.
 *   · 못 알아본 헤더는 버리되 «버렸다는 사실» 을 unrecognized 로 돌려준다.
 *     조용히 버리면 사용자는 데이터가 들어간 줄 안다.
 */
export function mapCsvToCompanies(
  rows: readonly ImportRow[],
  headers: readonly string[],
): MappingResult {
  const headerMap = resolveHeaderMap(headers);
  const recognized = Object.values(headerMap);
  const unrecognized = headers.filter((header) => !recognized.includes(header));

  const mapped: MappedRow[] = [];
  const rejected: RejectedRow[] = [];
  const firstLineByKey = new Map<string, number>();

  rows.forEach((row, index) => {
    // 원본 파일의 줄 번호(파서가 준 것). 없으면 예전처럼 «헤더 다음부터 순서대로» 센다.
    const line = row.line ?? index + 2;
    const pick = (field: string) => {
      const header = headerMap[field];
      return header ? (row.values[header] ?? "").trim() : "";
    };
    const name = (pick("name") || row.title || "").trim();
    if (!name) {
      rejected.push({ line, title: row.title, reason: "회사명이 비어 있습니다" });
      return;
    }
    const ownerName = pick("owner_name") || null;
    const key = companyDuplicateKey(name, ownerName);
    const first = firstLineByKey.get(key);
    if (first !== undefined) {
      rejected.push({ line, title: name, reason: `${first}행과 같은 회사예요(회사명·대표자명이 같음)` });
      return;
    }
    firstLineByKey.set(key, line);
    mapped.push({
      line,
      input: {
        name,
        owner_name: ownerName,
        phone: pick("phone") || null,
        email: pick("email") || null,
        region: pick("region") || null,
        biz_type: pick("biz_type") || null,
        homepage: pick("homepage") || null,
        revenue: parseRevenue(pick("revenue")),
        founded_on: parseFoundedOn(pick("founded_on")),
      },
    });
  });

  return { mapped, rejected, recognized, unrecognized };
}
