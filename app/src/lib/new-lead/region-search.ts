import { matchesQuery } from "@/lib/company/chosung";
import { CANONICAL_REGIONS } from "@/lib/structure-packs/region-options";

export type RegionSuggestion = Readonly<{ value: string; label: string }>;

const SIDO_LABELS: Readonly<Record<string, string>> = {
  서울: "서울시", 부산: "부산시", 대구: "대구시", 인천: "인천시",
  광주: "광주시", 대전: "대전시", 울산: "울산시",
  세종: "세종시",
  경기: "경기도", 강원: "강원도", 강원도: "강원도", 충북: "충청북도",
  충남: "충청남도", 전북: "전라북도", 전남: "전라남도", 경북: "경상북도",
  경남: "경상남도", 제주: "제주도",
};

const SIDO_VALUES = [
  // 신규리드 기본 보드에 이미 저장된 시도 선택지를 그대로 재사용한다.
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
  "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
] as const;

export const SIDO_SUGGESTIONS: readonly RegionSuggestion[] = SIDO_VALUES.map((value) => ({
  value,
  label: SIDO_LABELS[value] ?? value,
}));

export function canonicalSido(value: string): string | null {
  const trimmed = value.trim();
  const exact = SIDO_SUGGESTIONS.find(
    (entry) => entry.value === trimmed || entry.label === trimmed,
  );
  return exact?.value ?? null;
}

export function searchSido(query: string): RegionSuggestion[] {
  return SIDO_SUGGESTIONS.filter(
    (entry) => matchesQuery(entry.label, query) || matchesQuery(entry.value, query),
  );
}

export function sigunguSuggestions(sidoInput: string): RegionSuggestion[] {
  const sido = canonicalSido(sidoInput);
  if (!sido) return [];
  const prefixes = sido === "강원" ? ["강원_", "강원도_"] : [`${sido}_`];
  return CANONICAL_REGIONS.flatMap((region) => {
    const prefix = prefixes.find((candidate) => region.startsWith(candidate));
    if (!prefix) return [];
    const value = region.slice(prefix.length);
    return value ? [{ value, label: value }] : [];
  });
}

export function searchSigungu(sidoInput: string, query: string): RegionSuggestion[] {
  return sigunguSuggestions(sidoInput).filter((entry) => matchesQuery(entry.label, query));
}

export function canonicalSigungu(sidoInput: string | null, value: string): string | null {
  if (!sidoInput) return null;
  const trimmed = value.trim();
  const exact = sigunguSuggestions(sidoInput).find(
    (entry) => entry.value === trimmed || entry.label === trimmed,
  );
  return exact?.value ?? null;
}
