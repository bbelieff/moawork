import { MVP_ENABLED_FEATURES } from "@/lib/product";

/**
 * 기능 잠금 판정 — **순수 로직**(DB 접근 없음. 서버 조회는 server.ts 가 맡는다).
 *
 * ── 왜 이 모듈이 필요한가 (P0: 사이드바 전 메뉴 잠김) ──
 * 셸은 원래 `getRepo().isFeatureEnabled(ctx.org.id, key)` 로 잠금을 판정했다.
 * 그런데 `getRepo()` 는 환경과 무관하게 **항상 LocalRepo(인메모리 시드)** 를 돌려준다.
 * 프로덕션에서 `ctx.org.id` 는 Supabase 의 실제 UUID 라 그 인메모리 스토어에 존재하지
 * 않고, 결과적으로 **모든 feature 가 false → 전 메뉴 잠김**이 된다.
 * (belie 가 자기 회사에서 아무 메뉴도 못 열던 증상이 이것이다.)
 *
 * ── 판정 규칙 (PLAN v0.2 §5) ──
 * "MVP: 모든 플랜에 core.* + MVP 모듈 무료" 가 제품 규약이다. 따라서
 *   - **MVP 기능**: 기본 ON. `org_entitlements` 에 `enabled=false` 행이 **명시**됐을 때만 OFF.
 *   - **비-MVP(Phase 2 벤더 모듈 등)**: 기본 OFF. 행이 `enabled=true` 일 때만 ON.
 * 즉 DB 행은 "기본값을 뒤집는 오버라이드"로 쓰고, 행이 없다고 무료 기능이 잠기지 않는다.
 * 이렇게 하면 조직 생성 시 엔타이틀먼트 행을 만들지 못한 조직(현 Supabase 경로)도
 * MVP 범위는 정상 동작한다.
 *
 * ── 만료 ──
 * `expires_at` 이 지난 행은 없는 것으로 본다(→ 해당 기능은 기본값으로 되돌아간다).
 */

export type EntitlementRow = {
  feature_key: string;
  enabled: boolean;
  expires_at?: string | null;
};

const MVP = new Set(MVP_ENABLED_FEATURES);

/** 만료됐으면 true. `expires_at` 이 비어 있으면 무기한(만료 아님). */
function isExpired(row: EntitlementRow, now: Date): boolean {
  if (!row.expires_at) return false;
  const at = Date.parse(row.expires_at);
  // 파싱 불가한 값은 무기한으로 취급한다 — 값이 깨졌다고 기능을 끄면 장애가 번진다.
  return Number.isFinite(at) && at <= now.getTime();
}

/** 기능 하나의 최종 ON/OFF. */
export function isFeatureOn(
  featureKey: string,
  rows: readonly EntitlementRow[],
  now: Date = new Date(),
): boolean {
  const row = rows.find(
    (r) => r.feature_key === featureKey && !isExpired(r, now),
  );
  if (row) return row.enabled;
  return MVP.has(featureKey);
}

/** 주어진 기능들 중 **잠긴** 것만. 셸 사이드바가 그대로 소비한다. */
export function lockedFeatures(
  features: readonly string[],
  rows: readonly EntitlementRow[],
  now: Date = new Date(),
): string[] {
  return features.filter((f) => !isFeatureOn(f, rows, now));
}
