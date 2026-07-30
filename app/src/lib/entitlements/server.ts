import "server-only";

import { getRepo } from "@/lib/repo";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { type EntitlementRow, lockedFeatures } from "./resolve";

/**
 * 조직의 잠긴 기능 목록 — 셸(사이드바)이 소비한다.
 *
 * Supabase 가 설정돼 있으면 **실 DB `org_entitlements`** 를 읽고, 아니면 로컬 개발
 * 저장소(LocalRepo)를 읽는다. 판정 규칙 자체는 `resolve.ts` 의 순수 함수가 소유한다
 * (기본값·만료 규칙은 그쪽 주석 참고).
 *
 * 조회가 실패해도 **화면을 잠그지 않는다**. 엔타이틀먼트는 과금·노출 제어일 뿐
 * 보안 경계가 아니고(진짜 경계는 RLS), 조회 실패로 전 메뉴가 잠기면 그게 곧 장애다.
 * → 실패 시 기본값(MVP 무료)으로 수렴한다.
 */
export async function loadLockedFeatures(
  orgId: string,
  features: readonly string[],
): Promise<string[]> {
  if (!hasSupabaseEnv()) {
    // 로컬 개발: 인메모리 시드가 진실.
    const repo = getRepo();
    return features.filter((f) => !repo.isFeatureEnabled(orgId, f));
  }

  let rows: EntitlementRow[] = [];
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("org_entitlements")
      .select("feature_key, enabled, expires_at")
      .eq("org_id", orgId);
    if (!error && data) rows = data as EntitlementRow[];
  } catch {
    // 네트워크·권한 실패 → 기본값으로 수렴(위 주석 참고).
  }

  return lockedFeatures(features, rows);
}
