import type PgBoss from "pg-boss";
import type { PostgresDateScheduleStore } from "./store.js";

export const DATE_SCHEDULE_DRAIN_QUEUE = "board-date-schedule.drain";

export async function registerDateScheduleWorker(boss: PgBoss, store: PostgresDateScheduleStore): Promise<void> {
  await boss.createQueue(DATE_SCHEDULE_DRAIN_QUEUE, { name: DATE_SCHEDULE_DRAIN_QUEUE, retryLimit: 3, retryBackoff: true });
  await boss.work(DATE_SCHEDULE_DRAIN_QUEUE, async () => store.dispatchDue(50));
  await boss.schedule(DATE_SCHEDULE_DRAIN_QUEUE, "* * * * *", {}, { singletonKey: "date-schedule-minute" });
}
