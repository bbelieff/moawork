import type { Ctx } from "@/lib/types";
import { getRepo } from "@/lib/repo";

// 봉인/해제(entitlement) 게이트. 001 의 org_entitlements(feature_key 기반)를 반영한다.
// 코드는 feature_key 로만 검사한다(플랜명 하드코딩 금지).

/** 현재 컨텍스트(조직)에서 기능이 켜져 있는가. */
export function isEnabled(ctx: Ctx, featureKey: string): boolean {
  return getRepo().isFeatureEnabled(ctx.org.id, featureKey);
}

/** 조직 id 로 직접 검사(세션 밖에서 쓸 때). */
export function isEnabledForOrg(orgId: string, featureKey: string): boolean {
  return getRepo().isFeatureEnabled(orgId, featureKey);
}
