/**
 * status(선택지) 컬럼 색상 규약 — 먼데이 "상태" 컬럼 재현 (T05 · B3).
 *
 * 색의 출처는 `FieldOption.color`(hex) 다. 아직 색이 없는 옵션에는 **id 기반 결정적
 * 팔레트**를 배정한다 — 렌더마다 색이 바뀌지 않아야 하기 때문(정렬·재조회 무관 고정).
 *
 * ⚠ 선구현 상태: 실제 상태 라벨·hex 는 기획2가 `002_seed_policyfund.sql` 에 넣기로 한
 * 항목이다. 그 전까지 화면 확인용으로 `DUMMY_STATUS_OPTIONS` 를 쓰고, 시드가 들어오면
 * **이 파일의 더미만 제거**하면 된다(컴포넌트·색 배정 로직은 그대로).
 */

import type { FieldOption } from "@/lib/types";

/**
 * 먼데이 상태 컬럼 계열 팔레트. 배정은 아래 pickPaletteColor 가 결정적으로 수행.
 *
 * 접근성 제약: 칩 글자는 작은 텍스트(text-xs)라 WCAG **AA 4.5:1** 이 필요하다.
 * 먼데이 원색 중 red(#e2445c)·blue(#0086c0)·purple(#a25ddc)·teal(#009688) 은
 * 중간 톤이라 흰 글자·검은 글자 **어느 쪽으로도 4.5 를 넘기지 못한다**(최대 ~4.1).
 * 그래서 그 4색만 색상(hue)은 유지한 채 어둡게 조정했다. `status-palette.test.ts`
 * 가 전 색의 명암비를 검증하므로, 색을 추가·변경하면 테스트가 먼저 잡는다.
 */
export const STATUS_PALETTE: readonly string[] = [
  "#00c875", // green
  "#fdab3d", // orange
  "#c4314b", // red   (원색 #e2445c → AA 미달로 어둡게)
  "#0073a8", // blue  (원색 #0086c0 → AA 미달로 어둡게)
  "#8348b8", // purple(원색 #a25ddc → AA 미달로 어둡게)
  "#ffcb00", // yellow
  "#00796b", // teal  (원색 #009688 → AA 미달로 어둡게)
  "#ff642e", // deep orange
  "#784bd1", // deep purple
  "#66ccff", // sky
];

/** 값이 없는(미지정) 상태 셀의 색. */
export const STATUS_EMPTY_COLOR = "#c4c4c4";

/**
 * 임시 상태 옵션 — 실제 라벨/hex 가 시드에 들어오기 전 화면 확인용.
 * @deprecated 002 seed 의 실 상태 라벨이 확정되면 제거하고 시드 옵션을 쓴다.
 */
export const DUMMY_STATUS_OPTIONS: readonly FieldOption[] = [
  { id: "dummy-todo", label: "대기", color: "#c4c4c4", order: 0 },
  { id: "dummy-doing", label: "진행중", color: "#fdab3d", order: 1 },
  { id: "dummy-review", label: "검토", color: "#0073a8", order: 2 },
  { id: "dummy-done", label: "완료", color: "#00c875", order: 3 },
  { id: "dummy-hold", label: "보류", color: "#c4314b", order: 4 },
];

/** 문자열 → 안정적인 32bit 해시(FNV-1a). 같은 id 는 항상 같은 색. */
function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 색이 지정되지 않은 옵션에 배정할 팔레트 색(결정적). */
export function pickPaletteColor(optionId: string): string {
  return STATUS_PALETTE[hashId(optionId) % STATUS_PALETTE.length];
}

/** 정규화된 hex(#rrggbb) 또는 null. #rgb 축약형도 허용. */
export function normalizeHex(color: string | null | undefined): string | null {
  if (!color) return null;
  const s = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    const [, r, g, b] = /^#(.)(.)(.)$/.exec(s)!;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}

/** 옵션의 최종 표시 색 — 지정색 우선, 없으면 결정적 팔레트. */
export function resolveStatusColor(option: FieldOption): string {
  return normalizeHex(option.color) ?? pickPaletteColor(option.id);
}

/** 칩 글자색 후보 — 실제로 반환하는 두 색. */
const TEXT_LIGHT = "#ffffff";
const TEXT_DARK = "#1f1f1f";

/** WCAG 상대휘도(0=검정, 1=흰색). */
export function relativeLuminance(color: string): number {
  const hex = normalizeHex(color) ?? "#000000";
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** WCAG 명암비(1~21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 배경색 위에 얹을 글자색 — 실제 후보 두 색과의 **명암비를 직접 비교**해 큰 쪽.
 * (상태 칩은 색이 옵션마다 달라서 글자색을 고정하면 읽히지 않는 조합이 생긴다.)
 *
 * 주의: 어두운 글자는 순검정이 아니라 #1f1f1f 이므로, 비교도 그 색 기준으로 해야 한다
 * — 순검정으로 어림하면 경계 색에서 더 나쁜 쪽을 고르게 된다.
 */
export function contrastTextColor(background: string): typeof TEXT_LIGHT | typeof TEXT_DARK {
  return contrastRatio(background, TEXT_LIGHT) >= contrastRatio(background, TEXT_DARK)
    ? TEXT_LIGHT
    : TEXT_DARK;
}

/** 한 상태 칩을 그리는 데 필요한 표시 정보. */
export interface StatusChip {
  id: string;
  label: string;
  background: string;
  color: string;
}

/** 옵션 id → 칩. 옵션 정의에 없으면 id 를 라벨로 쓰고 회색(고아 값 가시화). */
export function toStatusChip(
  optionId: string,
  options: readonly FieldOption[] | null | undefined,
): StatusChip {
  const opt = options?.find((o) => o.id === optionId);
  if (!opt) {
    return { id: optionId, label: optionId, background: STATUS_EMPTY_COLOR, color: "#1f1f1f" };
  }
  const background = resolveStatusColor(opt);
  return { id: opt.id, label: opt.label, background, color: contrastTextColor(background) };
}
