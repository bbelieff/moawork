import type PgBoss from "pg-boss";
import { createNotifySendHandler, NOTIFY_SEND_QUEUE, type NotifyHandlerDeps } from "./job.js";

/** 발송 큐 기본 정책 (설계 §3.1). */
export const NOTIFY_QUEUE_OPTIONS = {
  name: NOTIFY_SEND_QUEUE,
  /** 일시 장애 대비 — 지수 백오프로 3회까지 재시도. */
  retryLimit: 3,
  retryBackoff: true,
} as const satisfies PgBoss.Queue;

/**
 * 알림 발송 워커 등록.
 *
 * pg-boss v10 은 send/work 전에 큐가 존재해야 하므로 createQueue 를 먼저 호출한다.
 * (v9 이전의 암묵적 큐 생성 동작이 사라졌다.)
 */
export async function registerNotifyWorker(
  boss: PgBoss,
  deps: NotifyHandlerDeps,
): Promise<void> {
  await boss.createQueue(NOTIFY_SEND_QUEUE, NOTIFY_QUEUE_OPTIONS);
  await boss.work(NOTIFY_SEND_QUEUE, createNotifySendHandler(deps));
}
