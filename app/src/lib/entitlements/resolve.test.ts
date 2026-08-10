import { describe, expect, it } from "vitest";
import { isFeatureOn, lockedFeatures, type EntitlementRow } from "./resolve";
import { FEATURES, MVP_ENABLED_FEATURES } from "@/lib/product";

const NOW = new Date("2026-07-29T00:00:00Z");

describe("isFeatureOn — 기본값(PLAN v0.2 §5)", () => {
  it("MVP 기능은 행이 없어도 켜져 있다", () => {
    // P0 회귀 가드: 조직 생성 시 엔타이틀먼트 행을 못 만든 조직(현 Supabase 경로)이
    // 전 메뉴 잠김이 되던 버그. 행이 없다 = 기본값이지 잠금이 아니다.
    for (const key of MVP_ENABLED_FEATURES) {
      expect(isFeatureOn(key, [], NOW)).toBe(true);
    }
  });

  it("비-MVP(Phase 2) 기능은 행이 없으면 꺼져 있다", () => {
    expect(isFeatureOn(FEATURES.notify, [], NOW)).toBe(false);
    expect(isFeatureOn(FEATURES.hometax, [], NOW)).toBe(false);
  });

  it("알 수 없는 기능키는 꺼짐으로 수렴한다", () => {
    expect(isFeatureOn("mod.unknown", [], NOW)).toBe(false);
  });
});

describe("isFeatureOn — DB 행은 기본값을 뒤집는 오버라이드", () => {
  it("MVP 기능도 enabled=false 행이 있으면 잠긴다", () => {
    const rows: EntitlementRow[] = [
      { feature_key: FEATURES.dash, enabled: false },
    ];
    expect(isFeatureOn(FEATURES.dash, rows, NOW)).toBe(false);
  });

  it("비-MVP 기능은 enabled=true 행이 있으면 열린다", () => {
    const rows: EntitlementRow[] = [
      { feature_key: FEATURES.notify, enabled: true },
    ];
    expect(isFeatureOn(FEATURES.notify, rows, NOW)).toBe(true);
  });

  it("다른 기능의 행은 영향을 주지 않는다", () => {
    const rows: EntitlementRow[] = [
      { feature_key: FEATURES.notify, enabled: true },
    ];
    expect(isFeatureOn(FEATURES.dash, rows, NOW)).toBe(true);
  });
});

describe("isFeatureOn — 만료", () => {
  it("만료된 행은 무시되고 기본값으로 돌아간다", () => {
    const expired: EntitlementRow[] = [
      {
        feature_key: FEATURES.notify,
        enabled: true,
        expires_at: "2026-07-01T00:00:00Z",
      },
    ];
    // 비-MVP 라 기본값 OFF 로 복귀.
    expect(isFeatureOn(FEATURES.notify, expired, NOW)).toBe(false);

    const expiredOff: EntitlementRow[] = [
      {
        feature_key: FEATURES.dash,
        enabled: false,
        expires_at: "2026-07-01T00:00:00Z",
      },
    ];
    // MVP 라 기본값 ON 으로 복귀.
    expect(isFeatureOn(FEATURES.dash, expiredOff, NOW)).toBe(true);
  });

  it("미래 만료는 유효하다", () => {
    const rows: EntitlementRow[] = [
      {
        feature_key: FEATURES.notify,
        enabled: true,
        expires_at: "2026-12-31T00:00:00Z",
      },
    ];
    expect(isFeatureOn(FEATURES.notify, rows, NOW)).toBe(true);
  });

  it("expires_at 이 null/깨진 값이면 무기한으로 본다", () => {
    // 값이 깨졌다고 기능을 끄면 장애가 번진다 — 관대하게 유지.
    expect(
      isFeatureOn(FEATURES.notify, [
        { feature_key: FEATURES.notify, enabled: true, expires_at: null },
      ], NOW),
    ).toBe(true);
    expect(
      isFeatureOn(FEATURES.notify, [
        { feature_key: FEATURES.notify, enabled: true, expires_at: "쓰레기값" },
      ], NOW),
    ).toBe(true);
  });
});

describe("lockedFeatures", () => {
  it("행이 하나도 없으면 비-MVP 만 잠긴다", () => {
    const features = [FEATURES.dash, FEATURES.crm, FEATURES.notify];
    expect(lockedFeatures(features, [], NOW)).toEqual([FEATURES.notify]);
  });

  it("빈 기능 목록은 빈 결과", () => {
    expect(lockedFeatures([], [], NOW)).toEqual([]);
  });
});
