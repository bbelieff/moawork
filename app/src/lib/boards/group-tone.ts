/**
 * 2026-10-06 — 그룹 톤: 탭의 메인 2색 × 깊이 (#845 · 대표 지시 2026-10-06, 승인 방향 Palette.dc).
 *
 * 그룹 띠 색은 더 이상 그룹마다 임의 색(이관된 먼데이 색·id 해시 자동색)이 아니다. 탭마다
 * 두 개의 메인 색(그 탭 강조 그라디언트의 두 스톱)이 있고, 그룹은 «깊이» 로 구별한다.
 *
 *   · 축 A (색 1) = 본 진행. 단계가 나아갈수록 깊어진다(1 → 5).
 *   · 축 B (색 2) = 곁가지(인증·관리·보류·부재 같은 옆 길).
 *   · 축 S (회색) = 멈춘 상태(불가·거절·취소).
 *   · 같은 단계에 나란히 있는 그룹(예: 소진공 접수예정 넷)은 같은 깊이다.
 *   · 깊이는 색마다 최대 5단계다.
 *
 * 이 모듈은 «어느 축의 몇 단계인가» 만 정한다. 실제 색은 CSS 토큰이다 —
 * `--mw-tab-a-1..5`, `--mw-tab-b-1..5`, `--mw-tab-stop` (globals.css 기본값 +
 * moawork-vivid-v17.css 의 탭별 html[data-mw-accent] 값, 라이트·다크 각각).
 * 그래서 같은 그룹이 어느 탭에서 보이든 그 탭의 두 색으로 칠해진다.
 *
 * ★ 저장된 board_groups.color(먼데이에서 옮겨 온 색)는 지금은 쓰지 않는다. 사용자가 그룹 색을
 *   직접 고르는 기능(#839)이 들어오면 그 «명시 선택» 이 이 자동 톤을 덮는 override 가 된다.
 * ★ 표의 이름은 화면 이름 기준이다(앞머리 이모지·공백·뒤의 «(N)» 건수 표시는 무시).
 *   특정 고객의 이름이 아니라 기본 탭이 설치하는 그룹 이름과 상담 단계 이름이다.
 */

import { CONTRACT_WORK_TAB_SOURCE } from "@/lib/default-tabs/contract-work";
import { CONTACT_TAB_SOURCE, NEW_LEAD_TAB_SOURCE } from "@/lib/default-tabs/types";
import { presentLabel } from "./label-presentation";

export type GroupToneAxis = "A" | "B" | "S";
export type GroupToneLevel = 1 | 2 | 3 | 4 | 5;
export type GroupTone = Readonly<{ axis: GroupToneAxis; level: GroupToneLevel }>;

/** 톤을 정할 그룹 — 블록 키(그룹 id 또는 가상 묶음 키)와 화면 이름. */
export type GroupToneInput = Readonly<{ key: string; name: string }>;

const tone = (axis: GroupToneAxis, level: GroupToneLevel): GroupTone => ({ axis, level });
const STOP: GroupTone = tone("S", 1);

/** 표 대조용 키 — 앞머리 이모지를 걷고, 뒤의 «(3)» 같은 건수 표시와 모든 공백을 뺀다. */
export function groupToneKey(name: string): string {
  return presentLabel(name)
    .normalize("NFC")
    .replace(/\s*\(\d+\)\s*$/u, "")
    .replace(/\s+/gu, "");
}

type ToneRule = Readonly<{ match: (key: string) => boolean; tone: GroupTone }>;
type ToneTable = Readonly<{
  exact: Readonly<Record<string, GroupTone>>;
  patterns?: readonly ToneRule[];
  /** 표에 없는 그룹의 톤. 없으면 아래 규칙(멈춤·곁가지 낱말 → 순서)으로 정한다. */
  unknown?: GroupTone;
  /**
   * 그룹에 연결된 «대표 단계» id(이동 규칙의 option id — 바뀌지 않는 값) → 톤.
   * 단계 = 그룹으로 연결된 탭에서는 이름보다 이것을 먼저 본다. 대표가 띠 이름을
   * 바꿔도(예: 「승인」→「승인 완료」) 깊이와 단계 칩 색이 그대로 남는다.
   */
  stages?: Readonly<{ exact: Readonly<Record<string, GroupTone>>; patterns?: readonly ToneRule[] }>;
}>;

/**
 * 계약업체 실무 — 대표 지시(2026-10-06) 그대로.
 * 준비단계 → 진행중 → 소진공 접수예정(넷 모두 같은 깊이) → 심사 중 → 승인 이 본 진행,
 * 기업인증 진행 · 소공인(상생) · 관리중 · 해당연도 매출 · 업체관리 가 곁가지, 대출불가 가 멈춤.
 */
