import { describe, expect, it } from "vitest";
import { planNotificationDelivery } from "./delivery-policy.js";

describe("planNotificationDelivery", () => {
  it("같은 사용자와 사건의 중복을 한 묶음으로 만든다", () => {
    const batches = planNotificationDelivery(
      ["n1", "n2", "n2"].map((notificationId) => ({
        notificationId,
        userId: "u1",
        eventKey: "deal:1:changed",
        createdAt: "2026-08-11T12:00:00.000Z",
        urgency: "normal" as const,
      })),
      { now: "2026-08-11T12:30:00.000Z", timeZone: "Asia/Seoul" },
    );
    expect(batches).toHaveLength(1);
    expect(batches[0]?.notificationIds).toEqual(["n1", "n2"]);
  });

  it("조용한 시간에는 일반 알림만 보류한다", () => {
    const common = { userId: "u1", eventKey: "event", createdAt: "2026-08-11T22:00:00+09:00" };
    const normal = planNotificationDelivery(
      [{ ...common, notificationId: "n1", urgency: "normal" }],
      { now: "2026-08-11T23:00:00+09:00", timeZone: "Asia/Seoul", quietHours: { startHour: 22, endHour: 7 }, bundleWindowMinutes: 0 },
    );
    const high = planNotificationDelivery(
      [{ ...common, notificationId: "n2", urgency: "high" }],
      { now: "2026-08-11T23:00:00+09:00", timeZone: "Asia/Seoul", quietHours: { startHour: 22, endHour: 7 }, bundleWindowMinutes: 0 },
    );
    expect(new Date(normal[0]!.deliverAfter).getTime()).toBeGreaterThan(new Date(high[0]!.deliverAfter).getTime());
  });

  it("같은 사건의 긴급 알림을 일반 알림과 별도 묶음으로 보낸다", () => {
    const batches = planNotificationDelivery(
      ["normal", "high"].map((urgency) => ({
        notificationId: urgency,
        userId: "u1",
        eventKey: "event",
        createdAt: "2026-08-11T22:00:00+09:00",
        urgency: urgency as "normal" | "high",
      })),
      { now: "2026-08-11T23:00:00+09:00", timeZone: "Asia/Seoul", quietHours: { startHour: 22, endHour: 7 }, bundleWindowMinutes: 0 },
    );
    expect(batches).toHaveLength(2);
  });
});
