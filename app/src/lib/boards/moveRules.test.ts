import { describe, expect, it } from "vitest";
import {
  isMoveColumn,
  planStageBackSync,
  plainGroupName,
  primaryStageForGroup,
  resolveMoveTarget,
  stageOptionIdForGroup,
  stageSyncNeedsLiveRowCounts,
  syncGroupLinkedStageColumn,
  type StageSyncGroup,
} from "./moveRules";
import type { BoardColumn } from "./types";
import type { FieldOption } from "@/lib/types";

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

  it("본문만 같은 선택지가 여럿이어도 라벨이 그룹 이름과 «정확히» 같은 하나가 대표다(#845 동기화 뒤의 모양)", () => {
    const groups = [{ id: "g-ready", name: "준비단계" }];
    const both = stageCol({ "대기중": "g-ready", "옛 대기": "g-ready" }, [
      { id: "옛 대기", label: "⏹️ 준비단계" },
      { id: "대기중", label: "준비단계" },
    ]);
    expect(primaryStageForGroup(both, groups, "g-ready")).toBe("대기중");
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

describe("syncGroupLinkedStageColumn — 단계 = 보드 그룹 (#845)", () => {
  type SyncColumn = Pick<BoardColumn, "type" | "move_rule_jsonb" | "options_jsonb">;
  const baseGroups: StageSyncGroup[] = [
    { id: "g-ready", name: "⏹️ 준비단계", sort_order: 0 },
    { id: "g-doing", name: "▶️ 진행중", sort_order: 1 },
    { id: "g-ok", name: "💰 승인", sort_order: 2 },
  ];
  const baseColumn = (): SyncColumn => ({
    type: "status",
    options_jsonb: {
      options: [
        { id: "대기중", label: "대기중", color: "#c4c4c4", order: 0 },
        { id: "진행중", label: "진행중", order: 1 },
        { id: "승인", label: "승인", order: 2 },
      ],
    },
    move_rule_jsonb: { "대기중": "g-ready", "진행중": "g-doing", "승인": "g-ok" },
  });
  /** 한 번 동기화한 상태 — 이후 테스트의 출발점. */
  const synced = (groups: readonly StageSyncGroup[] = baseGroups): SyncColumn => {
    const plan = syncGroupLinkedStageColumn(baseColumn(), groups)!;
    return { type: "status", options_jsonb: { options: plan.options }, move_rule_jsonb: plan.moveRule };
  };
  const labels = (options: readonly FieldOption[]) => options.map((option) => [option.id, option.label]);

  it("처음 동기화하면 단계 라벨이 그룹 이름이 되고 id·색은 그대로다", () => {
    const plan = syncGroupLinkedStageColumn(baseColumn(), baseGroups)!;
    expect(plan.changed).toBe(true);
    expect(labels(plan.options)).toEqual([["대기중", "⏹️ 준비단계"], ["진행중", "▶️ 진행중"], ["승인", "💰 승인"]]);
    expect(plan.options[0].color).toBe("#c4c4c4");
    expect(plan.moveRule).toEqual(baseColumn().move_rule_jsonb);
  });

  it("그룹 이름을 바꾸면 그 단계 라벨이 따라온다 — 선택지 id 는 그대로다", () => {
    const renamed = baseGroups.map((group) => group.id === "g-ok" ? { ...group, name: "최종 승인" } : group);
    const plan = syncGroupLinkedStageColumn(synced(), renamed)!;
    expect(plan.changed).toBe(true);
    expect(plan.options.find((option) => option.id === "승인")?.label).toBe("최종 승인");
    expect(plan.options.map((option) => option.id)).toEqual(["대기중", "진행중", "승인"]);
    expect(plan.moveRule["승인"]).toBe("g-ok");
  });

  it("그룹 순서를 바꾸면 단계 순서가 따라온다", () => {
    const reordered = baseGroups.map((group) => ({ ...group, sort_order: { "g-ok": 0, "g-ready": 1, "g-doing": 2 }[group.id]! }));
    const plan = syncGroupLinkedStageColumn(synced(), reordered)!;
    expect(plan.options.map((option) => [option.id, option.order])).toEqual([["승인", 0], ["대기중", 1], ["진행중", 2]]);
  });

  it("그룹을 더하면 그룹 id 에서 나온 고정 id 로 새 단계와 이동 규칙이 생긴다", () => {
    const added = [...baseGroups, { id: "g-new", name: "기업인증 진행", sort_order: 3, color: "#579bfc" }];
    const plan = syncGroupLinkedStageColumn(synced(), added)!;
    const created = plan.options.at(-1)!;
    expect(created).toEqual({ id: stageOptionIdForGroup("g-new"), label: "기업인증 진행", color: "#579bfc", order: 3 });
    expect(plan.moveRule[created.id]).toBe("g-new");
    // 같은 입력으로 다시 계산해도 같은 id 다(결정적).
    expect(syncGroupLinkedStageColumn(synced(), added)!.options.at(-1)!.id).toBe(created.id);
  });

  it("두 번째 동기화는 바꿀 것이 없다(쓰기 0)", () => {
    const added = [...baseGroups, { id: "g-new", name: "관리중", sort_order: 3 }];
    const first = syncGroupLinkedStageColumn(synced(), added)!;
    const again = syncGroupLinkedStageColumn(
      { type: "status", options_jsonb: { options: first.options }, move_rule_jsonb: first.moveRule },
      added,
    )!;
    expect(again.changed).toBe(false);
    expect(syncGroupLinkedStageColumn(synced(), baseGroups)!.changed).toBe(false);
  });

  it("그룹이 사라진 단계는 id 를 지키고 규칙만 잃어 맨 뒤로 간다(값만 바뀌는 단계)", () => {
    const withoutDoing = baseGroups.filter((group) => group.id !== "g-doing");
    const plan = syncGroupLinkedStageColumn(synced(), withoutDoing)!;
    expect(plan.options.map((option) => option.id)).toEqual(["대기중", "승인", "진행중"]);
    expect(plan.moveRule).not.toHaveProperty("진행중");
    expect(plan.options.at(-1)?.label).toBe("▶️ 진행중");
  });

  it("같은 그룹을 가리키는 별칭은 라벨·규칙을 지키고 대표 뒤에 둔다 — 대표는 그룹 이름과 같은 선택지", () => {
    const column: SyncColumn = {
      type: "status",
      options_jsonb: { options: [{ id: "소공인(상생)", label: "소공인(상생)" }, { id: "관리중", label: "관리중" }] },
      move_rule_jsonb: { "소공인(상생)": "g-managed", "관리중": "g-managed" },
    };
    const plan = syncGroupLinkedStageColumn(column, [{ id: "g-managed", name: "관리중", sort_order: 0 }])!;
    expect(labels(plan.options)).toEqual([["관리중", "관리중"], ["소공인(상생)", "소공인(상생)"]]);
    expect(plan.moveRule).toEqual({ "소공인(상생)": "g-managed", "관리중": "g-managed" });
  });

  describe("빈 설치기 복제 — 운영 모양(이름 바뀐 원래 그룹 + 뒤에 다시 생긴 빈 «⏹️ 준비단계»)", () => {
    const installerGroupNames = new Set(["⏹️ 준비단계", "▶️ 진행중", "💰 승인"]);
    const groups: StageSyncGroup[] = [
      { id: "g-ready", name: "준비단계", sort_order: 0 },
      { id: "g-doing", name: "진행중", sort_order: 1 },
      { id: "g-ok", name: "승인", sort_order: 2 },
      { id: "d-ready-1", name: "⏹️ 준비단계", sort_order: 11 },
      { id: "d-ready-2", name: "⏹️ 준비단계", sort_order: 11 },
      { id: "d-ok", name: "💰 승인", sort_order: 14 },
    ];

    it("행이 0인 복제는 단계를 받지 않는다", () => {
      const plan = syncGroupLinkedStageColumn(baseColumn(), groups, new Map([["g-ready", 3]]), { installerGroupNames })!;
      expect(labels(plan.options)).toEqual([["대기중", "준비단계"], ["진행중", "진행중"], ["승인", "승인"]]);
      expect(Object.values(plan.moveRule)).not.toContain("d-ready-1");
      expect(plan.options.some((option) => option.id === stageOptionIdForGroup("d-ok"))).toBe(false);
      expect(stageSyncNeedsLiveRowCounts(groups, { installerGroupNames })).toBe(true);
      expect(stageSyncNeedsLiveRowCounts(baseGroups, { installerGroupNames })).toBe(false);
    });

    it("행이 있으면 복제가 아니다 — 새 단계를 받는다", () => {
      const plan = syncGroupLinkedStageColumn(baseColumn(), groups, new Map([["d-ok", 1]]), { installerGroupNames })!;
      expect(plan.options.find((option) => option.id === stageOptionIdForGroup("d-ok"))?.label).toBe("💰 승인");
    });

    it("설치기 이름 그대로가 아닌(회사가 만든) 같은 본문 그룹은 복제가 아니다", () => {
      const custom = [...baseGroups, { id: "g-custom", name: "승인", sort_order: 9 }];
      const plan = syncGroupLinkedStageColumn(synced(), custom, new Map(), { installerGroupNames })!;
      expect(plan.moveRule[stageOptionIdForGroup("g-custom")]).toBe("g-custom");
    });

    it("빈 복제를 가리키던 규칙은 같은 본문 이름의 원래 그룹으로 옮긴다(행 수를 알 때만)", () => {
      const column = { ...baseColumn(), move_rule_jsonb: { "대기중": "d-ready-1", "진행중": "g-doing", "승인": "g-ok" } };
      const exact = syncGroupLinkedStageColumn(column, groups, new Map(), { installerGroupNames })!;
      expect(exact.moveRule["대기중"]).toBe("g-ready");
      expect(exact.options[0]).toMatchObject({ id: "대기중", label: "준비단계" });
      // 행 수를 모르면(증거만) 규칙이 가리키는 복제를 건드리지 않는다 — 새 단계도 만들지 않는다.
      const evidence = syncGroupLinkedStageColumn(column, groups, undefined, { installerGroupNames })!;
      expect(evidence.moveRule["대기중"]).toBe("d-ready-1");
      expect(evidence.options.some((option) => option.id === stageOptionIdForGroup("d-ready-2"))).toBe(false);
      expect(evidence.options.some((option) => option.id === stageOptionIdForGroup("d-ok"))).toBe(false);
      // 원래 그룹에도 새 단계를 만들지 않는다 — 만들면 나중에 정확히 맞출 때 «준비단계» 단계가 둘이 된다.
      expect(evidence.options.some((option) => option.id === stageOptionIdForGroup("g-ready"))).toBe(false);
      const evidenceColumn: SyncColumn = { type: "status", options_jsonb: { options: evidence.options }, move_rule_jsonb: evidence.moveRule };
      const exactAfter = syncGroupLinkedStageColumn(evidenceColumn, groups, new Map(), { installerGroupNames })!;
      expect(exactAfter.options.filter((option) => exactAfter.moveRule[option.id] === "g-ready").map((option) => [option.id, option.label]))
        .toEqual([["대기중", "준비단계"]]);
    });

    it("증거만으로 맞춘 결과 위에서 정확히 다시 맞춰도, 정확히 맞춘 결과 위에서 증거로 다시 맞춰도 서로 되돌리지 않는다", () => {
      const counts = new Map([["g-ready", 2]]);
      const exact = syncGroupLinkedStageColumn(baseColumn(), groups, counts, { installerGroupNames })!;
      const exactColumn: SyncColumn = { type: "status", options_jsonb: { options: exact.options }, move_rule_jsonb: exact.moveRule };
      expect(syncGroupLinkedStageColumn(exactColumn, groups, undefined, { installerGroupNames })!.changed).toBe(false);
      expect(syncGroupLinkedStageColumn(exactColumn, groups, counts, { installerGroupNames })!.changed).toBe(false);
    });
  });

  it("연결하지 않는 칸 — 이동 규칙이 꺼졌거나(없음·빈 객체) 단일 선택이 아니거나 그룹이 없으면 null", () => {
    expect(syncGroupLinkedStageColumn({ ...baseColumn(), move_rule_jsonb: null }, baseGroups)).toBeNull();
    expect(syncGroupLinkedStageColumn({ ...baseColumn(), move_rule_jsonb: {} }, baseGroups)).toBeNull();
    expect(syncGroupLinkedStageColumn({ ...baseColumn(), type: "multiselect" }, baseGroups)).toBeNull();
    expect(syncGroupLinkedStageColumn(baseColumn(), [])).toBeNull();
  });

  it("입력 선택지 객체를 고치지 않는다(저장소가 같은 객체를 돌려줘도 안전)", () => {
    const column = baseColumn();
    const before = JSON.stringify(column);
    syncGroupLinkedStageColumn(column, [...baseGroups, { id: "g-new", name: "새 그룹", sort_order: 5 }]);
    expect(JSON.stringify(column)).toBe(before);
  });
});
