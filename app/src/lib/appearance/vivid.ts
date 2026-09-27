/**
 * v17 vivid 외관 — 순수 매핑·검증 모듈(서버/클라이언트 공용, DOM·IO 없음).
 *
 * - 라우트 강조(accent)는 실제 운영 라우트에만 배선한다: new→/newcust,
 *   contact→/contract, work→/work, company→/companies, dash→루트.
 *   상담 STEP2는 contact의 블루바이올렛, STEP3는 승인된 s3 로즈를 쓴다.
 * - 10개 회사 프리셋 id는 검토 목업(v17-reference theme-presets.*)과 source-compatible
 *   하게 유지한다. 값(그라디언트 스톱)은 아래 출처의 실측값이다.
 * - 본인 외관 설정만 다루며 업무 데이터·워크스페이스 상태는 절대 만지지 않는다.
 */

/** 검토 목업과 호환되는 회사 프리셋 id 10종(저장·API 호환용, 값은 출처 실측). */
export const APPEARANCE_PRESET_IDS = [
  "signal",
  "lagoon",
  "graphite",
  "forest",
  "alloy",
  "orchid",
  "arctic",
  "aurora",
  "coral",
  "amber",
] as const;

export type AppearancePresetId = (typeof APPEARANCE_PRESET_IDS)[number];

/**
 * 프리셋별 그라디언트(아바타 테두리·스와치용).
 * copied = 원천 정의 그대로, adapted = 스톱은 원천 실측·배치는 모아워크 조합.
 * - Soft UI Dashboard (Creative Tim, MIT): 310deg 쌍
 *   primary #ea580c→#facc15, info #0ea5e9→#06b6d4, success #22c55e→#98ec2d,
 *   warning #eab308→#f97316, danger #ef4444→#ec4899 (2026-09-25 실측).
 * - Mobbin Canva 팔레트: #07b9ce #3969e7 #7d2ae7 (2026-09-25 확인).
 */
export const APPEARANCE_PRESET_GRADS: Readonly<Record<AppearancePresetId, { grad: string; kind: "copied" | "adapted" }>> = {
  signal: { grad: "linear-gradient(310deg, #ef4444 0%, #ec4899 100%)", kind: "copied" },
  lagoon: { grad: "linear-gradient(310deg, #22c55e 0%, #98ec2d 100%)", kind: "copied" },
  graphite: { grad: "linear-gradient(310deg, #7d2ae7 0%, #3969e7 100%)", kind: "adapted" },
  forest: { grad: "linear-gradient(310deg, #22c55e 0%, #07b9ce 100%)", kind: "adapted" },
  alloy: { grad: "linear-gradient(310deg, #0ea5e9 0%, #06b6d4 100%)", kind: "copied" },
  orchid: { grad: "linear-gradient(310deg, #7d2ae7 0%, #ec4899 100%)", kind: "adapted" },
  arctic: { grad: "linear-gradient(310deg, #07b9ce 0%, #06b6d4 100%)", kind: "adapted" },
  aurora: { grad: "linear-gradient(310deg, #3969e7 0%, #7d2ae7 100%)", kind: "adapted" },
  coral: { grad: "linear-gradient(310deg, #ea580c 0%, #facc15 100%)", kind: "copied" },
  amber: { grad: "linear-gradient(310deg, #eab308 0%, #f97316 100%)", kind: "copied" },
};

/** 실제 운영 nav key → v17 강조 계열. 파트너·벤더는 제외(미구현 메뉴는 덮지 않음). */
export const ROUTE_ACCENT_FOR_NAV_KEY: Readonly<Record<string, string>> = {
  new: "new",
  contact: "contact",
  "consult-remote": "contact",
  "consult-inperson": "inperson",
  work: "work",
  company: "company",
  dash: "dash",
  "policy-news": "news",
};

/**
 * 실제 CTA 채움 동작(vivid-v17.css 최종 절이 정본).
 * 파랑/보라 계열(contact·dash)은 Canva 블루→바이올렛(#3969e7→#7d2ae7) + 흰 글자,
 * 그 외 밝은 CTA는 원천 Soft UI 쌍 + #111827 글자.
 */