const CONTRACT_WORK_TONES: ToneTable = {
  exact: {
    준비단계: tone("A", 1),
    진행중: tone("A", 2),
    심사중: tone("A", 4),
    승인: tone("A", 5),
    기업인증진행: tone("B", 1),
    "소공인(상생)": tone("B", 2),
    관리중: tone("B", 3),
    해당연도매출: tone("B", 4),
    업체관리: tone("B", 5),
    대출불가: STOP,
  },
  patterns: [{ match: (key) => key.startsWith("소진공") && key.endsWith("접수예정"), tone: tone("A", 3) }],
  stages: {
    exact: {
      대기중: tone("A", 1),
      진행중: tone("A", 2),
      심사중: tone("A", 4),
      승인: tone("A", 5),
      기업인증진행: tone("B", 1),
      "소공인(상생)": tone("B", 2),
      관리중: tone("B", 3),
      해당연도매출: tone("B", 4),
      업체관리: tone("B", 5),
      불가: STOP,
    },
    patterns: [{ match: (key) => key.startsWith("소진공") && key.endsWith("대기"), tone: tone("A", 3) }],
  },
};

/**
 * 신규리드 — 물리 그룹(신규고객·2차 상담고객·1차 부재·보류·거절)과
 * 단계 보기의 가상 묶음(통화대기·부재·재통화·통화완료)을 같은 축에 둔다.
 */
const NEW_LEAD_TONES: ToneTable = {
  exact: {
    신규고객: tone("A", 1),
    통화대기: tone("A", 1),
    재통화: tone("A", 3),
    "2차상담고객": tone("A", 3),
    통화완료: tone("A", 5),
    "1차부재": tone("B", 2),
    부재: tone("B", 2),
    보류: tone("B", 4),
    거절: STOP,
  },
};

/**
 * 상담 관리 — 물리 그룹 + 상담 단계 보기(비대면·대면)의 가상 묶음.
 * 담당자 그룹은 회사마다 멤버 이름으로 바뀌므로(이름을 알 수 없다) 표에 없는 그룹은
 * 모두 «담당자 줄» 로 보고 같은 깊이(A3)에 둔다 — 담당자끼리는 나란한 줄이다.
 */
const CONTACT_TONES: ToneTable = {
  exact: {
    컨텍: tone("A", 1),
    정보수집: tone("A", 1),
    상담예정: tone("A", 2),
    대면상담예약: tone("A", 2),
    상담중: tone("A", 3),
    재상담: tone("A", 3),
    미팅완료: tone("A", 3),
    "1단계·계약금입금확인": tone("A", 4),
    "2단계·직인": tone("A", 4),
    계약확인완료: tone("A", 5),
    부재: tone("B", 1),
    "미팅보류": tone("B", 2),
    "미팅후고민중": tone("B", 3),
    보류: tone("B", 3),
    "계약보류(온/오프)": tone("B", 4),
    거절: STOP,
    미팅취소: STOP,
    계약취소: STOP,
  },
  patterns: [{ match: (key) => /^담당자\d*$/u.test(key), tone: tone("A", 3) }],
  unknown: tone("A", 3),
};

const TABLES: Readonly<Record<string, ToneTable>> = {
  [CONTRACT_WORK_TAB_SOURCE]: CONTRACT_WORK_TONES,
  [NEW_LEAD_TAB_SOURCE]: NEW_LEAD_TONES,
  [CONTACT_TAB_SOURCE]: CONTACT_TONES,
};

/** 멈춘 상태 — 불가·거절·취소·중단·해당 안 됨. */
const STOP_WORDS = /불가|거절|취소|중단|해당\s*안/u;
/** 곁가지 — 보류·부재·대기·고민. */
const SIDE_WORDS = /보류|부재|대기|고민/u;

/** 앞 낱말(공백 앞) — 두 글자 이상일 때만 «같은 묶음» 판정에 쓴다. */
function leadingToken(name: string): string | null {
  const first = presentLabel(name).trim().split(/\s+/u)[0] ?? "";
  return [...first].length >= 2 ? first : null;
}

/**
 * n 개의 자리를 깊이 1..5 에 고르게 편다 — 자리가 둘이면 1·5, 셋이면 1·3·5, 여섯 이상이면
 * 이웃한 자리가 같은 깊이를 나눠 쓴다(최대 5단계). 자리가 하나면 가운데(3).
 */
export function spreadLevel(position: number, slots: number): GroupToneLevel {
  if (slots <= 1) return 3;
  const level = 1 + Math.round((position * 4) / (slots - 1));
  return Math.min(5, Math.max(1, level)) as GroupToneLevel;
}

/**
 * 표가 없는 보드(또는 표에 없는 그룹)의 톤.
 *  · 멈춤 낱말 → S, 곁가지 낱말 → B, 나머지 → A.
 *  · 같은 축 안에서 순서대로 깊어진다.
 *  · 앞 낱말이 같은 그룹들(예: «소진공 …» 여럿)은 한 자리를 나눠 쓴다(같은 깊이).
 */
