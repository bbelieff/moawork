/**
 * 탭(보드) 아이콘 한 벌 — #845 대표 결정(2026-10-08, 승인 목업 「개선안」 Header 판).
 *
 * 색 칸·이모지 없이 같은 굵기의 선 아이콘 하나로 머리말(22px)·사이드바(16px)를 함께 그린다.
 * 그림은 24×24 격자의 stroke 경로이고 색은 쓰는 곳의 currentColor 를 따른다.
 *
 * 보드에 저장된 아이콘 값(`boards.icon`)은 세 갈래다.
 *   · 이 목록의 키(lead·phone …) — 새 아이콘 고르기가 저장하는 값. 그대로 쓴다.
 *   · 옛 이모지(💡·💰·🔁·📢 …) — 기본 탭 정의와 예전 입력칸이 남긴 값. 뜻이 같은 키로 바꿔 그린다.
 *   · 그 밖의 값·빈 값 — 탭 출처(source)로 정한다. 모르는 출처는 문서 아이콘.
 * 저장값은 바꾸지 않는다(그리는 쪽에서만 해석한다).
 *
 * 이 파일은 서버·클라이언트가 함께 읽는 순수 모듈이다 — 서버 전용 모듈을 import 하지 않는다.
 */

export const TAB_ICON_KEYS = [
  "lead",
  "phone",
  "video",
  "people",
  "case",
  "building",
  "receipt",
  "notice",
  "document",
  "calendar",
  "chart",
  "stamp",
  "money",
  "star",
  "flag",
  "check",
] as const;

export type TabIconKey = (typeof TAB_ICON_KEYS)[number];

/** 24×24 stroke 경로(채우기 없음). 승인 목업의 경로를 그대로 옮겼다. */
export const TAB_ICON_PATHS: Readonly<Record<TabIconKey, string>> = {
  lead: "M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M19 8v6M16 11h6",
  phone:
    "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z",
  video: "M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM22 8l-6 4 6 4V8z",
  people: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.1a4 4 0 0 1 0 7.8M22 21a7 7 0 0 0-5-6.7",
  case: "M5 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18",
  building: "M6 3h12a2 2 0 0 1 2 2v16H4V5a2 2 0 0 1 2-2zM9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10 21v-3h4v3",
  receipt: "M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6M9 16h3",
  notice: "M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1zM17 8a5 5 0 0 1 0 8",
  document: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  calendar: "M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3 10h18M8 3v4M16 3v4",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  stamp: "M12 3a4 4 0 0 1 2 7.5V13h4a2 2 0 0 1 2 2v2H4v-2a2 2 0 0 1 2-2h4v-2.5A4 4 0 0 1 12 3zM5 21h14",
  money: "M3 7h18v10H3zM9.5 12a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M6 10v4M18 10v4",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",
  flag: "M5 21V4M5 4h11l-2 4 2 4H5",
  check: "M4 12l5 5L20 6",
};

/** 아이콘 고르기·보조기기에 보일 쉬운 이름. */
export const TAB_ICON_LABELS: Readonly<Record<TabIconKey, string>> = {
  lead: "새 고객",
  phone: "전화",
  video: "화상 상담",
  people: "만남",
  case: "업무 가방",
  building: "회사",
  receipt: "영수증",
  notice: "공지",
  document: "문서",
  calendar: "달력",
  chart: "그래프",
  stamp: "도장",
  money: "돈",
  star: "별",
  flag: "깃발",
  check: "완료",
};

const TAB_ICON_KEY_SET: ReadonlySet<string> = new Set(TAB_ICON_KEYS);

export function isTabIconKey(value: unknown): value is TabIconKey {
  return typeof value === "string" && TAB_ICON_KEY_SET.has(value);
}

/**
 * 옛 저장값 → 아이콘 키. 기본 탭 정의의 이모지(💡 신규리드·💰 리드컨택·🔁 계약업체 실무·📢 공지)와
 * 예전 머리말이 알던 값(📞·📍), 예전 셸 아이콘 이름, 흔히 넣던 이모지를 뜻이 같은 그림으로 잇는다.
 * 이모지의 변형 선택자(U+FE0F)는 비교 전에 지운다.
 */
const LEGACY_ICON_KEYS: Readonly<Record<string, TabIconKey>> = {
  "💡": "lead",
  "🙋": "lead",
  "👤": "lead",
  "💰": "phone",
  "📞": "phone",
  "☎": "phone",
  "📱": "phone",
  "🎥": "video",
  "📹": "video",
  "💻": "video",
  "📍": "people",
  "👥": "people",
  "🤝": "people",
  "🔁": "case",
  "💼": "case",
  "🗂": "case",
  "🏢": "building",
  "🏭": "building",
  "🧾": "receipt",
  "📢": "notice",
  "📣": "notice",
  "🔔": "notice",
  "📄": "document",
  "📋": "document",
  "📝": "document",
  "📁": "document",
  "📅": "calendar",
  "📆": "calendar",
  "🗓": "calendar",
  "📊": "chart",
  "📈": "chart",
  "📉": "chart",
  "💵": "money",
  "💸": "money",
  "💳": "money",
  "🪙": "money",
  "⭐": "star",
  "🌟": "star",
  "🚩": "flag",
  "🏁": "flag",
  "✅": "check",
  "✔": "check",
  "☑": "check",
  // 예전 셸 스프라이트 이름(components/shell/icons.tsx) — 저장값으로 들어와도 같은 뜻으로.
  new: "lead",
  contact: "phone",
  meeting: "people",
  work: "case",
  company: "building",
  acct: "receipt",
};

/** 저장값이 없거나 모를 때 탭 출처(source)로 정하는 아이콘. 기본 탭 source 문자열과 같다. */
const SOURCE_ICON_KEYS: Readonly<Record<string, TabIconKey>> = {
  "core.default-tab/new-lead": "lead",
  "core.default-tab/contact": "phone",
  "core.default-tab/contract-work": "case",
  "core.default-tab/notice": "notice",
};

const FALLBACK_ICON_KEY: TabIconKey = "document";

/**
 * 저장된 아이콘 값과 탭 출처로 그릴 아이콘 키를 정한다.
 * 저장된 키 → 옛 이모지 → 출처 → 문서 순서다. 저장값은 바꾸지 않는다.
 */
export function resolveBoardIconKey(
  icon: string | null | undefined,
  source?: string | null,
): TabIconKey {
  const stored = typeof icon === "string" ? icon.trim() : "";
  if (isTabIconKey(stored)) return stored;
  if (stored) {
    const bare = stored.replace(/️/gu, "");
    if (Object.hasOwn(LEGACY_ICON_KEYS, bare)) return LEGACY_ICON_KEYS[bare];
  }
  if (source && Object.hasOwn(SOURCE_ICON_KEYS, source)) return SOURCE_ICON_KEYS[source];
  return FALLBACK_ICON_KEY;
}
