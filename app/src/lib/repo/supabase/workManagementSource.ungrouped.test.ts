import { describe, expect, it } from "vitest";
import { WorkManagementSource, WorkManagementUnavailableError } from "./workManagementSource";

/**
 * #547 — «그룹 없는 업무 한 건이 화면 전체를 죽이던» 회귀를 막는다.
 *
 * 무엇이 문제였나
 *   DB 는 `items.group_id` 를 nullable 로 허용하는데 읽는 쪽 검증기만 «반드시 문자열» 을
 *   요구했다. 그래서 「+ 업무」로 만든 업무(항상 group_id = null)가 하나 생기는 순간
 *   스냅샷 «전체» 가 거부돼 표·필터·버튼이 통째로 사라졌다.
 *   그 업무를 지울 UI 까지 사라져서 **사용자는 제품 안에서 복구할 수 없었다.**
 */

const org = "org-1";
const board = {
  id: "board-1", orgId: org, title: "계약업체 실무", icon: "🔁",
  templateKey: "work-management", templateVersion: 1,
  baselineFingerprint: "base", currentFingerprint: "base",
};

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1", boardId: "board-1", groupId: "group-1", title: "업무",
    workflowStatus: "not_started", version: 0, templateVersion: 1, dueDate: null,
    assignedTo: null, companyRef: null, contactRef: null, companyDisplay: null, contactDisplay: null,
    provenance: null, values: {}, updates: [], activities: [], ...overrides,
  };
}

function snapshotPayload(items: unknown[]) {
  return {
    board,
    groups: [{ id: "group-1", name: "진행중", color: "#eee", count: 1 }],
    columns: [{ key: "title", label: "태스크", kind: "title", legacyOrder: 1 }],
    items,
    members: [{ membershipId: "m1", orgId: org, userId: "u1", displayName: "담당", active: true }],
    views: [{ id: "v1", name: "메인 테이블", kind: "table", shared: false, isDefault: true, version: 0, predicate: {} }],
    virtualBindings: [],
    role: "manager",
    filesEnabled: false,
  };
}

const load = (items: unknown[]) =>
  new WorkManagementSource({ rpc: async () => ({ data: snapshotPayload(items), error: null }) }).load(org);

describe("#547 그룹 없는 업무", () => {
  it("groupId 가 null 이어도 스냅샷을 버리지 않는다", async () => {
    const snapshot = await load([item({ id: "ungrouped", groupId: null })]);
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0].groupId).toBeNull();
  });

  it("★ 한 건이 «나머지 전부» 를 죽이지 않는다", async () => {
    // 이것이 이 카드의 핵심이다. 예전에는 아래에서 throw 가 나면서
    // 정상 업무까지 화면에서 사라졌다.
    const snapshot = await load([item({ id: "normal" }), item({ id: "ungrouped", groupId: null })]);
    expect(snapshot.items.map((row) => row.id)).toEqual(["normal", "ungrouped"]);
  });

  it("그래도 «정말 깨진» 값은 계속 거부한다 — 검증을 통째로 풀지 않았다", async () => {
    // groupId 만 느슨해졌을 뿐, 나머지 계약은 그대로여야 한다.
    await expect(load([item({ title: "" })])).rejects.toBeInstanceOf(WorkManagementUnavailableError);
    await expect(load([item({ workflowStatus: "이상한값" })])).rejects.toBeInstanceOf(WorkManagementUnavailableError);
    await expect(load([item({ boardId: "다른보드" })])).rejects.toBeInstanceOf(WorkManagementUnavailableError);
    // groupId 가 숫자처럼 «타입이 틀린» 경우도 여전히 거부한다(null 만 허용한다).
    await expect(load([item({ groupId: 7 })])).rejects.toBeInstanceOf(WorkManagementUnavailableError);
  });
});
