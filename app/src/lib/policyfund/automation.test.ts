import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  indexRules,
  decideMove,
  decideMoves,
  findRuleConflicts,
  type AutomationRule,
  type ItemStateChange,
} from "./automation";

const BOARD = "board-work";
const COL = "progress_status";

function rule(over: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id: "r1",
    board_id: BOARD,
    status_column_key: COL,
    status_value: "심사 중",
    to_group_id: "g-review",
    enabled: true,
    ...over,
  };
}

function change(over: Partial<ItemStateChange> = {}): ItemStateChange {
  return {
    item_id: "i1",
    board_id: BOARD,
    group_id: "g-prep",
    status_column_key: COL,
    status_value: "심사 중",
    ...over,
  };
}

describe("규칙 인덱싱", () => {
  it("활성 규칙만 담는다", () => {
    const idx = indexRules([
      rule({ id: "a" }),
      rule({ id: "b", status_value: "승인", to_group_id: "g-ok", enabled: false }),
    ]);
    expect(idx.size).toBe(1);
  });

  it("중복 키는 먼저 온 규칙을 유지한다(결정적)", () => {
    const idx = indexRules([
      rule({ id: "first", to_group_id: "g-1" }),
      rule({ id: "second", to_group_id: "g-2" }),
    ]);
    expect([...idx.values()][0].id).toBe("first");
  });
});

describe("자동이동 판정", () => {
  const idx = indexRules([
    rule({ id: "r-review", status_value: "심사 중", to_group_id: "g-review" }),
    rule({ id: "r-ok", status_value: "승인", to_group_id: "g-approved" }),
    rule({ id: "r-no", status_value: "불가", to_group_id: "g-rejected" }),
  ]);

  it("매칭 규칙이 있으면 이동 결정을 낸다", () => {
    expect(decideMove(change(), idx)).toEqual({
      item_id: "i1",
      from_group_id: "g-prep",
      to_group_id: "g-review",
      rule_id: "r-review",
    });
  });

  it("상태값별로 다른 그룹으로 보낸다", () => {
    expect(decideMove(change({ status_value: "승인" }), idx)?.to_group_id).toBe(
      "g-approved",
    );
    expect(decideMove(change({ status_value: "불가" }), idx)?.to_group_id).toBe(
      "g-rejected",
    );
  });

  it("이미 대상 그룹이면 이동하지 않는다(no-op)", () => {
    expect(decideMove(change({ group_id: "g-review" }), idx)).toBeNull();
  });

  it("미배치(group_id=null) 아이템도 이동시킨다", () => {
    const d = decideMove(change({ group_id: null }), idx);
    expect(d?.from_group_id).toBeNull();
    expect(d?.to_group_id).toBe("g-review");
  });

  it("규칙 없는 상태값은 이동 없음", () => {
    expect(decideMove(change({ status_value: "보류" }), idx)).toBeNull();
  });

  it("상태값이 null/빈문자면 이동 없음", () => {
    expect(decideMove(change({ status_value: null }), idx)).toBeNull();
    expect(decideMove(change({ status_value: "   " }), idx)).toBeNull();
  });

  it("다른 보드의 변경에는 반응하지 않는다(보드 격리)", () => {
    expect(decideMove(change({ board_id: "board-other" }), idx)).toBeNull();
  });

  it("다른 상태 컬럼의 변경에는 반응하지 않는다", () => {
    expect(
      decideMove(change({ status_column_key: "contract_status" }), idx),
    ).toBeNull();
  });

  it("비활성 규칙은 발동하지 않는다", () => {
    const off = indexRules([rule({ enabled: false })]);
    expect(decideMove(change(), off)).toBeNull();
  });

  it("라벨 앞뒤 공백은 흡수한다", () => {
    expect(decideMove(change({ status_value: " 심사 중 " }), idx)?.rule_id).toBe(
      "r-review",
    );
  });
});

describe("일괄 판정", () => {
  it("이동이 필요한 건만 반환한다", () => {
    const rules = [
      rule({ id: "r-review", status_value: "심사 중", to_group_id: "g-review" }),
      rule({ id: "r-ok", status_value: "승인", to_group_id: "g-approved" }),
    ];
    const moves = decideMoves(
      [
        change({ item_id: "i1", status_value: "심사 중" }), // 이동
        change({ item_id: "i2", status_value: "보류" }), // 규칙 없음
        change({ item_id: "i3", status_value: "승인", group_id: "g-approved" }), // no-op
        change({ item_id: "i4", status_value: "승인", group_id: "g-prep" }), // 이동
      ],
      rules,
    );
    expect(moves.map((m) => m.item_id)).toEqual(["i1", "i4"]);
  });

  it("빈 입력은 빈 결과", () => {
    expect(decideMoves([], [rule()])).toEqual([]);
    expect(decideMoves([change()], [])).toEqual([]);
  });
});

describe("규칙 충돌 검사", () => {
  it("같은 키에 다른 대상 그룹이면 충돌", () => {
    const c = findRuleConflicts([
      rule({ id: "a", to_group_id: "g-1" }),
      rule({ id: "b", to_group_id: "g-2" }),
    ]);
    expect(c).toHaveLength(1);
    expect(c[0].rule_ids).toEqual(["a", "b"]);
    expect(c[0].status_value).toBe("심사 중");
  });

  it("같은 키·같은 대상이면 충돌 아님", () => {
    expect(
      findRuleConflicts([rule({ id: "a" }), rule({ id: "b" })]),
    ).toHaveLength(0);
  });

  it("비활성 규칙은 충돌 검사에서 제외", () => {
    expect(
      findRuleConflicts([
        rule({ id: "a", to_group_id: "g-1" }),
        rule({ id: "b", to_group_id: "g-2", enabled: false }),
      ]),
    ).toHaveLength(0);
  });

  it("정상 규칙 집합은 충돌 0", () => {
    expect(
      findRuleConflicts([
        rule({ id: "a", status_value: "심사 중", to_group_id: "g-review" }),
        rule({ id: "b", status_value: "승인", to_group_id: "g-approved" }),
        rule({ id: "c", status_value: "불가", to_group_id: "g-rejected" }),
      ]),
    ).toHaveLength(0);
  });
});

describe("설계 가드 — 그룹 목록 하드코딩 금지", () => {
  it("엔진은 특정 그룹명을 알지 못한다(규칙=데이터)", () => {
    const src = readFileSync(
      fileURLToPath(new URL("./automation.ts", import.meta.url)),
      "utf8",
    );
    // 코드 본문(주석 제외)에 구체 그룹명이 박히면 안 된다.
    const body = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const name of ["준비", "심사", "승인", "관리", "불가"]) {
      expect(body).not.toContain(name);
    }
  });
});
