import { describe, expect, it } from "vitest";
import { toTree, type DepartmentMember, type DepartmentNode } from "./departments";

/**
 * #571 — 조직도 트리 접기.
 *
 * 여기서 틀리기 쉬운 것 둘을 노리고 잰다:
 *   ① 겸직 — 한 사람이 두 부서에 있으면 «두 번» 세어지기 쉽다
 *   ② 순환 — parent 가 서로를 가리키면 재귀가 영원히 돈다(화면이 멈춘다)
 */

const dept = (id: string, name: string, parentId: string | null = null, sortOrder = 0): DepartmentNode =>
  ({ id, name, parentId, headUserId: null, sortOrder, memberCount: 0 });

const member = (userId: string, departmentIds: string[]): DepartmentMember =>
  ({ userId, displayName: userId, departmentIds, active: true });

describe("#571 조직도 트리", () => {
  it("부서가 없으면 빈 목록이다 — 오류가 아니다", () => {
    expect(toTree([], [])).toEqual([]);
  });

  it("깊이를 매겨 들여쓸 수 있게 한다", () => {
    const rows = toTree([dept("a", "본부"), dept("b", "팀", "a"), dept("c", "파트", "b")], []);
    expect(rows.map((row) => [row.name, row.depth])).toEqual([["본부", 0], ["팀", 1], ["파트", 2]]);
  });

  it("같은 층은 sortOrder → 이름 순이다", () => {
    const rows = toTree([dept("b", "나", null, 1), dept("a", "가", null, 0), dept("c", "다", null, 1)], []);
    expect(rows.map((row) => row.name)).toEqual(["가", "나", "다"]);
  });

  it("★ 하위 인원을 합칠 때 겸직을 두 번 세지 않는다", () => {
    // 한 사람이 상위와 하위 «둘 다» 에 배정된 경우.
    const rows = toTree(
      [dept("a", "본부"), dept("b", "팀", "a")],
      [member("u1", ["a", "b"]), member("u2", ["b"])],
    );
    const 본부 = rows.find((row) => row.name === "본부")!;
    const 팀 = rows.find((row) => row.name === "팀")!;
    expect(팀.reachCount).toBe(2);
    // u1 을 두 번 세면 3 이 된다. 사람 수는 2 명이다.
    expect(본부.reachCount, "겸직이 두 번 세어졌다").toBe(2);
  });

  it("직접 배정 수(memberCount)와 하위 포함 수(reachCount)는 다른 값이다", () => {
    const rows = toTree(
      [{ ...dept("a", "본부"), memberCount: 1 }, { ...dept("b", "팀", "a"), memberCount: 2 }],
      [member("u1", ["a"]), member("u2", ["b"]), member("u3", ["b"])],
    );
    const 본부 = rows.find((row) => row.name === "본부")!;
    expect(본부.memberCount, "직접 배정만 센다").toBe(1);
    expect(본부.reachCount, "하위까지 센다").toBe(3);
  });

  it("★ 순환이 있어도 멈추지 않는다 — 화면이 얼면 안 된다", () => {
    // DB 는 self-parent 만 막는다. a→b→a 같은 고리는 통과할 수 있다.
    const rows = toTree([dept("a", "가", "b"), dept("b", "나", "a")], []);
    // 뿌리가 없으니 아무것도 못 그리지만, «끝난다» 는 것이 이 테스트의 요점이다.
    expect(Array.isArray(rows)).toBe(true);
  });

  it("부모가 사라진 부서는 조용히 버리지 않는다 — 뿌리 없는 가지는 안 그린다", () => {
    // 부모 id 가 목록에 없으면 그 가지는 화면에 못 뜬다. 그 사실을 못박아 둔다 —
    // 나중에 «왜 안 보이지» 로 헤매지 않도록.
    const rows = toTree([dept("orphan", "고아", "없는부모")], []);
    expect(rows).toEqual([]);
  });
});
