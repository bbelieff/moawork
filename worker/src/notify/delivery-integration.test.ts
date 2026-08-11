import { describe, expect, it, vi } from "vitest";
import { createNotifySendHandler } from "./job.js";

describe("notify worker delivery integration", () => {
  it("조용한 시간의 실제 job을 provider 호출 전에 다시 예약한다", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-08-11T23:00:00+09:00"));
    const defer = vi.fn(async () => undefined); const load = vi.fn(async () => null);
    const handler = createNotifySendHandler({
      providers: [], loader: { load }, sink: { markSent: async () => undefined, markFailed: async () => undefined },
      deliveryPolicy: { timeZone: "Asia/Seoul", quietHours: { startHour: 22, endHour: 7 }, bundleWindowMinutes: 0 }, defer,
    });
    await handler([{ data: { messageId: "m1", userId: "u1", eventKey: "deal:1", createdAt: "2026-08-11T22:00:00+09:00", urgency: "normal" } }] as never);
    expect(defer).toHaveBeenCalledOnce(); expect(load).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
