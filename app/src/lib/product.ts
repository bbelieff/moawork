// 제품 상수 — PLAN-v0.2 §DI-2: 제품명은 코드 전역에서 이 상수 하나로만 참조한다.
// 교체 시 이 한 줄만 바꾼다(가칭 "모아워크").
export const PRODUCT_NAME = "모아워크" as const;

// 기능 키(엔타이틀먼트) — 001_schema_v1.sql 의 feature_key 와 일치.
export const FEATURES = {
  crm: "core.crm",
  custom: "core.custom",
  org: "core.org",
  files: "core.files",
  dash: "core.dash",
  policyfund: "ind.policyfund",
  // Phase 2 (벤더) — MVP entitlement OFF
  hometax: "mod.hometax",
  notify: "mod.notify",
  // Phase 1.5 (벤더불요) — MVP 기본 미포함
  perf: "mod.perf",
} as const;

export type FeatureKey = (typeof FEATURES)[keyof typeof FEATURES];

// MVP(먼데이 파리티)에서 기본 ON 인 기능(001 plan_features 와 동일 집합).
export const MVP_ENABLED_FEATURES: readonly string[] = [
  FEATURES.crm,
  FEATURES.custom,
  FEATURES.org,
  FEATURES.files,
  FEATURES.dash,
  FEATURES.policyfund,
];
