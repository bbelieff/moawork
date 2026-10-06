import { describe, expect, it } from "vitest";
import { isMoveColumn, planStageBackSync, plainGroupName, primaryStageForGroup, resolveMoveTarget } from "./moveRules";
import type { BoardColumn } from "./types";

function col(move_rule_jsonb: Record<string, string> | null | undefined): Pick<BoardColumn, "move_rule_jsonb"> {
  return { move_rule_jsonb };
}

describe("resolveMoveTarget", () => {
  it("규칙 없는 컬럼은 항상 null", () => {
    expect(resolveMoveTarget(col(null), "x")).toBeNull();
    expect(resolveMoveTarget(col(undefined), "x")).toBeNull();
    expect(resolveMoveTarget(col({}), "x")).toBeNull();
  });

  it("규칙에 있는 값이면 매핑된 그룹 id를 돌려준다", () => {
    const c = col({ "opt-done": "grp-1", "opt-hold": "grp-2" });
    expect(resolveMoveTarget(c, "opt-done")).toBe("grp-1");
    expect(resolveMoveTarget(c, "opt-hold")).toBe("grp-2");
  });

  it("규칙에 없는 값은 null(이동 안 함)", () => {
    const c = col({ "opt-done": "grp-1" });
    expect(resolveMoveTarget(c, "opt-other")).toBeNull();
  });

  it("빈 값(null/undefined)은 null", () => {
    const c = col({ "opt-done": "grp-1" });
    expect(resolveMoveTarget(c, null)).toBeNull();
    expect(resolveMoveTarget(c, undefined as never)).toBeNull();
  });

  it("multiselect(배열 값)는 이동 대상이 아니다 — 여러 그룹을 동시에 가리킬 수 없다", () => {
    const c = col({ "opt-done": "grp-1" });
    expect(resolveMoveTarget(c, ["opt-done"])).toBeNull();
  });

  it("숫자·불리언 값도 문자열 키로 비교한다", () => {
    const c = col({ "1": "grp-1", "true": "grp-2" });
    expect(resolveMoveTarget(c, 1)).toBe("grp-1");
    expect(resolveMoveTarget(c, true)).toBe("grp-2");
  });
});

describe("isMoveColumn", () => {
  it("규칙이 비어 있지 않으면 true", () => {
    expect(isMoveColumn(col({ a: "g1" }))).toBe(true);
  });
  it("규칙이 없거나 빈 객체면 false", () => {
    expect(isMoveColumn(col(null))).toBe(false);
    expect(isMoveColumn(col(undefined))).toBe(false);
    expect(isMoveColumn(col({}))).toBe(false);
  });
});

describe("plainGroupName — 앞머리 장식만 벗긴 그룹 본문 (2026-10-06)", () => {
  it("그림 기호·변형 선택자·공백만 벗긴다", () => {
    expect(plainGroupName("⏹️ 준비단계")).toBe("준비단계");
    expect(plainGroupName("⏹️준비단계")).toBe("준비단계");
    expect(plainGroupName("🔂 심사 중")).toBe("심사 중");
    expect(plainGroupName("⛔ 대출불가")).toBe("대출불가");
    expect(plainGroupName("📂 소진공 혁신성장 접수예정")).toBe("소진공 혁신성장 접수예정");
    expect(plainGroupName("  관리중 ")).toBe("관리중");
  });

  it("숫자는 지킨다 — 1차·2차는 다른 그룹이다", () => {
    expect(plainGroupName("🔇 1차 부재")).toBe("1차 부재");
    expect(plainGroupName("🔇 1차 부재")).not.toBe(plainGroupName("🔇 2차 부재"));
  });

  it("본문이 다르면 다른 그룹이다", () => {
    expect(plainGroupName("🔂 심사 중")).not.toBe(plainGroupName("심사 완료"));
  });
});

type StageCol = Parameters<typeof primaryStageForGroup>[0];

function stageCol(
  rule: Record<string, string> | null,
  options: Array<{ id: string; label?: string; archived?: boolean }>,
  type: StageCol["type"] = "status",
): StageCol {
  return {
    type,
    move_rule_jsonb: rule,
    options_jsonb: { options: options.map((option, order) => ({ label: option.id, ...option, order })) },
  };
}

const GROUPS = [
  { id: "g-ready", name: "준비단계" },
  { id: "g-review", name: "🔂 심사 중" },
  { id: "g-approved", name: "💰 승인" },
  { id: "g-managed", name: "관리중" },
  { id: "g-free", name: "회사가 만든 그룹" },
];