export function fallbackGroupTones(groups: readonly GroupToneInput[]): Map<string, GroupTone> {
  const result = new Map<string, GroupTone>();
  const lanes: Record<"A" | "B", { slotOf: Map<string, number>; slots: string[][] }> = {
    A: { slotOf: new Map(), slots: [] },
    B: { slotOf: new Map(), slots: [] },
  };
  const axisOf = (name: string): GroupToneAxis => {
    const plain = presentLabel(name);
    if (STOP_WORDS.test(plain)) return "S";
    if (SIDE_WORDS.test(plain)) return "B";
    return "A";
  };
  const classified = groups.map((group) => ({ group, axis: axisOf(group.name), token: leadingToken(group.name) }));
  const tokenCounts = new Map<string, number>();
  for (const { axis, token } of classified) {
    if (axis === "S" || !token) continue;
    const key = `${axis}\n${token}`;
    tokenCounts.set(key, (tokenCounts.get(key) ?? 0) + 1);
  }
  for (const { group, axis, token } of classified) {
    if (axis === "S") {
      result.set(group.key, STOP);
      continue;
    }
    const lane = lanes[axis];
    const familyKey = token && (tokenCounts.get(`${axis}\n${token}`) ?? 0) > 1 ? `family:${token}` : `group:${group.key}`;
    let slot = lane.slotOf.get(familyKey);
    if (slot === undefined) {
      slot = lane.slots.length;
      lane.slots.push([]);
      lane.slotOf.set(familyKey, slot);
    }
    lane.slots[slot].push(group.key);
  }
  for (const axis of ["A", "B"] as const) {
    const { slots } = lanes[axis];
    slots.forEach((keys, position) => {
      for (const key of keys) result.set(key, tone(axis, spreadLevel(position, slots.length)));
    });
  }
  return result;
}

function tableTone(table: ToneTable, name: string): GroupTone | null {
  const key = groupToneKey(name);
  const exact = Object.hasOwn(table.exact, key) ? table.exact[key] : undefined;
  if (exact) return exact;
  return table.patterns?.find((rule) => rule.match(key))?.tone ?? null;
}

function stageTone(table: ToneTable, stageId: string | null | undefined): GroupTone | null {
  if (!stageId || !table.stages) return null;
  const key = groupToneKey(stageId);
  const exact = Object.hasOwn(table.stages.exact, key) ? table.stages.exact[key] : undefined;
  if (exact) return exact;
  return table.stages.patterns?.find((rule) => rule.match(key))?.tone ?? null;
}

/** 기본 탭의 표에 «이름으로» 있는 톤만(낱말·순서 규칙은 쓰지 않는다). 표가 없으면 null. */
export function groupToneFromTable(source: string | null | undefined, name: string): GroupTone | null {
  const table = source ? TABLES[source] : undefined;
  return table ? tableTone(table, name) : null;
}

/**
 * 보드의 그룹들 → 블록 키별 톤. 기본 탭(계약업체 실무·신규리드·상담 관리)은 표로,
 * 그 밖의 보드와 표에 없는 그룹은 낱말·순서 규칙으로 정한다. 순수 함수다.
 */
export function resolveGroupTones(
  source: string | null | undefined,
  groups: readonly GroupToneInput[],
  /** 블록 키 → 연결된 대표 단계 id(이동 규칙 역조회). 있으면 이름보다 먼저 쓴다. */
  stageByGroup?: ReadonlyMap<string, string>,
): Map<string, GroupTone> {
  const table = source ? TABLES[source] : undefined;
  if (!table) return fallbackGroupTones(groups);
  const result = new Map<string, GroupTone>();
  const unknown: GroupToneInput[] = [];
  for (const group of groups) {
    const known = stageTone(table, stageByGroup?.get(group.key)) ?? tableTone(table, group.name);
    if (known) result.set(group.key, known);
    else if (table.unknown) result.set(group.key, table.unknown);
    else unknown.push(group);
  }
  for (const [key, value] of fallbackGroupTones(unknown)) result.set(key, value);
  return result;
}

/** 톤 → 그 탭의 색 토큰(CSS). 톤이 없으면(«그룹 없음» 묶음) 중립 보조색. */
export function groupToneAccent(value: GroupTone | null | undefined): string {
  if (!value) return "var(--mw-sub)";
  if (value.axis === "S") return "var(--mw-tab-stop)";
  return `var(--mw-tab-${value.axis.toLowerCase()}-${value.level})`;
}

/** 화면 표식용 짧은 이름 — A3 · B1 · S. */
export function groupToneLabel(value: GroupTone | null | undefined): string | null {
  if (!value) return null;
  return value.axis === "S" ? "S" : `${value.axis}${value.level}`;
}
