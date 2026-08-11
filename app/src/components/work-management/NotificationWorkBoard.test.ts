import { describe, expect, it } from "vitest";
import { highlightedNotificationTitle } from "./NotificationWorkBoard";

describe("NotificationWorkBoard", () => {
  it("알림 query의 item id를 실제 행 제목으로 연결한다", () => {
    const snapshot = { items: [{ id: "i1", title: "확인할 업무" }] } as unknown as Parameters<typeof highlightedNotificationTitle>[0];
    expect(highlightedNotificationTitle(snapshot, "i1")).toBe("확인할 업무");
    expect(highlightedNotificationTitle(snapshot, null)).toBeNull();
  });
});
