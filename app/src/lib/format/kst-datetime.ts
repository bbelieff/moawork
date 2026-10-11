/**
 * 일시·날짜를 한국 시각(KST, UTC+9, 서머타임 없음)으로 다룬다 — QA #886.
 *
 * 저장값은 ISO 순간(…Z)이다. 표·상세 패널은 그것을 세계 표준시 그대로 잘라 보여 줘서
 * 상담 패널(14:00)과 표(05:00)가 9시간 어긋났다. 입력칸이 보내는 «시간대 없는» 일시는
 * 서버가 자기 시간대로 읽어 저장 시각이 밀릴 수 있었다. 고객은 한국 회사라 화면·입력 모두 KST 로 맞춘다.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const NAIVE_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/;

/** ISO 순간 → datetime-local 입력칸 값(KST, YYYY-MM-DDTHH:mm). 읽을 수 없으면 앞 16자. */
export function kstDateTimeLocal(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 16);
  return new Date(parsed.getTime() + KST_OFFSET_MS).toISOString().slice(0, 16);
}

/** ISO 순간 → 읽기용 «YYYY-MM-DD HH:mm» (KST). */
export function kstDateTimeText(value: string): string {
  const local = kstDateTimeLocal(value);
  return local.includes("T") ? local.replace("T", " ") : local;
}

/**
 * 입력 일시 → 저장할 순간. 시간대가 없는 «YYYY-MM-DDTHH:mm» 은 한국 시각으로 읽는다.
 * 시간대가 붙은 값(Z, +09:00 등)은 그대로 읽는다. 읽을 수 없으면 null.
 */
export function parseKstDateTime(input: string): Date | null {
  const text = input.trim();
  const parsed = new Date(NAIVE_LOCAL.test(text) ? `${text}+09:00` : text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** KST 기준 오늘 날짜(YYYY-MM-DD). */
export function kstToday(now: Date = new Date()): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}
