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

it("persists the 11 groups, 28 columns, and four resolved move targets", async () => {
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
  expect(local.listColumns(ctx, result.boardId)).toHaveLength(28);
  expect(Object.keys(status?.move_rule_jsonb ?? {})).toHaveLength(4);
  expect(new Set(Object.values(status?.move_rule_jsonb ?? {}))).toEqual(
    new Set(groups.filter((group) => Object.values(CONTRACT_WORK_TAB.columns.find((column) => column.key === "progress_status")!.moveTo!).includes(group.name)).map((group) => group.id)),
  );
});

describe("BBE-150 계약업체 실무 기본 탭", () => {
  it("BBE-144 전량 구조를 축소하지 않는다", () => {
    expect(CONTRACT_WORK_TAB.groups).toHaveLength(11);
    expect(byLabel.get("진행기관")?.options).toHaveLength(18);
    expect(byLabel.get("세부명칭")?.options).toHaveLength(59);
    expect(byLabel.get("진행상황")?.options).toHaveLength(14);
  });

  it("전량 선택지와 그룹은 이관 매핑 사전과 내용·순서가 같다", () => {
    const mapped = (label: string) => POLICYFUND_WORK_BOARD.columns.find((column) => column.label === label)!;
    expect(CONTRACT_WORK_TAB.groups.map((group) => group.name.replace(/^\P{L}+/u, "").trim())).toEqual(
      POLICYFUND_WORK_BOARD.sections.map((section) => section.groupName.replace(/^\P{L}+/u, "").trim()),
    );
    expect(byLabel.get("진행기관")?.options?.map((option) => option.label)).toEqual(
      mapped("진행 기관").options?.map((option) => option.label),
    );
    expect(byLabel.get("세부명칭")?.options?.map((option) => option.label)).toEqual(
      mapped("진행 상품").options?.map((option) => option.label),
    );
    // 좌변은 제품 라벨(«진행상황»), 우변은 먼데이 사전의 조회 키(«진행상항») 다. 이 한 줄이
    // 두 어휘가 만나는 이음매이며, 우변을 «고치면» 사전 조회가 깨진다.
    expect(byLabel.get("진행상황")?.options?.map((option) => option.label)).toEqual(
      mapped("진행상항").options?.map((option) => option.label),
    );
  });

  // 2026-08-20 총괄 직접 지시: 맨 앞에 «구분» 이 붙고 자금명→상품명칭 · 진행 상품→세부명칭 으로
  // 이름이 바뀌었다(28컬럼). key 는 그대로다 — 아래 key 배열이 그 사실을 못박는다.
  // 같은 날 지시 3건이 더 얹혔다: 담당자를 맨 앞으로, 세부명칭을 상품명칭 바로 뒤로,
  // 라벨 «진행상항»→«진행상황». 14번 자리(진행상황)와 그 뒤 순서는 그대로다 — 4·13번을 빼서
  // 1·5번에 다시 꽂았을 뿐이라 뒤쪽은 밀리지 않는다.
  it("총괄 지시 순서의 28컬럼과 고정열을 보존한다", () => {
    expect(CONTRACT_WORK_TAB.columns.map((column) => column.label)).toEqual([
      "담당자", "구분", "진행기관", "상품명칭", "세부명칭", "사업자유형", "창업년도", "연 매출액",
      "대표자명", "전화번호", "업종/업태", "시도", "시군구", "진행상황", "방문 및 신청 일",
      // ★ 2026-08-25 총괄 직접 지시 — 「수수료율을 계약조건으로 하자」. 20번 자리가 바뀌었다.
      //   컬럼을 빼지 않고 «그 자리에서» 바꿨으므로 28개와 순서는 그대로다(구조 축소 아님).
      "실사일", "예상 심사 종료", "ƒ심사 D-day", "실행액", "계약조건", "ƒ수수료(원)",
      "수수료_입금일", "ƒ총 매출액", "조달일", "ƒ재신청 안내일", "ƒD+180", "계약금", "계약금_입금일",
    ]);
    expect(CONTRACT_WORK_TAB.columns).toHaveLength(28);
    expect(CONTRACT_WORK_TAB.columns.filter((column) => column.rightPinned).map((column) => column.label)).toEqual(["진행상황"]);
  });

  it("이름이 바뀌어도 key 는 얼어 있다 — key 를 바꾸면 기존 셀 값이 고아가 된다", () => {
    const byKey = new Map(CONTRACT_WORK_TAB.columns.map((column) => [column.key, column.label]));
    // `item_values` 는 (item_id, column_key) 로만 묶여 있고 board_columns 로의 FK 가 없다
    // (003_boards_engine.sql:64-70). 라벨과 key 가 어긋난 것은 «의도» 다.
    expect(byKey.get("fund_name")).toBe("상품명칭");
    expect(byKey.get("product")).toBe("세부명칭");
    expect(byKey.get("institution")).toBe("진행기관");
    // 새로 붙은 «구분» 만 새 key 다 — 되살릴 기존 값이 없으므로 고아 걱정이 없다.
    expect(byKey.get("engagement_kind")).toBe("구분");
    // ★ 2026-08-25 «계약조건» 은 이 규칙의 **의도된 예외** 다.
    //   위 셋(fund_name·product·institution)은 «같은 것을 다르게 부르기» 라서 key 를 지켰다.
    //   이건 «다른 것» 이다 — 숫자 3(=3%)을 계약조건 텍스트로 읽으면 «3» 이라는 계약조건이
    //   되어 조용히 거짓이 된다. 그래서 옛 key(fee_percent)를 버리고 값을 고아로 만든다.
    expect(byKey.get("fee_terms")).toBe("계약조건");
    expect(byKey.has("fee_percent"), "옛 % key 가 남아 있으면 두 개념이 공존한다").toBe(false);
    // 2026-08-20 지시로 «담당자» 가 맨 앞이고 «구분» 이 그 다음이다. 둘 다 key 는 그대로다.
    expect(CONTRACT_WORK_TAB.columns[0]?.key).toBe("owner");
    expect(CONTRACT_WORK_TAB.columns[1]?.key).toBe("engagement_kind");
    expect(CONTRACT_WORK_TAB.columns[4]?.key).toBe("product");
    expect(byLabel.get("구분")?.options?.map((option) => option.label)).toEqual(["자금", "지원금", "인증", "기타용역"]);
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

  it("진행상황 자동 이동 4규칙이 전량 그룹을 가리킨다", () => {
    const moveTo = byLabel.get("진행상황")?.moveTo;
    expect(Object.keys(moveTo ?? {})).toEqual(["진행중", "심사 중", "승인", "불가"]);
    const groups = new Set(CONTRACT_WORK_TAB.groups.map((group) => group.name));
    for (const target of Object.values(moveTo ?? {})) expect(groups.has(target), target).toBe(true);
  });

  it("BBE-153 계산 key를 새 계산 없이 그대로 소비한다", () => {
    const values = calculateFields({
      executionAmount: 100_000_000,
      // #544 — 수수료 금액의 근거가 «실행액 × %» 에서 «원장» 으로 바뀌었다.
      ledgerFeeTotal: 3_000_000,
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
