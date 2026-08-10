import type { DateReminderSource, ReminderJob } from "./types.js";

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`잘못된 날짜: ${value}`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`잘못된 날짜: ${value}`);
  return parsed;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function reminderDate(dueDate: string, daysBefore: number): string {
  if (!Number.isInteger(daysBefore) || daysBefore < 0) throw new Error("알림 선행 일수는 0 이상의 정수여야 합니다.");
  const date = parseDate(dueDate);
  date.setUTCDate(date.getUTCDate() - daysBefore);
  return formatDate(date);
}

export function buildReminderJob(source: DateReminderSource): ReminderJob {
  const recipientIds = [...new Set([source.assigneeId, source.supervisorId].filter((id): id is string => Boolean(id)))];
  if (recipientIds.length === 0) throw new Error("알림 받을 담당자가 없습니다.");
  const notifyOn = reminderDate(source.dueDate, source.daysBefore);
  return {
    key: `${source.kind}:${source.sourceId}:${source.dueDate}:${source.daysBefore}`,
    kind: source.kind,
    sourceId: source.sourceId,
    companyId: source.companyId,
    dueDate: source.dueDate,
    notifyOn,
    recipientIds,
  };
}

/** 오늘 발송할 후보만 뽑고 동일 키는 한 번만 돌려준다. 실제 외부 발송은 notify 계층의 몫이다. */
export function dueReminderJobs(
  sources: readonly DateReminderSource[],
  today: string,
  alreadySentKeys: ReadonlySet<string> = new Set(),
): ReminderJob[] {
  parseDate(today);
  const jobs = new Map<string, ReminderJob>();
  for (const source of sources) {
    const job = buildReminderJob(source);
    if (job.notifyOn === today && !alreadySentKeys.has(job.key)) jobs.set(job.key, job);
  }
  return [...jobs.values()];
}