describe("primaryStageForGroup — 그룹 → 대표 단계(규칙 역방향)", () => {
  const column = stageCol(
    { "대기중": "g-ready", "심사 중": "g-review", "승인": "g-approved", "관리중": "g-managed", "소공인(상생)": "g-managed" },
    [{ id: "대기중" }, { id: "심사 중" }, { id: "승인" }, { id: "관리중" }, { id: "소공인(상생)" }, { id: "업체관리" }],
  );

  it("그 그룹을 가리키는 선택지가 하나면 그것이 대표다", () => {
    expect(primaryStageForGroup(column, GROUPS, "g-approved")).toBe("승인");
    expect(primaryStageForGroup(column, GROUPS, "g-review")).toBe("심사 중");
  });

  it("여럿이면 그룹 이름과 같은 하나가 대표다 — 1:1 전단사를 요구하지 않는다", () => {
    expect(primaryStageForGroup(column, GROUPS, "g-managed")).toBe("관리중");
  });

  it("여럿인데 이름으로도 못 가리면 모호하다 → null", () => {
    const ambiguous = stageCol({ a: "g-free", b: "g-free" }, [{ id: "a" }, { id: "b" }]);
    expect(primaryStageForGroup(ambiguous, GROUPS, "g-free")).toBeNull();
  });

  it("규칙이 가리키지 않는 그룹·빈 그룹 id 는 null", () => {
    expect(primaryStageForGroup(column, GROUPS, "g-free")).toBeNull();
    expect(primaryStageForGroup(column, GROUPS, null)).toBeNull();
    expect(primaryStageForGroup(stageCol(null, [{ id: "승인" }]), GROUPS, "g-approved")).toBeNull();
  });

  it("보관된 선택지·선택지 목록에 없는 규칙 키는 대표가 될 수 없다", () => {
    const archived = stageCol({ "승인": "g-approved", "옛 승인": "g-approved" }, [{ id: "승인", archived: true }]);
    expect(primaryStageForGroup(archived, GROUPS, "g-approved")).toBeNull();
  });

  it("단일 목적지 컬럼(select/status)만 — multiselect·person 은 null", () => {
    const rule = { "승인": "g-approved" };
    expect(primaryStageForGroup(stageCol(rule, [{ id: "승인" }], "multiselect"), GROUPS, "g-approved")).toBeNull();
    expect(primaryStageForGroup(stageCol(rule, [{ id: "승인" }], "person"), GROUPS, "g-approved")).toBeNull();
    expect(primaryStageForGroup(stageCol(rule, [{ id: "승인" }], "select"), GROUPS, "g-approved")).toBe("승인");
  });
});

describe("planStageBackSync — 행을 옮길 때 단계 값 (결정적)", () => {
  const column = stageCol(
    { "대기중": "g-ready", "심사 중": "g-review", "승인": "g-approved", "관리중": "g-managed", "소공인(상생)": "g-managed" },
    [{ id: "대기중" }, { id: "심사 중" }, { id: "승인" }, { id: "관리중" }, { id: "소공인(상생)" }, { id: "업체관리" }],
  );
  const plan = (currentValue: string | null, sourceGroupId: string | null, targetGroupId: string | null, editable = true) =>
    planStageBackSync({ column, editable, groups: GROUPS, currentValue, sourceGroupId, targetGroupId });

  it("다른 그룹으로 옮기면 그 그룹의 대표 단계를 쓴다", () => {
    expect(plan("심사 중", "g-review", "g-approved")).toBe("승인");
    expect(plan("업체관리", "g-ready", "g-managed")).toBe("관리중");
    expect(plan(null, "g-ready", "g-approved")).toBe("승인");
  });

  it("현재 값이 이미 목적 그룹을 가리키면 그대로 둔다", () => {
    expect(plan("소공인(상생)", "g-ready", "g-managed")).toBeNull();
  });

  it("같은 그룹 안 순서 바꾸기는 값만 있는 단계를 덮어쓰지 않는다", () => {
    expect(plan("업체관리", "g-approved", "g-approved")).toBeNull();
  });

  it("커밋 뒤 상태로 다시 계산해도 같은 결정이 나온다 — 재시도가 같은 요청이 된다", () => {
    // 1차: 심사 중 → 승인(값 포함). 커밋 뒤: 값=승인, 그룹=승인 → 여전히 값 포함(같은 payload).
    expect(plan("심사 중", "g-review", "g-approved")).toBe("승인");
    expect(plan("승인", "g-approved", "g-approved")).toBe("승인");
    // 1차: 값 유지(위치만). 커밋 뒤에도 위치만.
    expect(plan("소공인(상생)", "g-ready", "g-managed")).toBeNull();
    expect(plan("소공인(상생)", "g-managed", "g-managed")).toBeNull();
  });

  it("대표가 없거나(규칙 없는 그룹) 칸을 손으로 못 고치면 값은 그대로다", () => {
    expect(plan("심사 중", "g-review", "g-free")).toBeNull();
    expect(plan("심사 중", "g-review", null)).toBeNull();
    expect(plan("심사 중", "g-review", "g-approved", false)).toBeNull();
    expect(planStageBackSync({
      column: { ...column, is_readonly: true }, editable: true, groups: GROUPS,
      currentValue: "심사 중", sourceGroupId: "g-review", targetGroupId: "g-approved",
    })).toBeNull();
  });
});