export const ROUTE_CTA: Readonly<Record<string, { grad: string; solid: string; ink: string }>> = {
  new: { grad: "linear-gradient(310deg, #ea580c 0%, #facc15 100%)", solid: "#ea580c", ink: "#111827" },
  contact: { grad: "linear-gradient(110deg, #3969e7 0%, #7d2ae7 100%)", solid: "#3969e7", ink: "#ffffff" },
  inperson: { grad: "linear-gradient(310deg, #ef4444 0%, #ec4899 100%)", solid: "#ef4444", ink: "#111827" },
  work: { grad: "linear-gradient(310deg, #22c55e 0%, #98ec2d 100%)", solid: "#22c55e", ink: "#111827" },
  company: { grad: "linear-gradient(310deg, #0ea5e9 0%, #06b6d4 100%)", solid: "#0ea5e9", ink: "#111827" },
  dash: { grad: "linear-gradient(110deg, #3969e7 0%, #7d2ae7 100%)", solid: "#3969e7", ink: "#ffffff" },
  news: { grad: "linear-gradient(310deg, #07b9ce 0%, #06b6d4 100%)", solid: "#07b9ce", ink: "#111827" },
};

/**
 * 소비되지 않은 팔레트 토큰(정의만 두고 실제 라우트에 배선하지 않음).
 * honey·partners는 대응 운영 탭이 없어 미배선으로 남긴다.
 */
export const UNWIRED_PALETTE: Readonly<Record<string, { grad: string; reason: string }>> = {
  honey: { grad: "linear-gradient(310deg, #eab308 0%, #f97316 100%)", reason: "대응 운영 탭 없음 — 토큰만 정의" },
  partners: { grad: "linear-gradient(310deg, #7d2ae7 0%, #3969e7 100%)", reason: "파트너 기능 제외(사용자 지시) — 미배선" },
};

/** nav key → 강조. 모르는 키·미구현 메뉴는 null(호출부가 dash 폴백). */
export function accentForNavKey(navKey: string | null | undefined): string | null {
  if (!navKey) return null;
  return ROUTE_ACCENT_FOR_NAV_KEY[navKey] ?? null;
}

/** 최종 강조 — null이면 대시보드(브랜드) 강조로 폴백, 엉뚱한 탭 잔상 없음. */
export function resolveRouteAccent(navKey: string | null | undefined): string {
  return accentForNavKey(navKey) ?? "dash";
}

/** 프리셋별 단색(아바타 링·효과 끔 폴백용, 목업 roles.action 실측값). */
export const APPEARANCE_PRESET_SOLID: Readonly<Record<AppearancePresetId, string>> = {
  signal: "#ef4444",
  lagoon: "#22c55e",
  graphite: "#7d2ae7",
  forest: "#16a34a",
  alloy: "#0ea5e9",
  orchid: "#ec4899",
  arctic: "#06b6d4",
  aurora: "#3969e7",
  coral: "#ea580c",
  amber: "#eab308",
};

export const APPEARANCE_STORAGE_KEY = "mw-appearance-v1";
export const APPEARANCE_DEFAULT_PRESET: AppearancePresetId = "signal";
export type AppearanceEffects = "on" | "off";

export type AppearancePreference = {
  preset: AppearancePresetId;
  effects: AppearanceEffects;
};

export const APPEARANCE_DEFAULT: AppearancePreference = {
  preset: APPEARANCE_DEFAULT_PRESET,
  effects: "on",
};

export function isAppearancePresetId(value: unknown): value is AppearancePresetId {
  return typeof value === "string" && (APPEARANCE_PRESET_IDS as readonly string[]).includes(value);
}

export function isAppearanceEffects(value: unknown): value is AppearanceEffects {
  return value === "on" || value === "off";
}

/** 저장값 검증 — 깨진 값은 기본값으로 닫는다(던지지 않음, 업무 데이터 무관). */
export function parseAppearancePreference(raw: unknown): AppearancePreference {
  if (!raw || typeof raw !== "object") return { ...APPEARANCE_DEFAULT };
  const record = raw as Record<string, unknown>;
  return {
    preset: isAppearancePresetId(record.preset) ? record.preset : APPEARANCE_DEFAULT_PRESET,
    effects: isAppearanceEffects(record.effects) ? record.effects : "on",
  };
}

export function parseAppearanceStorageText(text: string | null | undefined): AppearancePreference {
  if (!text) return { ...APPEARANCE_DEFAULT };
  try {
    return parseAppearancePreference(JSON.parse(text));
  } catch {
    return { ...APPEARANCE_DEFAULT };
  }
}

export function serializeAppearancePreference(pref: AppearancePreference): string {
  return JSON.stringify(parseAppearancePreference(pref));
}
