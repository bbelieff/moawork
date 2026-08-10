import type { ReactNode } from "react";
import styles from "./view.module.css";

const WEEKDAY_LABEL = ["월", "화", "수", "목", "금", "토", "일"] as const;

/** 월요일 시작 요일 인덱스(0~6). `new Date().getDay()`는 일요일=0이라 보정한다. */
function mondayIndex(year: number, month1to12: number, day: number): number {
  const sundayIndex = new Date(year, month1to12 - 1, day).getDay();
  return (sundayIndex + 6) % 7;
}

function daysInMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

/**
 * 「캘린더」 시스템 뷰(D25) — 기준 날짜 컬럼으로 월 단위 그리드에 뿌린다.
 * 기준 컬럼 선택 자체(calendarFieldKey)는 저장된 뷰 값이고, 실제 값 추출은 호출부의 dateOf가 한다.
 */
export function CalendarView<T>({
  rows,
  dateOf,
  rowKey,
  renderItem,
  year,
  month,
}: {
  rows: readonly T[];
  /** ISO 날짜 문자열("YYYY-MM-DD") 또는 없으면 null. */
  dateOf: (row: T) => string | null;
  rowKey: (row: T) => string;
  renderItem: (row: T) => ReactNode;
  year: number;
  /** 1~12 */
  month: number;
}) {
  const total = daysInMonth(year, month);
  const leadIn = mondayIndex(year, month, 1);
  const cellCount = Math.ceil((leadIn + total) / 7) * 7;

  const byDay = new Map<number, T[]>();
  const unscheduled: T[] = [];
  for (const row of rows) {
    const iso = dateOf(row);
    const day = iso ? Number(iso.slice(8, 10)) : NaN;
    if (iso && iso.startsWith(`${year}-${String(month).padStart(2, "0")}`) && Number.isInteger(day)) {
      byDay.set(day, [...(byDay.get(day) ?? []), row]);
    } else {
      unscheduled.push(row);
    }
  }

  return (
    <div>
      <div className={styles.calGrid}>
        {WEEKDAY_LABEL.map((label) => (
          <div key={label} className={styles.calHead}>
            {label}
          </div>
        ))}
        {Array.from({ length: cellCount }, (_, i) => {
          const day = i - leadIn + 1;
          const inMonth = day >= 1 && day <= total;
          const items = inMonth ? (byDay.get(day) ?? []) : [];
          return (
            <div key={i} className={`${styles.calCell} ${inMonth ? "" : styles.out}`}>
              {inMonth ? <div className={styles.calDay}>{day}</div> : null}
              {items.map((row) => (
                <div key={rowKey(row)}>{renderItem(row)}</div>
              ))}
            </div>
          );
        })}
      </div>
      {unscheduled.length ? (
        <section aria-label="날짜 없음">
          <h3>날짜 없음</h3>
          {unscheduled.map((row) => (
            <div key={rowKey(row)}>{renderItem(row)}</div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
