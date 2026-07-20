/** 날짜를 `YYYY-MM-DD` 형식 문자열로 변환한다. */
export function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}
