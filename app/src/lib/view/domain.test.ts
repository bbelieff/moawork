import { describe, expect, it } from "vitest";
import type { TabView } from "./contracts";
import {
  applyView,
  DEFAULT_SYSTEM_VIEW,
  dynamicBadge,
  hiddenByScopeCount,
  selectionTargetIds,
  splitByVisibility,
  type ViewApplyContext,
} from "./domain";

interface Row {
  id: string;
  owner: string | null;
  시도: string;
  시군구: string;
  마감일: string;
}

const ROWS: Row[] = [
  { id: "r1", owner: "카뮈", 시도: "서울", 시군구: "관악구", 마감일: "2026-08-11" },
  { id: "r2", owner: "이대표", 시도: "서울", 시군구: "강남구", 마감일: "2026-08-10" },
  { id: "r3", owner: "박정화 실장", 시도: "부산", 시군구: "사상구", 마감일: "2026-08-12" },
];

function ctx(overrides: Partial<ViewApplyContext<Row>> = {}): ViewApplyContext<Row> {
  return {
    currentUserId: "카뮈",
    teamMemberIds: ["카뮈", "이대표"],
    ownerOf: (r) => r.owner,
    cellOf: (r, key) => (r as unknown as Record<string, string>)[key] ?? null,
    idOf: (r) => r.id,
    ...overrides,
  };
}

function baseView(overrides: Partial<TabView> = {}): TabView {
  return {
    id: "v1",
    orgId: "org-1",
    boardKey: "new",
    ownerId: "카뮈",
    name: "테스트 뷰",
    kind: "flat",
    visibility: "private",
    personScope: "none",
    personScopeUserId: null,
    filters: {},
    sort: [],
    hiddenColumns: [],
    columnOrder: [],
    calendarFieldKey: null,
    createdAt: "2026-08-11T00:00:00Z",
    updatedAt: "2026-08-11T00:00:00Z",
    ...overrides,
  };
}

describe("applyView — D24 조회 범위가 뷰보다 먼저", () => {
  it("scopedRows 밖의 행은 뷰가 무엇이든 절대 나오지 않는다(입력에 없으므로 구조적으로 불가능)", () => {
    // 멤버 시나리오: 이미 본인 담당만 남긴 scopedRows (r1만 카뮈 담당)
    const scoped = ROWS.filter((r) => r.owner === "카뮈");
    const view = baseView({ filters: {} }); // "전체" 뷰로 열어도
    const result = applyView(scoped, view, ctx());
    expect(result.map((r) => r.id)).toEqual(["r1"]);
    expect(result.some((r) => r.id === "r2" || r.id === "r3")).toBe(false);
  });

  it("시스템 뷰(보드/표/캘린더)는 필터 없이 scopedRows 전체를 그대로 반환한다", () => {
    const result = applyView(ROWS, DEFAULT_SYSTEM_VIEW, ctx());
    expect(result).toHaveLength(3);
  });
});

describe("applyView — D26 «내 담당»은 보는 사람 기준", () => {
  const view = baseView({ personScope: "viewer" });

  it("보는 사람이 카뮈면 카뮈 담당 건만", () => {
    const result = applyView(ROWS, view, ctx({ currentUserId: "카뮈" }));
    expect(result.map((r) => r.id)).toEqual(["r1"]);
  });

  it("같은 뷰를 이대표가 보면 결과가 달라진다(저장된 사람이 아니라 지금 보는 사람)", () => {
    const result = applyView(ROWS, view, ctx({ currentUserId: "이대표" }));
    expect(result.map((r) => r.id)).toEqual(["r2"]);
  });

  it("내 팀 담당은 팀 멤버 목록으로 판정된다", () => {
    const teamView = baseView({ personScope: "team" });
    const result = applyView(ROWS, teamView, ctx({ currentUserId: "카뮈", teamMemberIds: ["카뮈", "이대표"] }));
    expect(result.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
  });

  it("fixed는 보는 사람과 무관하게 저장된 사람으로 고정된다", () => {
    const fixedView = baseView({ personScope: "fixed", personScopeUserId: "박정화 실장" });
    const asKarmus = applyView(ROWS, fixedView, ctx({ currentUserId: "카뮈" }));
    const asLee = applyView(ROWS, fixedView, ctx({ currentUserId: "이대표" }));
    expect(asKarmus.map((r) => r.id)).toEqual(["r3"]);
    expect(asLee.map((r) => r.id)).toEqual(["r3"]);
  });
});

describe("applyView — 지역 두 칸 필터 (260810 개정 ①)", () => {
  it("시도·시군구가 각각 독립 컬럼으로 필터된다", () => {
    const view = baseView({ filters: { 시도: ["서울"], 시군구: ["관악구"] } });
    const result = applyView(ROWS, view, ctx());
    expect(result.map((r) => r.id)).toEqual(["r1"]);
  });

  it("시도만 걸면 시군구 무관하게 매칭된다", () => {
    const view = baseView({ filters: { 시도: ["서울"] } });
    const result = applyView(ROWS, view, ctx());
    expect(result.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
  });
});

describe("applyView — 정렬", () => {
  it("정렬 컬럼 기준 오름차순, 동률은 원본 순서 유지(안정 정렬)", () => {
    const view = baseView({ sort: [{ columnKey: "마감일", direction: "asc" }] });
    const result = applyView(ROWS, view, ctx());
    expect(result.map((r) => r.id)).toEqual(["r2", "r1", "r3"]);
  });
});

describe("selectionTargetIds — D63 선택 N건 발송", () => {
  it("적용된 뷰 결과의 id 목록을 그대로 반환한다", () => {
    const view = baseView({ filters: { 시도: ["서울"] } });
    const filtered = applyView(ROWS, view, ctx());
    expect(selectionTargetIds(filtered, ctx().idOf)).toEqual(["r1", "r2"]);
  });
});

describe("hiddenByScopeCount", () => {
  it("전체 매칭 - 노출 매칭 = 숨김 건수", () => {
    expect(hiddenByScopeCount(5, 2)).toBe(3);
  });
  it("음수로 내려가지 않는다", () => {
    expect(hiddenByScopeCount(2, 2)).toBe(0);
  });
});

describe("splitByVisibility — D25 공용/나만", () => {
  it("공용은 전부, 나만은 본인 소유만 남는다", () => {
    const views: TabView[] = [
      baseView({ id: "shared-1", visibility: "shared", ownerId: "이대표" }),
      baseView({ id: "mine-1", visibility: "private", ownerId: "카뮈" }),
      baseView({ id: "other-private", visibility: "private", ownerId: "이대표" }),
    ];
    const { shared, private: mine } = splitByVisibility(views, "카뮈");
    expect(shared.map((v) => v.id)).toEqual(["shared-1"]);
    expect(mine.map((v) => v.id)).toEqual(["mine-1"]);
  });
});

describe("dynamicBadge — D26 표시", () => {
  it("viewer는 «나», team은 «내 팀», 그 외는 없음", () => {
    expect(dynamicBadge(baseView({ personScope: "viewer" }))).toBe("나");
    expect(dynamicBadge(baseView({ personScope: "team" }))).toBe("내 팀");
    expect(dynamicBadge(baseView({ personScope: "fixed", personScopeUserId: "x" }))).toBeNull();
    expect(dynamicBadge(baseView({ personScope: "none" }))).toBeNull();
    expect(dynamicBadge(DEFAULT_SYSTEM_VIEW)).toBeNull();
  });
});
