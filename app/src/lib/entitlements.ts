import type { Ctx } from "@/lib/types";
import { getRepo } from "@/lib/repo";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";

// 봉인/해제(entitlement) 게이트. 001 의 org_entitlements(feature_key 기반)를 반영한다.
// 코드는 feature_key 로만 검사한다(플랜명 하드코딩 금지).

type EntitlementRow = {
  feature_key: unknown;
  enabled: unknown;
};

export class EntitlementReadError extends Error {
  constructor(readonly code: string, cause?: unknown) {
    super("워크스페이스 사용 권한을 확인하지 못했습니다.", { cause });
    this.name = "EntitlementReadError";
  }
}

function uniqueFeatures(featureKeys: readonly string[]): string[] {
  return Array.from(new Set(featureKeys.filter(Boolean)));
}

export async function readSupabaseFeatureStates(
  supabase: SupabaseClient,
  orgId: string,
  featureKeys: readonly string[],
): Promise<Map<string, boolean>> {
  const requested = uniqueFeatures(featureKeys);
  if (requested.length === 0) return new Map();

  const { data, error } = await supabase
    .from("org_entitlements")
    .select("feature_key, enabled")
    .eq("org_id", orgId)
    .in("feature_key", requested);

  if (error) {
    throw new EntitlementReadError(error.code ?? "entitlement_error", error);
  }

  const states = new Map(requested.map((feature) => [feature, false]));
  for (const candidate of data ?? []) {
    const row = candidate as EntitlementRow;
    if (
      typeof row.feature_key === "string" &&
      typeof row.enabled === "boolean" &&
      states.has(row.feature_key)
    ) {
      states.set(row.feature_key, row.enabled);
    }
  }
  return states;
}

export async function getFeatureStatesForOrg(
  orgId: string,
  featureKeys: readonly string[],
): Promise<Map<string, boolean>> {
  const requested = uniqueFeatures(featureKeys);
  if (!hasSupabaseEnv()) {
    const repo = getRepo();
    return new Map(
      requested.map((feature) => [
        feature,
        repo.isFeatureEnabled(orgId, feature),
      ]),
    );
  }
  return readSupabaseFeatureStates(await createClient(), orgId, requested);
}

/** 현재 컨텍스트(조직)에서 기능이 켜져 있는가. */
export async function isEnabled(
  ctx: Ctx,
  featureKey: string,
): Promise<boolean> {
  return isEnabledForOrg(ctx.org.id, featureKey);
}

/** 조직 id 로 직접 검사(세션 밖에서 쓸 때). */
export async function isEnabledForOrg(
  orgId: string,
  featureKey: string,
): Promise<boolean> {
  return (await getFeatureStatesForOrg(orgId, [featureKey])).get(featureKey) ??
    false;
}

export async function getLockedFeaturesForOrg(
  orgId: string,
  featureKeys: readonly string[],
): Promise<string[]> {
  const requested = uniqueFeatures(featureKeys);
  const states = await getFeatureStatesForOrg(orgId, requested);
  return requested.filter((feature) => !states.get(feature));
}
