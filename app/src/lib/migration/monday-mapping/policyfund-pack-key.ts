import type { StructurePack } from "./types";
import { POLICYFUND_PACK_KEY, POLICYFUND_STRUCTURE_PACK } from "./policyfund-pack";

/**
 * BBE-132 이전에 노출된 팩 키. 설치 이력과 저장된 링크를 끊지 않도록 조회 별칭으로만 유지한다.
 * 새 기록에는 `POLICYFUND_PACK_KEY`만 사용한다.
 */
export const LEGACY_POLICYFUND_PACK_KEYS = ["pack.seoul.policyfund1"] as const;

export function canonicalPolicyfundPackKey(key: string): string | null {
  return key === POLICYFUND_PACK_KEY || LEGACY_POLICYFUND_PACK_KEYS.some((legacy) => legacy === key)
    ? POLICYFUND_PACK_KEY
    : null;
}

/** 정본 키와 옛 키 모두 같은 중립 팩을 찾는다. */
export function resolvePolicyfundPack(key: string): StructurePack | null {
  return canonicalPolicyfundPackKey(key) === POLICYFUND_PACK_KEY
    ? POLICYFUND_STRUCTURE_PACK
    : null;
}
