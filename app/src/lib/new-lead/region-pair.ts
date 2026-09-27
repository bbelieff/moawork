import { canonicalSido, canonicalSigungu } from "./region-search";

/**
 * 시도-시군구 쌍 원자 검증 — 표 셀·상세·신규리드 인테이크가 같은 판정을 쓴다.
 *
 * 규칙:
 *  - 둘 다 비어 있으면 지우기(허용).
 *  - 시도 없이 시군구만 있으면 거부.
 *  - 시도는 추천 목록에 있어야 한다.
 *  - 시군구는 그 시도에 딸린 추천 목록에 있어야 한다.
 *  - 시도 변경 때는 시군구를 함께 그동안 묶어 저장한다 — 낱개로 두 번 저장해
 *    중간 잘못된 조합을 남기지 않는다.
 */

export type RegionPairInput = Readonly<{
  sido: string;
  sigungu: string;
}>;

export type RegionPairResult =
  | Readonly<{ ok: true; sido: string | null; sigungu: string | null }>
  | Readonly<{ ok: false; message: string }>;

export function validateRegionPair(input: RegionPairInput): RegionPairResult {
  const sidoRaw = input.sido.trim();
  const sigunguRaw = input.sigungu.trim();

  if (!sidoRaw && !sigunguRaw) {
    return { ok: true, sido: null, sigungu: null };
  }
  if (!sidoRaw && sigunguRaw) {
    return { ok: false, message: "시도를 먼저 선택해 주세요. 입력은 유지됩니다." };
  }
  const sido = canonicalSido(sidoRaw);
  if (!sido) {
    return { ok: false, message: "시도를 추천 목록에서 선택해 주세요. 입력은 유지됩니다." };
  }
  if (!sigunguRaw) {
    return { ok: true, sido, sigungu: null };
  }
  const sigungu = canonicalSigungu(sido, sigunguRaw);
  if (!sigungu) {
    return { ok: false, message: "시군구를 추천 목록에서 선택해 주세요. 입력은 유지됩니다." };
  }
  return { ok: true, sido, sigungu };
}

/**
 * 시도 변경 때 시군구 초기화 — 같은 서버 요청에 함께 넣을 pair를 만든다.
 * 새 시도에 기존 시군구가 딸리지 않으면 시군구는 빈값으로 초기화한다.
 */
export function regionPairForSidoChange(nextSidoRaw: string, currentSigunguRaw: string): RegionPairInput {
  const trimmedSido = nextSidoRaw.trim();
  if (!trimmedSido) return { sido: "", sigungu: "" };
  const sido = canonicalSido(trimmedSido);
  if (!sido) return { sido: nextSidoRaw, sigungu: currentSigunguRaw };
  const sigungu = currentSigunguRaw.trim() ? canonicalSigungu(sido, currentSigunguRaw) : null;
  return { sido, sigungu: sigungu ?? "" };
}

export const REGION_SIDO_KEYS = new Set(["sido", "region_sido"]);
export const REGION_SIGUNGU_KEYS = new Set(["sigungu", "region_sigungu"]);

export function isRegionSidoKey(key: string): boolean {
  return REGION_SIDO_KEYS.has(key);
}

export function isRegionSigunguKey(key: string): boolean {
  return REGION_SIGUNGU_KEYS.has(key);
}

export function isRegionKey(key: string): boolean {
  return isRegionSidoKey(key) || isRegionSigunguKey(key);
}
