/**
 * 서류 체크리스트 저장소 (BBE-110) — 서버 인메모리(globalThis), org 스코프.
 *
 * `@/lib/repo/local/*` 어댑터·BBE-47 의 `boards/groupLayout.ts` 와 같은 idiom이다.
 * 001 deals 테이블(T02 소유)이나 T05 커스텀필드 엔진에 얹지 않고 완전히 독립된 저장소를
 * 쓴다 — 그래서 이 파일 하나만 실 Supabase 어댑터로 갈아끼우면 되고, 다른 트랙의 파일을
 * 전혀 건드리지 않는다.
 *
 * ⚠ 인증·인가는 여기서 하지 않는다. 호출부(service)가 세션에서 얻은 orgId 만 넘기고,
 * 그 딜/조직에 대한 접근 권한 확인은 호출부(또는 향후 실 Supabase RLS)의 책임이다.
 */

import type { DealChecklistState, ProductChecklistPreset } from "./types";

interface Store {
  presets: Map<string, ProductChecklistPreset>;
  deals: Map<string, DealChecklistState>;
}

const g = globalThis as unknown as { __moaworkChecklist?: Store };

function store(): Store {
  g.__moaworkChecklist ??= { presets: new Map(), deals: new Map() };
  return g.__moaworkChecklist;
}

const SEP = "/";
const presetKey = (orgId: string, productId: string) => `${orgId}${SEP}${productId}`;
const dealKey = (orgId: string, dealId: string) => `${orgId}${SEP}${dealId}`;

/** 상품 하나의 회사 공용 기본 체크리스트. 없으면 null(그 상품엔 아직 기본값이 없다는 뜻). */
export function getPreset(orgId: string, productId: string): ProductChecklistPreset | null {
  return store().presets.get(presetKey(orgId, productId)) ?? null;
}

/** 프리셋 저장(있으면 덮어씀) — 관리자 편집·"프리셋으로 저장" 양쪽이 쓴다. */
export function savePreset(orgId: string, preset: ProductChecklistPreset): void {
  store().presets.set(presetKey(orgId, preset.productId), preset);
}

/** 딜의 체크리스트 상태. 저장된 적 없으면 null(호출부가 빈 상태로 초기화해 돌려준다). */
export function getDealChecklist(orgId: string, dealId: string): DealChecklistState | null {
  return store().deals.get(dealKey(orgId, dealId)) ?? null;
}

export function saveDealChecklist(orgId: string, state: DealChecklistState): void {
  store().deals.set(dealKey(orgId, state.dealId), state);
}
