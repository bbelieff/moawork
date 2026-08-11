import { describe, expect, it } from "vitest";
import { isNotificationHighlighted, notificationTargetHref } from "./highlight";

describe("notification highlight", () => {
  it("이동 주소에 알림 식별자를 보존한다", () => {
    expect(notificationTargetHref("/work?item=1", "n 1")).toBe("/work?item=1&notification=n+1");
  });
  it("기존 강조 식별자가 있으면 중복하지 않고 교체한다", () => {
    expect(notificationTargetHref("/work?notification=old", "new")).toBe("/work?notification=new");
  });
  it("행 조작 후 현재 식별자를 비우면 강조가 해제된다", () => {
    expect(isNotificationHighlighted("n1", "n1")).toBe(true);
    expect(isNotificationHighlighted("n1", null)).toBe(false);
  });
});
