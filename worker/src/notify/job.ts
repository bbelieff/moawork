import type { Job } from "pg-boss";
import type { MessageLoader, MessageStatusSink, NotificationProvider } from "./provider.js";
import { resolveProvider } from "./provider.js";

/** 발송 큐 이름 (설계 §3.1). */
export const NOTIFY_SEND_QUEUE = "notify.send";

/**
 * 잡 페이로드 — messageId 만 싣는다.
 * 본문/수신처는 DB(messages)에서 읽어 큐에 개인정보를 남기지 않는다.
 */
export interface NotifySendJobData {
  messageId: string;
}

/** 페이로드 형태 검증(외부에서 들어온 값이므로 신뢰하지 않는다). */
export function isNotifySendJobData(value: unknown): value is NotifySendJobData {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { messageId?: unknown }).messageId === "string" &&
    (value as { messageId: string }).messageId.length > 0
  );
}

export interface NotifyHandlerDeps {
  providers: readonly NotificationProvider[];
  loader: MessageLoader;
  sink: MessageStatusSink;
  log?: (message: string) => void;
}

/** 잡 1건의 처리 결과 — 테스트/관측용. */
export type NotifyJobOutcome =
  | { status: "sent"; messageId: string; providerMessageId: string }
  /** 재시도 없이 종결(영구 실패·대상 없음·프로바이더 없음). */
  | { status: "failed"; messageId: string; error: string }
  /** 페이로드가 깨져 처리 불가 — 재시도해도 동일하므로 버린다. */
  | { status: "invalid"; error: string };

/**
 * 단건 발송 처리.
 *
 * 재시도 정책(설계 §3.2):
 *  - 일시 오류(retryable)  → throw 하여 pg-boss 재시도에 맡긴다.
 *  - 영구 오류(!retryable) → messages.status=failed 로 종결(재시도 안 함).
 * 이 구분이 없으면 잘못된 번호에도 계속 재발송하거나, 일시 장애에 즉시 포기하게 된다.
 */
export async function processNotifyJob(
  deps: NotifyHandlerDeps,
  data: unknown,
): Promise<NotifyJobOutcome> {
  const log = deps.log ?? ((m: string) => console.log(m));

  if (!isNotifySendJobData(data)) {
    const error = "잘못된 페이로드 — messageId(string) 필요";
    log(`[notify] ${error}`);
    return { status: "invalid", error };
  }

  const { messageId } = data;
  const message = await deps.loader.load(messageId);
  if (!message) {
    // 이미 처리됐거나 취소된 건. 재시도해도 결과가 같으므로 종결한다.
    log(`[notify] 대상 메시지 없음 messageId=${messageId} — 건너뜀`);
    return { status: "failed", messageId, error: "대상 메시지 없음" };
  }

  const provider = resolveProvider(deps.providers, message.channel);
  if (!provider) {
    const error = `지원 프로바이더 없음 channel=${message.channel}`;
    log(`[notify] ${error} messageId=${messageId}`);
    await deps.sink.markFailed(messageId, error);
    return { status: "failed", messageId, error };
  }

  const result = await provider.send(message);

  if (result.ok) {
    await deps.sink.markSent(messageId, result.providerMessageId);
    return { status: "sent", messageId, providerMessageId: result.providerMessageId };
  }

  if (result.retryable) {
    // 상태를 failed 로 굳히지 않는다 — 재시도 소진 후에야 최종 실패다.
    log(`[notify] 일시 실패 재시도 위임 messageId=${messageId}: ${result.error}`);
    throw new Error(`발송 일시 실패(재시도): ${result.error}`);
  }

  await deps.sink.markFailed(messageId, result.error);
  return { status: "failed", messageId, error: result.error };
}

/**
 * pg-boss v10 워크 핸들러.
 * v10 은 잡을 **배열(batch)** 로 전달하므로 순회 처리한다.
 */
export function createNotifySendHandler(deps: NotifyHandlerDeps) {
  return async (jobs: Job<NotifySendJobData>[]): Promise<void> => {
    for (const job of jobs) {
      await processNotifyJob(deps, job.data);
    }
  };
}
