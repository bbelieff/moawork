import { describe, expect, it } from "vitest";
import { legacyMemberPickerEntries, memberPickerEntries } from "./member-directory";
import type { OrgChart } from "@/lib/org/departments";

describe("조직도 사람 선택기 경계", () => {
  it("조직도 읽기 실패 fallback은 역할을 가짜 부서로 만들지 않는다", () => {
    expect(legacyMemberPickerEntries([{ userId: "owner", displayName: "대표", role: "owner" }])).toEqual([
      expect.objectContaining({ id: "owner", groupId: null, groupLabel: "부서 미지정", active: true }),
    ]);
  });

  it("다중 부서 멤버를 각 부서에 표시하되 같은 user id를 유지한다", () => {
    const directory: Extract<OrgChart, { kind: "ready" }> = {
      kind: "ready",
      departments: [
        { id: "sales", name: "영업", memberCount: 1, parentId: null, headUserId: null, sortOrder: 0 },
        { id: "review", name: "심사", memberCount: 1, parentId: null, headUserId: null, sortOrder: 1 },
      ],
      members: [{ userId: "a", displayName: "가람", avatarUrl: null, departmentIds: ["sales", "review"], primaryDepartmentId: "sales", active: true }],
      unassignedCount: 0,
    };
    expect(memberPickerEntries(directory)).toEqual([
      expect.objectContaining({ id: "a", groupId: "sales", groupLabel: "영업" }),
      expect.objectContaining({ id: "a", groupId: "review", groupLabel: "심사" }),
    ]);
  });
});
