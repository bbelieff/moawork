/** 기본 탭 «리드컨택» ↔ 목업 v6 구조 계약 — BBE-149. */

import { describe, expect, it } from "vitest";
import { extractMockupContract } from "../../../../docs/design/dump-mockup.mjs";
import { sourceRequiresConfirm } from "@/lib/field/source";
import { resolveSendColumn } from "@/lib/send-guard/catalog";
import { CONTACT_GROUPS, CONTACT_TAB } from "./contact";

interface MockTab {
  key: string;
  groups: string[];
  columns: Array<{ label: string; type: string; source: string }>;
}

const mock = (extractMockupContract().tabs as MockTab[]).find((tab) => tab.key === "contact")!;

const TYPE_MAP: Record<string, string[]> = {
  text: ["text", "txt"], person: ["person", "user"], date: ["date"], phone: ["phone", "tel"],
  status: ["status", "sel"], select: ["sel"], number: ["num"], datetime: ["dt"],
  checkbox: ["check", "chk"], money: ["money"], email: ["email", "mail"],
};

describe("리드컨택 기본 탭 — 목업 계약", () => {
  it("그룹 7개를 보존하고 사람 이름 대신 담당자 슬롯 2개를 둔다", () => {
    expect(CONTACT_TAB.groups).toHaveLength(7);
    expect(mock.groups).toHaveLength(7);
    expect(CONTACT_TAB.groups[0].name).toBe(mock.groups[0]);
    expect(CONTACT_TAB.groups.slice(3).map((group) => group.name)).toEqual(mock.groups.slice(3));
    expect(CONTACT_TAB.groups.slice(1, 3).map((group) => group.assigneeSlot)).toEqual([0, 1]);
    expect(CONTACT_TAB.groups.slice(1, 3).map((group) => group.name)).toEqual([
      CONTACT_GROUPS.assignee1,
      CONTACT_GROUPS.assignee2,
    ]);
  });

  it("목업 21컬럼을 보존하고 기타정보 한 컬럼만 additive로 추가한다", () => {
    expect(CONTACT_TAB.columns).toHaveLength(22);
    const legacyColumns = CONTACT_TAB.columns.filter((column) => column.key !== "other_info");
    expect(legacyColumns.map((column) => column.label)).toEqual(mock.columns.map((column) => column.label));
    for (const [index, column] of legacyColumns.entries()) {
      expect(TYPE_MAP[column.type], column.label).toContain(mock.columns[index].type);
      expect(column.source, column.label).toBe(mock.columns[index].source);
    }
    expect(CONTACT_TAB.columns.filter((column) => column.key === "other_info"))
      .toEqual([expect.objectContaining({ label: "기타정보", type: "other_info", source: "in" })]);
  });

  it("회사명 제목 1칸 + 연결(lk) 7컬럼은 provenance를 보존하면서 직접 편집 가능하다", () => {
    const linked = CONTACT_TAB.columns.filter((column) => column.source === "lk");
    expect(linked).toHaveLength(7);
    expect(1 + linked.length).toBe(8);
    for (const column of linked) expect(column.readOnly, column.label).not.toBe(true);
  });

  it("담당자 값은 정적 사람 선택지가 아니라 멤버 계정 3슬롯 + 미배정의 4규칙이다", () => {
    const owner = CONTACT_TAB.columns.find((column) => column.key === "owner")!;
    expect(owner.type).toBe("person");
    expect(owner.options).toBeUndefined();
    expect(owner.assigneeMove?.unassignedGroup).toBe(CONTACT_GROUPS.unassigned);
    expect(owner.assigneeMove?.assignments).toEqual([
      { assigneeSlot: 0, groupAssigneeSlot: 0 },
      { assigneeSlot: 1, groupAssigneeSlot: 1 },
      { assigneeSlot: 2, groupAssigneeSlot: 1 },
    ]);
    expect(1 + (owner.assigneeMove?.assignments.length ?? 0)).toBe(4);
  });

  it("맨 오른쪽 고정 열은 업무이동 하나뿐이다", () => {
    expect(CONTACT_TAB.columns.filter((column) => column.rightPinned).map((column) => column.label)).toEqual(["업무이동"]);
    expect(CONTACT_TAB.columns.at(-2)?.label).toBe("업무이동");
    // 목업 cols 원순서는 이메일이 끝이지만, rightPinned 메타가 실제 화면에서 업무이동을 끝에 고정한다.
    expect(CONTACT_TAB.columns.find((column) => column.label === "업무이동")?.rightPinned).toBe(true);
  });

  it("미팅확정 메세지는 BBE-148 공용 발송 안전장치를 재사용한다", () => {
    const send = CONTACT_TAB.columns.find((column) => column.key === "meeting_confirm_message")!;
    expect(send.source).toBe("msg");
    expect(send.readOnly).not.toBe(true);
    expect(sourceRequiresConfirm(send.source)).toBe(true);
    expect(resolveSendColumn(send)?.fallbackTemplateCode).toBe("meeting-confirmed");
  });

  it("BBE-152 실행은 만들지 않고 이중 잠금 계약만 선언한다", () => {
    expect(CONTACT_TAB.transitions).toEqual([
      {
        columnKey: "work_move",
        value: "업무관리 이동",
        to: "work",
        guard: { columnKey: "seal_status", value: "완료" },
      },
    ]);
  });
});
