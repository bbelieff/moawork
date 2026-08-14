import { describe, expect, it } from "vitest";
import { calculateFields } from "@/lib/boards/calculations";
import { POLICYFUND_WORK_BOARD } from "@/lib/migration/monday-mapping/policyfund-work";
import { CONTRACT_WORK_TAB } from "./contract-work";
import { DEFAULT_TABS, ensureDefaultTab } from "./install";
import { LocalBoardsRepo, toAsyncBoardsRepo } from "@/lib/repo/local/boardsRepo";
import type { Ctx } from "@/lib/types";

const byLabel = new Map(CONTRACT_WORK_TAB.columns.map((column) => [column.label, column]));

it("registers the contract-work tab for default workspace installation", () => {
  expect(DEFAULT_TABS.map((tab) => tab.key)).toContain("work");
  expect(DEFAULT_TABS.find((tab) => tab.key === "work")).toBe(CONTRACT_WORK_TAB);
});

it("persists the 11 groups, 27 columns, and four resolved move targets", async () => {
  const ctx = {
    org: { id: "org-contract-work", name: "Test organization" },
    user: { id: "owner-contract-work", name: "Owner", email: "owner@example.test" },
    role: "owner",
    scope: "all",
  } as unknown as Ctx;
  const local = new LocalBoardsRepo();
  const result = await ensureDefaultTab(ctx, CONTRACT_WORK_TAB, toAsyncBoardsRepo(local));
  const groups = local.listGroups(ctx, result.boardId);
  const status = local.listColumns(ctx, result.boardId).find((column) => column.key === "progress_status");

  expect(groups).toHaveLength(11);
  expect(local.listColumns(ctx, result.boardId)).toHaveLength(27);
  expect(Object.keys(status?.move_rule_jsonb ?? {})).toHaveLength(4);
  expect(new Set(Object.values(status?.move_rule_jsonb ?? {}))).toEqual(
    new Set(groups.filter((group) => Object.values(CONTRACT_WORK_TAB.columns.find((column) => column.key === "progress_status")!.moveTo!).includes(group.name)).map((group) => group.id)),
  );
});

describe("BBE-150 계약업체 실무 기본 탭", () => {
  it("BBE-144 전량 구조를 축소하지 않는다", () => {
    expect(CONTRACT_WORK_TAB.groups).toHaveLength(11);
    expect(byLabel.get("진행기관")?.options).toHaveLength(18);
    expect(byLabel.get("진행 상품")?.options).toHaveLength(59);
    expect(byLabel.get("진행상항")?.options).toHaveLength(14);
  });

  it("전량 선택지와 그룹은 이관 매핑 사전과 내용·순서가 같다", () => {
    const mapped = (label: string) => POLICYFUND_WORK_BOARD.columns.find((column) => column.label === label)!;
    expect(CONTRACT_WORK_TAB.groups.map((group) => group.name.replace(/^\P{L}+/u, "").trim())).toEqual(
      POLICYFUND_WORK_BOARD.sections.map((section) => section.groupName.replace(/^\P{L}+/u, "").trim()),
    );
    expect(byLabel.get("진행기관")?.options?.map((option) => option.label)).toEqual(
      mapped("진행 기관").options?.map((option) => option.label),
    );
    expect(byLabel.get("진행 상품")?.options?.map((option) => option.label)).toEqual(
      mapped("진행 상품").options?.map((option) => option.label),
    );
    expect(byLabel.get("진행상항")?.options?.map((option) => option.label)).toEqual(
      mapped("진행상항").options?.map((option) => option.label),
    );
  });

  it("목업 순서의 27컬럼과 고정열을 보존한다", () => {
    expect(CONTRACT_WORK_TAB.columns.map((column) => column.label)).toEqual([
      "진행기관", "자금명", "담당자", "사업자유형", "창업년도", "연 매출액", "대표자명",
      "전화번호", "업종/업태", "시도", "시군구", "진행 상품", "진행상항", "방문 및 신청 일",
      "실사일", "예상 심사 종료", "ƒ심사 D-day", "실행액", "수수료(%)", "ƒ수수료(원)",
      "수수료_입금일", "ƒ총 매출액", "조달일", "ƒ재신청 안내일", "ƒD+180", "계약금", "계약금_입금일",
    ]);
    expect(CONTRACT_WORK_TAB.columns).toHaveLength(27);
    expect(CONTRACT_WORK_TAB.columns.filter((column) => column.rightPinned).map((column) => column.label)).toEqual(["진행상항"]);
  });

  it("lk 8개와 BBE-153 계산 5개는 화면·서버 계약 모두 읽기 전용이다", () => {
    const linked = CONTRACT_WORK_TAB.columns.filter((column) => column.source === "lk");
    const calculated = CONTRACT_WORK_TAB.columns.filter((column) => column.source === "calc");
    expect(linked).toHaveLength(8);
    expect(calculated.map((column) => column.key)).toEqual([
      "review_dday", "fee_amount", "total_revenue", "reapply_notice_date", "d180",
    ]);
    for (const column of [...linked, ...calculated]) expect(column.readOnly, column.label).toBe(true);
  });

  it("진행상항 자동 이동 4규칙이 전량 그룹을 가리킨다", () => {
    const moveTo = byLabel.get("진행상항")?.moveTo;
    expect(Object.keys(moveTo ?? {})).toEqual(["진행중", "심사 중", "승인", "불가"]);
    const groups = new Set(CONTRACT_WORK_TAB.groups.map((group) => group.name));
    for (const target of Object.values(moveTo ?? {})) expect(groups.has(target), target).toBe(true);
  });

  it("BBE-153 계산 key를 새 계산 없이 그대로 소비한다", () => {
    const values = calculateFields({
      executionAmount: 100_000_000,
      feePercent: 3,
      fundedOn: "2026-08-20",
      feePaidOn: "2026-08-01",
      reviewEndsOn: "2026-10-03",
    }, new Date("2026-08-13T00:00:00.000Z"), 7_000_000).values;
    for (const key of ["review_dday", "fee_amount", "total_revenue", "reapply_notice_date", "d180"] as const) {
      expect(byLabel.has(CONTRACT_WORK_TAB.columns.find((column) => column.key === key)!.label)).toBe(true);
      expect(values[key]).not.toBeUndefined();
    }
  });
});
