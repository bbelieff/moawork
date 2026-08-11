import { describe, expect, it } from "vitest";
import { highlightedNotificationRowIndex, highlightedNotificationTitle } from "./NotificationWorkBoard";

describe("NotificationWorkBoard", () => {
  it("알림 query의 item id를 실제 행 제목으로 연결한다", () => {
    const snapshot = { items: [{ id: "i1", title: "확인할 업무" }] } as unknown as Parameters<typeof highlightedNotificationTitle>[0];
    expect(highlightedNotificationTitle(snapshot, "i1")).toBe("확인할 업무");
    expect(highlightedNotificationTitle(snapshot, null)).toBeNull();
  });
  it("제목이 같아도 item id의 정확한 행 순서를 찾는다", () => {
    const snapshot = { groups: [{ id: "g" }], items: [{ id: "i1", title: "같은 제목", groupId: "g" }, { id: "i2", title: "같은 제목", groupId: "g" }] } as unknown as Parameters<typeof highlightedNotificationRowIndex>[0];
    expect(highlightedNotificationRowIndex(snapshot, "i2")).toBe(1);
  });
});
