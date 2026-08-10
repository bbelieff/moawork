import type PgBoss from "pg-boss";
import {
  createEsignSendHandler,
  ESIGN_SEND_QUEUE,
  type EsignSendDeps,
} from "./send.js";

export const ESIGN_QUEUE_OPTIONS = {
  name: ESIGN_SEND_QUEUE,
  retryLimit: 3,
  retryBackoff: true,
} as const satisfies PgBoss.Queue;

export async function registerEsignWorker(
  boss: PgBoss,
  deps: EsignSendDeps,
): Promise<void> {
  await boss.createQueue(ESIGN_SEND_QUEUE, ESIGN_QUEUE_OPTIONS);
  await boss.work(ESIGN_SEND_QUEUE, createEsignSendHandler(deps));
}
