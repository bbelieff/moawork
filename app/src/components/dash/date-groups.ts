// 대시보드 날짜 묶음(순수 · 조회 없음) — 2026-10-09 대시보드 시각 1차.
//
// 날짜는 전부 KST «YYYY-MM-DD» 문자열이다(read model 이 그렇게 준다). 문자열 비교로 순서를 정하고,
// 날짜 계산은 aggregate.ts 의 KST 도우미를 그대로 쓴다 — 시간대 계산을 여기서 새로 만들지 않는다.
// 주는 월요일에 시작해 일요일에 끝난다.

import { addDaysKst } from "@/lib/dash/aggregate";

/** 0=월 … 6=일. */
function weekdayMonFirst(dateKst: string): number {
  const [y, m, d] = dateKst.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** 그 날짜가 든 주의 일요일. */
export function endOfWeekKst(dateKst: string): string {
  return addDaysKst(dateKst, 6 - weekdayMonFirst(dateKst));
}

/** 두 날짜 사이 일수(b - a). */
export function daysBetweenKst(a: string, b: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** D-day 배지 — 남으면 D-3, 오늘이면 D-day, 지났으면 D+2. */
export function dDayLabel(dateKst: string, today: string): string {
  const diff = daysBetweenKst(today, dateKst);
  if (diff === 0) return "D-day";
  return diff > 0 ? `D-${diff}` : `D+${-diff}`;
}

export interface DateGroup<T> {
  key: string;
  label: string;
  items: T[];
}

/**
 * 「내 할 일」 — 오늘 / 내일 / 이번 주 / 그 뒤.
 * 기한이 지난 일은 «오늘» 묶음에 함께 둔다(오늘 처리할 일이다 — 배지가 「지남」으로 구분한다).
 * 빈 묶음은 돌려주지 않는다.
 */
export function groupByDue<T>(items: readonly T[], dueOf: (item: T) => string, today: string): DateGroup<T>[] {
  const tomorrow = addDaysKst(today, 1);
  const weekEnd = endOfWeekKst(today);
  const groups: DateGroup<T>[] = [
    { key: "today", label: "오늘", items: [] },
    { key: "tomorrow", label: "내일", items: [] },
    { key: "week", label: "이번 주", items: [] },
    { key: "later", label: "그 뒤", items: [] },
  ];
  for (const item of items) {
    const due = dueOf(item);
    if (due <= today) groups[0].items.push(item);
    else if (due === tomorrow) groups[1].items.push(item);
    else if (due <= weekEnd) groups[2].items.push(item);
    else groups[3].items.push(item);
  }
  return groups.filter((group) => group.items.length > 0);
}

/**
 * 재접촉 — 이번 주 / 다음 주 / 그 뒤 / 날짜 없음.
 * 이번 주보다 앞선(이미 지난) 날짜도 «이번 주» 에 둔다 — 지금 연락할 곳이다(배지가 D+n 으로 구분한다).
 * 묶음 안은 날짜 순. 빈 묶음은 돌려주지 않는다.
 */
export function groupByWeek<T>(
  items: readonly T[],
  dateOf: (item: T) => string | null,
  today: string,
): DateGroup<T>[] {
  const thisWeekEnd = endOfWeekKst(today);
  const nextWeekEnd = addDaysKst(thisWeekEnd, 7);
  const groups: DateGroup<T>[] = [
    { key: "this-week", label: "이번 주", items: [] },
    { key: "next-week", label: "다음 주", items: [] },
    { key: "later", label: "그 뒤", items: [] },
    { key: "undated", label: "날짜 없음", items: [] },
  ];
  const sorted = [...items].sort((a, b) => (dateOf(a) ?? "9999").localeCompare(dateOf(b) ?? "9999"));
  for (const item of sorted) {
    const date = dateOf(item);
    if (date === null) groups[3].items.push(item);
    else if (date <= thisWeekEnd) groups[0].items.push(item);
    else if (date <= nextWeekEnd) groups[1].items.push(item);
    else groups[2].items.push(item);
  }
  return groups.filter((group) => group.items.length > 0);
}
