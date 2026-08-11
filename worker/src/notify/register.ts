import type PgBoss from "pg-boss";
import { createNotifySendHandler, NOTIFY_SEND_QUEUE, type NotifyHandlerDeps, type NotifySendJobData } from "./job.js";

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
  await boss.work(NOTIFY_SEND_QUEUE, createNotifySendHandler({
    ...deps,
    defer: deps.defer ?? (async (data, deliverAfter) => { await boss.send(NOTIFY_SEND_QUEUE, data, { startAfter: deliverAfter }); }),
  }));
}

export interface NotifyJobProducerPort {
  send(name: typeof NOTIFY_SEND_QUEUE, data: NotifySendJobData): Promise<unknown>;
}

/** 외부 outbox/이벤트 owner가 호출하는 명시적 producer 계약. 정책 필드를 빠뜨린 job을 입구에서 거부한다. */
export async function enqueueNotifyJob(producer: NotifyJobProducerPort, data: NotifySendJobData): Promise<void> {
  if (!data.userId || !data.eventKey || !data.createdAt || !data.urgency) {
    throw new Error("notify job requires userId, eventKey, createdAt, urgency");
  }
  await producer.send(NOTIFY_SEND_QUEUE, data);
}
