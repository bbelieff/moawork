import { describe, expect, it } from "vitest";
import { notificationRouteTone } from "./NotificationRoute";

describe("notificationRouteTone", () => {
  it("직속과 먼 계통의 시각 강도를 구분한다", () => {
    expect(notificationRouteTone(1).background).not.toBe("transparent");
    expect(notificationRouteTone(2).rail).toContain("55%");
    expect(notificationRouteTone(3).rail).toContain("30%");
  });
});
