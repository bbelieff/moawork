import { describe, expect, it } from "vitest";
import { resolveNotificationRecipients } from "./recipients";

describe("resolveNotificationRecipients", () => {
  it("담당자가 없으면 팀 전체를, 있으면 담당자와 계통만 기본 수신자로 삼는다", () => {
    expect(resolveNotificationRecipients({ teamMembers: ["a", "b"] }).map((r) => r.userId)).toEqual([
      "a",
      "b",
    ]);
    expect(
      resolveNotificationRecipients({
        assigneeId: "a",
        assigneeHierarchy: [{ userId: "lead", source: "hierarchy", distance: 1 }],
        teamMembers: ["a", "b"],
      }).map((r) => r.userId),
    ).toEqual(["a", "lead"]);
  });

  it("조직 멤버 입력이 바뀌면 카드 수신자도 따라 바뀐다", () => {
    const resolve = (members: string[]) =>
      resolveNotificationRecipients({ teamMembers: [], cardDepartmentMembers: members }).map(
        (r) => r.userId,
      );
    expect(resolve(["a"])).toEqual(["a"]);
    expect(resolve(["a", "b"])).toEqual(["a", "b"]);
  });

  it("여러 경로를 한 사람으로 합치고 선택 해제한 사람은 제외한다", () => {
    const recipients = resolveNotificationRecipients({
      assigneeId: "a",
      assigneeHierarchy: [{ userId: "lead", source: "hierarchy", distance: 1 }],
      teamMembers: [],
      watchingDepartmentMembers: ["lead", "watcher"],
      cardPeople: ["lead"],
      personalUnsubscriptions: new Set(["watcher"]),
    });
    expect(recipients).toHaveLength(2);
    expect(recipients.find((r) => r.userId === "lead")).toMatchObject({
      locked: true,
      sources: ["hierarchy", "watching_department", "card_person"],
    });
  });

  it("담당 계통은 개인 해제로 끌 수 없다", () => {
    const recipients = resolveNotificationRecipients({
      assigneeId: "a",
      assigneeHierarchy: [{ userId: "lead", source: "hierarchy", distance: 1 }],
      teamMembers: [],
      personalUnsubscriptions: new Set(["lead"]),
    });
    expect(recipients.find((r) => r.userId === "lead")).toMatchObject({ locked: true });
  });

  it("행위자와 권한 밖 사용자를 제외한다", () => {
    expect(
      resolveNotificationRecipients({
        actorId: "me",
        teamMembers: ["me", "allowed", "hidden"],
        canReceive: (id) => id !== "hidden",
      }).map((r) => r.userId),
    ).toEqual(["allowed"]);
  });
});
