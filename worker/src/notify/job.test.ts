import { describe, it, expect } from "vitest";
import { isNotifySendJobData, processNotifyJob, type NotifyHandlerDeps } from "./job.js";
import type { MessageLoader, MessageStatusSink, NotificationProvider } from "./provider.js";
import { sendFailed, sendOk, type NotifyMessage, type SendResult } from "./types.js";

const message: NotifyMessage = {
  id: "m1",
  channel: "sms",
  to: "01000000000",
  body: "본문",
};

function loaderOf(m: NotifyMessage | null): MessageLoader {
  return { load: async () => m };
}

/** 상태 반영을 기록하는 가짜 sink. */
function fakeSink() {
  const sent: Array<[string, string]> = [];
  const failed: Array<[string, string]> = [];
  const sink: MessageStatusSink = {
    markSent: async (id, pid) => void sent.push([id, pid]),
    markFailed: async (id, err) => void failed.push([id, err]),
  };
  return { sink, sent, failed };
}

function providerOf(result: SendResult, channels: NotifyMessage["channel"][] = ["sms"]): NotificationProvider {
  return {
    name: "fake",
    supports: (c) => channels.includes(c),
    send: async () => result,
  };
}

function deps(over: Partial<NotifyHandlerDeps> & Pick<NotifyHandlerDeps, "providers" | "loader" | "sink">): NotifyHandlerDeps {
  return { log: () => {}, ...over };
}

describe("isNotifySendJobData", () => {
  it("messageId 문자열이 있어야 통과한다", () => {
    expect(isNotifySendJobData({ messageId: "m1" })).toBe(true);
  });

  it("빈 문자열·타입 불일치·null 은 거부한다", () => {
    expect(isNotifySendJobData({ messageId: "" })).toBe(false);
    expect(isNotifySendJobData({ messageId: 1 })).toBe(false);
    expect(isNotifySendJobData({})).toBe(false);
    expect(isNotifySendJobData(null)).toBe(false);
  });
});

describe("processNotifyJob", () => {
  it("발송 성공 시 sent 로 표시한다", async () => {
    const { sink, sent } = fakeSink();
    const out = await processNotifyJob(
      deps({ providers: [providerOf(sendOk("p-1"))], loader: loaderOf(message), sink }),
      { messageId: "m1" },
    );

    expect(out).toEqual({ status: "sent", messageId: "m1", providerMessageId: "p-1" });
    expect(sent).toEqual([["m1", "p-1"]]);
  });

  it("페이로드가 잘못되면 invalid 로 종결한다(재시도 안 함)", async () => {
    const { sink, sent, failed } = fakeSink();
    const out = await processNotifyJob(
      deps({ providers: [providerOf(sendOk("p-1"))], loader: loaderOf(message), sink }),
      { nope: true },
    );

    expect(out.status).toBe("invalid");
    expect(sent).toEqual([]);
    expect(failed).toEqual([]);
  });

  it("대상 메시지가 없으면 종결한다", async () => {
    const { sink, failed } = fakeSink();
    const out = await processNotifyJob(
      deps({ providers: [providerOf(sendOk("p-1"))], loader: loaderOf(null), sink }),
      { messageId: "gone" },
    );

    expect(out).toEqual({ status: "failed", messageId: "gone", error: "대상 메시지 없음" });
    // 존재하지 않는 행에 상태를 쓰지 않는다.
    expect(failed).toEqual([]);
  });

  it("채널을 지원하는 프로바이더가 없으면 failed 로 기록한다", async () => {
    const { sink, failed } = fakeSink();
    const out = await processNotifyJob(
      deps({
        providers: [providerOf(sendOk("p-1"), ["email"])],
        loader: loaderOf(message),
        sink,
      }),
      { messageId: "m1" },
    );

    expect(out.status).toBe("failed");
    expect(failed[0]?.[0]).toBe("m1");
    expect(failed[0]?.[1]).toContain("지원 프로바이더 없음");
  });

  it("영구 오류는 재시도 없이 failed 로 종결한다", async () => {
    const { sink, failed } = fakeSink();
    const out = await processNotifyJob(
      deps({
        providers: [providerOf(sendFailed("잘못된 수신번호", false))],
        loader: loaderOf(message),
        sink,
      }),
      { messageId: "m1" },
    );

    expect(out).toEqual({ status: "failed", messageId: "m1", error: "잘못된 수신번호" });
    expect(failed).toEqual([["m1", "잘못된 수신번호"]]);
  });

  it("일시 오류는 throw 하여 재시도에 맡기고 failed 로 굳히지 않는다", async () => {
    const { sink, failed } = fakeSink();
    const run = processNotifyJob(
      deps({
        providers: [providerOf(sendFailed("rate limit", true))],
        loader: loaderOf(message),
        sink,
      }),
      { messageId: "m1" },
    );

    await expect(run).rejects.toThrow(/재시도/);
    // 재시도가 남아 있으므로 최종 실패로 기록하면 안 된다.
    expect(failed).toEqual([]);
  });
});
