import { describe, expect, it } from "vitest";
import { resolveActiveNavKey } from "@/components/shell/active-nav";
import {
  accentForNavKey,
  APPEARANCE_DEFAULT,
  APPEARANCE_PRESET_IDS,
  isAppearanceEffects,
  isAppearancePresetId,
  parseAppearancePreference,
  parseAppearanceStorageText,
  resolveRouteAccent,
  ROUTE_CTA,
  serializeAppearancePreference,
  UNWIRED_PALETTE,
} from "./vivid";

const BASE = "/w/acme";
const CANDIDATES = [
  { key: "dash", href: BASE },
  { key: "new", href: `${BASE}/newcust` },
  { key: "contact", href: `${BASE}/contract` },
  { key: "work", href: `${BASE}/work` },
  { key: "company", href: `${BASE}/companies` },
];

function accentForPath(pathname: string, boardNavKeys?: Record<string, string>): string {
  const active = resolveActiveNavKey(pathname, CANDIDATES, { basePath: BASE, boardNavKeys });
  return resolveRouteAccent(active);
}

describe("v17 라우트 강조 매핑", () => {
  it("실제 운영 라우트 5종이 각자의 강조로 간다", () => {
    expect(accentForNavKey("new")).toBe("new");
    expect(accentForNavKey("contact")).toBe("contact");
    expect(accentForNavKey("consult-remote")).toBe("contact");
    expect(accentForNavKey("consult-inperson")).toBe("inperson");
    expect(accentForNavKey("work")).toBe("work");
    expect(accentForNavKey("company")).toBe("company");
    expect(accentForNavKey("dash")).toBe("dash");
  });

  it("파트너·벤더·모르는 키는 강조 없음 — 미구현 메뉴를 덮지 않는다", () => {
    expect(accentForNavKey("vendor")).toBeNull();
    expect(accentForNavKey("addons")).toBeNull();
    expect(accentForNavKey("partners")).toBeNull();
    expect(accentForNavKey("s3")).toBeNull();
    expect(accentForNavKey(null)).toBeNull();
    expect(accentForNavKey(undefined)).toBeNull();
  });

  it("보드 주소는 지도로 탭을 되찾는다 — 경유지 탭 이름이 주소에 없어도 된다", () => {
    expect(accentForPath(`${BASE}/boards/b-work`, { "b-work": "work" })).toBe("work");
    expect(accentForPath(`${BASE}/boards/b-new`, { "b-new": "new" })).toBe("new");
    expect(accentForPath(`${BASE}/boards/b-contact`, { "b-contact": "contact" })).toBe("contact");
  });

  it("모르는 보드는 대시보드 강조로 폴백 — 엉뚱한 탭 잔상을 남기지 않는다", () => {
    expect(accentForPath(`${BASE}/boards/b-unknown`, { "b-work": "work" })).toBe("dash");
    expect(accentForPath(`${BASE}/boards/b-unknown`)).toBe("dash");
  });

  it("일반 주소도 같은 판정으로 강조가 따라간다", () => {
    expect(accentForPath(`${BASE}/newcust`)).toBe("new");
    expect(accentForPath(`${BASE}/contract`)).toBe("contact");
    expect(accentForPath(`${BASE}/work`)).toBe("work");
    expect(accentForPath(`${BASE}/companies`)).toBe("company");
    expect(accentForPath(BASE)).toBe("dash");
  });
});

describe("v17 CTA 정본 값", () => {
  it("파랑/보라 계열은 Canva 블루→바이올렛 + 흰 글자", () => {
    for (const key of ["contact", "dash"]) {
      expect(ROUTE_CTA[key].grad).toContain("#3969e7");
      expect(ROUTE_CTA[key].grad).toContain("#7d2ae7");
      expect(ROUTE_CTA[key].ink).toBe("#ffffff");
    }
  });

  it("밝은 CTA는 원천 Soft UI 쌍 + #111827 글자", () => {
    expect(ROUTE_CTA.new.grad).toContain("#ea580c");
    expect(ROUTE_CTA.new.grad).toContain("#facc15");
    expect(ROUTE_CTA.work.grad).toContain("#22c55e");
    expect(ROUTE_CTA.work.grad).toContain("#98ec2d");
    expect(ROUTE_CTA.company.grad).toContain("#0ea5e9");
    expect(ROUTE_CTA.company.grad).toContain("#06b6d4");
    for (const key of ["new", "work", "company"]) {
      expect(ROUTE_CTA[key].ink).toBe("#111827");
    }
  });

  it("소비용 팔레트는 정의만 — 파트너는 제외 사유를 남긴다", () => {
    expect(UNWIRED_PALETTE.partners.grad).toContain("#7d2ae7");
    expect(UNWIRED_PALETTE.partners.reason).toMatch(/제외/);
    expect(UNWIRED_PALETTE.s3rose).toBeUndefined();
    expect(ROUTE_CTA.inperson).toEqual({
      grad: "linear-gradient(310deg, #ef4444 0%, #ec4899 100%)", solid: "#ef4444", ink: "#111827",
    });
  });
});

describe("v17 외관 설정 검증", () => {
  it("목업 호환 프리셋 10종이 그대로다", () => {
    expect(APPEARANCE_PRESET_IDS).toHaveLength(10);
    for (const id of ["signal", "lagoon", "graphite", "forest", "alloy", "orchid", "arctic", "aurora", "coral", "amber"]) {
      expect(isAppearancePresetId(id)).toBe(true);
    }
  });

  it("깨진 값은 기본값으로 닫고 던지지 않는다", () => {
    expect(parseAppearancePreference(null)).toEqual(APPEARANCE_DEFAULT);
    expect(parseAppearancePreference({ preset: "evil", effects: "sometimes" })).toEqual(APPEARANCE_DEFAULT);
    expect(parseAppearancePreference({ preset: "coral" })).toEqual({ preset: "coral", effects: "on" });
    expect(parseAppearancePreference({ preset: "coral", effects: "off" })).toEqual({ preset: "coral", effects: "off" });
    expect(isAppearanceEffects("off")).toBe(true);
    expect(isAppearanceEffects("dim")).toBe(false);
  });

  it("저장 텍스트 파싱 — 깨진 JSON도 기본값", () => {
    expect(parseAppearanceStorageText(null)).toEqual(APPEARANCE_DEFAULT);
    expect(parseAppearanceStorageText("not-json{")).toEqual(APPEARANCE_DEFAULT);
    expect(parseAppearanceStorageText(JSON.stringify({ preset: "aurora", effects: "off" }))).toEqual({
      preset: "aurora",
      effects: "off",
    });
  });

  it("직렬화는 검증된 값만 내놓는다", () => {
    expect(JSON.parse(serializeAppearancePreference({ preset: "aurora", effects: "off" }))).toEqual({
      preset: "aurora",
      effects: "off",
    });
  });
});
