/**
 * 신규리드 «한 탭» 관통 — 화면과 저장을 실제로 태워 보는 검증 (BBE-145).
 *
 * ⚠ **브라우저로 이 화면을 열지 못했다. 그래서 여기까지 한다.** 두 가지가 막는다:
 *   ① 로컬 (app) 셸의 D24 권한 게이트가 Supabase RPC(`effective_permission`)를 부르고,
 *      실패를 «불허» 로 수렴시킨다(`lib/perm/server.ts` — 의도된 fail-closed 보안 경계다).
 *      env 없는 로컬에서는 `/boards/[id]` 가 항상 404 다.
 *   ② 이 세션의 Browser pane 이 표시되지 않아 스크린샷 자체가 불가하다.
 *   → BBE-123 세션도 같은 벽에 부딪혀 같은 방식(마크업 직접 렌더)으로 남겼다.
 *      «눈으로 본 증거» 를 대신하지는 못한다. 도장에 NOT_RUN 으로 적고 넘긴다.
 *
 * 여기서 고정하는 것 — 관통 기준(설계도 §4-2) 중 기계로 잴 수 있는 전부:
 *   ② 컬럼 29개가 최신 사용자·실측 순서로 표시 · 맨 오른쪽 «컨택 이동» 고정
 *   ③ 셀을 고치면 저장되고, 다시 읽어도 남는다
 *   ④ 「상담 상황」을 바꾸면 카드가 그 그룹으로 옮겨간다 (6규칙 전부)
 */

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { GroupTable } from "@/components/board/GroupTable";
import { BoardToolbar } from "@/components/board/BoardToolbar";
import { EMPTY_FILTERS } from "@/components/board/filters";
import { presentNewLeadSavedFilters } from "@/lib/view/board-saved";
import { BoardsService } from "@/lib/boards/service";
import { LocalBoardsRepo, toAsyncBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { resetDb } from "@/lib/repo/local/store";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import type { Ctx } from "@/lib/types";
import { NEW_LEAD_GROUPS, NEW_LEAD_TAB, presentNewLeadColumns } from "./new-lead";
import { ensureDefaultTab } from "./install";
import { emptyOtherInfoValue, updateOtherInfoEntry } from "@/lib/boards/structured-field";

const ctx: Ctx = {
  org: { id: "org-render", name: "테스트 회사" },
  user: { id: "user-owner", name: "만든 사람", email: "owner@example.com" },
  role: "owner",
  scope: "all",
} as unknown as Ctx;

let repo: LocalBoardsRepo;
let asyncRepo: ReturnType<typeof toAsyncBoardsRepo>;
let svc: BoardsService;
let boardId: string;

beforeEach(async () => {
  resetDb();
  repo = new LocalBoardsRepo();
  asyncRepo = toAsyncBoardsRepo(repo);
  svc = new BoardsService(asyncRepo);
  boardId = (await ensureDefaultTab(ctx, NEW_LEAD_TAB, asyncRepo)).boardId;
});

function emptyRow(): ItemWithValues {
  return {
    id: "row-1",
    org_id: ctx.org.id,
    board_id: boardId,
    group_id: null,
    title: "가밸브 주식회사",
    assigned_to: null,
    deal_id: null,
    sort_order: 0,
    created_at: "2026-08-12T00:00:00Z",
    updated_at: "2026-08-12T00:00:00Z",
    values: {},
  };
}

function renderTab(columns: BoardColumn[], rows: ItemWithValues[] = [emptyRow()]) {
  return renderToStaticMarkup(
    <GroupTable
      boardId={boardId}
      groupId={null}
      columns={columns}
      rows={rows}
      readOnly={false}
      canonicalNewLead
      rowDragEnabled={false}
      cellFlash={null}
      onColumnDrop={() => {}}
      dragRowId={null}
      canDropRow={() => false}
      onRowDragStart={() => {}}
      onRowDragEnd={() => {}}
      onRowDrop={() => {}}
    />,
  );
}

describe("② 표 렌더 — 업무 컬럼과 고정 열", () => {
  it("40개 physical 열을 설치하고 합성·메시지·기타정보 presentation은 중복 없이 렌더한다", () => {
    const columns = repo.listColumns(ctx, boardId);
    const presented = presentNewLeadColumns(columns);
    const html = renderTab(presented);

    expect(columns).toHaveLength(40);
    expect(columns.filter((column) => column.key === "revenue_3y_million")).toHaveLength(1);
    expect(presented.filter((column) => column.key === "credit_scores")).toHaveLength(1);
    expect(presented.filter((column) => column.key === "revenue_3y_million")).toHaveLength(1);
    expect(presented.filter((column) => column.key === "other_info")).toHaveLength(1);
    expect(presented.some((column) => column.key === "credit_score_ncb" || column.key === "credit_score_kcb" || column.key === "revenue_band" || column.key === "closed_business" || column.key === "export_status")).toBe(false);
    // 마크업에서 presentation 라벨이 정본 순서대로 나타나야 한다.
    const positions = presented.map((column) => html.indexOf(`>${column.label}<`));
    for (const [index, position] of positions.entries()) {
      expect(position, `${presented[index].label} 가 렌더되지 않았다`).toBeGreaterThan(-1);
    }
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(html.match(/>신용점수</g)).toHaveLength(1);
    expect(html.match(/>3개년매출\(백만원\)</g)).toHaveLength(1);
    expect(html.match(/>기타정보</g)).toHaveLength(1);
  });

  it("맨 오른쪽 «컨택 이동» 이 sticky 로 고정된다 — 가로 스크롤해도 보인다", () => {
    const html = renderTab(presentNewLeadColumns(repo.listColumns(ctx, boardId)));
    expect(html).toContain("sticky right-0");
  });

  it("✉ 발송 3칸은 편집창이 열리지 않는다 — 클릭해도 돈이 나가지 않는다", () => {
    const html = renderTab(presentNewLeadColumns(repo.listColumns(ctx, boardId)));
    for (const key of ["absence_notice", "consult1_notice", "confirm2_notice"]) {
      expect(html, key).not.toContain(`name="columnKey" value="${key}"`);
    }
    // 대조군 — 일반 입력 칸은 편집창이 있다. (없으면 위 단언이 무의미해진다)
    expect(html).toContain('name="columnKey" value="recontact_on"');
  });

  it("출처 배지 4종이 헤더에 뜬다 — 이 탭이 실제로 쓰는 것 (⟳ ✎ ▼ ✉)", () => {
    const html = renderTab(presentNewLeadColumns(repo.listColumns(ctx, boardId)));
    for (const mark of ["⟳", "✎", "▼", "✉"]) expect(html, mark).toContain(mark);
  });
});

describe("⑤ 필터는 칩 + 팝오버다 — 네이티브 select 나열 금지", () => {
  /*
   * #655 — 필터 칩은 「필터」 패널 안으로 들어갔다. 원칙 9(칩+팝오버·네이티브 select 금지)는
   * 그대로이고 «어디에 서 있는가» 만 바뀌었다.
   *
   * ★ 걸린 필터가 하나라도 있으면 패널은 «기본으로 열린다»(#602 — 되살아난 필터는 보여야 한다).
   *   그래서 칩의 존재를 재는 시험은 그 상태로 그린다. 접힌 기본 상태는 따로 잰다.
   */
  const OPEN = { ...EMPTY_FILTERS, assignees: ["someone"] };

  function renderToolbar(filters = OPEN) {
    return renderToStaticMarkup(
      <BoardToolbar
        columns={repo.listColumns(ctx, boardId)}
        filters={filters}
        onChange={() => {}}
        matched={5}
        total={5}
        people={[]}
      />,
    );
  }

  it("아무것도 안 걸리면 필터는 접혀 있고 「필터」 버튼 하나만 선다 (#655)", () => {
    const html = renderToolbar(EMPTY_FILTERS);
    expect(html).toContain("필터");
    expect(html).toContain("찾기");
    expect(html).toContain("보기");
    expect(html).toContain("저장");
    // 접혔으므로 개별 필터 칩은 아직 서 있지 않다 — 줄이 길어지던 원인이 이것이었다.
    expect(html).not.toContain("상담 상황");
    // 없앤 것은 없다. 「보기」·「저장」은 접지 않는다.
    expect(html).toContain("정렬");
    expect(html).toContain("표시 컬럼");
    expect(html).toContain("뷰로 저장");
  });

  it("네이티브 <select> 를 쓰지 않는다 (ui-guidelines 원칙 9)", () => {
    expect(renderToolbar()).not.toContain("<select");
  });

  it("「상담 상황」이 필터 칩으로 뜬다 — 이 탭의 핵심 필터다", () => {
    const html = renderToolbar();
    expect(html).toContain("상담 상황");
    // 선택지는 body portal을 열었을 때만 렌더된다. 닫힌 서버 마크업에 중복 노출하지 않는다.
    for (const option of ["상담 전", "1차 부재", "거절"]) expect(html, option).not.toContain(option);
  });

  it("선택지를 가진 컬럼이 전부 칩이 된다 — status 타입도 포함", () => {
    const html = renderToolbar();
    for (const label of ["업종", "피드백 상황", "컨택 이동", "시도"]) {
      expect(html, label).toContain(label);
    }
  });

  it("팝오버는 dialog portal로 열고 닫는다 — 도구줄이 한 줄로 유지된다", () => {
    const html = renderToolbar();
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("<details");
  });

  it("기타정보 다섯 facet이 missing/false/true 칩으로 actual toolbar에 연결된다", () => {
    const html = renderToolbar();
    for (const label of ["폐업이력", "수출여부", "지재권", "보유인증", "다른사업자"]) {
      expect(html, label).toContain(label);
    }
    expect((html.match(/aria-haspopup="dialog"/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it("reload된 legacy revenue_band facet은 presentation toolbar에서 보이고 개별 해제할 수 있다", () => {
    const filters = presentNewLeadSavedFilters({
      ...EMPTY_FILTERS,
      byColumn: { revenue_band: ["10억~30억"] },
    });
    const html = renderToStaticMarkup(
      <BoardToolbar
        columns={presentNewLeadColumns(repo.listColumns(ctx, boardId))}
        filters={filters}
        onChange={() => {}}
        matched={1}
        total={5}
        people={[]}
        legacyFacetLabels={{ revenue_band: "기존 매출구간" }}
      />,
    );
    expect(filters.byColumn).toEqual({ revenue_band: ["10억~30억"] });
    expect(html).toContain("기존 매출구간");
    expect(html).toContain("10억~30억");
    expect(html).toContain('aria-label="기존 매출구간 필터 해제"');
  });
});

describe("③ 셀을 고치면 저장되고 다시 읽어도 남는다", () => {
  it("기타정보 strict 객체를 한 셀에 저장하고 reload·actual 표의 체크 수가 같다", async () => {
    const item = repo.createItem(ctx, boardId, { title: "기타정보 검증" });
    const value = updateOtherInfoEntry(emptyOtherInfoValue(), "intellectualProperty", {
      checked: true,
      text: "특허 2건",
    });
    expect((await svc.setCells(ctx, boardId, item.id, { other_info: value })).errors).toEqual([]);
    const reread = await new BoardsService(toAsyncBoardsRepo(new LocalBoardsRepo())).getItem(ctx, boardId, item.id);
    expect(reread.values.other_info).toEqual(value);
    const html = renderTab(presentNewLeadColumns(repo.listColumns(ctx, boardId)), [reread]);
    expect(html).toContain("기타정보 1건: 지재권 편집");
  });

  it("업종/업태를 저장하면 같은 값이 다시 읽힌다", async () => {
    const item = repo.createItem(ctx, boardId, { title: "가밸브 주식회사" });

    await svc.setCells(ctx, boardId, item.id, { industry: "제조업" });

    // 서비스를 새로 만들어 읽는다 — «새로고침» 에 해당하는 경로(저장소에서 다시 읽기).
    const reread = await new BoardsService(asyncRepo).getItem(ctx, boardId, item.id);
    expect(reread?.values.industry).toBe("제조업");
  });

  it("여러 칸을 고쳐도 각각 남는다", async () => {
    const item = repo.createItem(ctx, boardId, { title: "나물류 유한회사" });

    await svc.setCells(ctx, boardId, item.id, {
      industry: "운수업",
      recontact_on: "2026-09-01",
      contract_fee: 1200000,
    });

    const values = (await new BoardsService(asyncRepo).getItem(ctx, boardId, item.id))?.values;
    expect(values?.industry).toBe("운수업");
    expect(values?.recontact_on).toBe("2026-09-01");
    expect(values?.contract_fee).toBe(1200000);
  });

  it("⟳ 수집 칸은 출처를 보존하면서 사람이 정정해 저장할 수 있다", async () => {
    const item = repo.createItem(ctx, boardId, { title: "다전자 주식회사" });

    const result = await svc.setCells(ctx, boardId, item.id, { rep_name: "손입력" });

    expect(result.errors).toEqual([]);
    expect((await new BoardsService(asyncRepo).getItem(ctx, boardId, item.id))?.values.rep_name).toBe("손입력");
  });

  it("✉ 발송 칸은 서버에서도 쓰기가 거부된다 — 화면만 막으면 안 된다", async () => {
    const item = repo.createItem(ctx, boardId, { title: "다전자 주식회사" });

    const result = await svc.setCells(ctx, boardId, item.id, { absence_notice: "악성 부재" });

    expect(result.errors.length, "잠긴 칸인데 저장이 통과했다").toBeGreaterThan(0);
    expect((await new BoardsService(asyncRepo).getItem(ctx, boardId, item.id))?.values.absence_notice).toBeUndefined();
  });
});

describe("④ 「상담 상황」을 바꾸면 카드가 그 그룹으로 옮겨간다 (6규칙 전부)", () => {
  const CASES: ReadonlyArray<readonly [string, string]> = [
    ["상담 전", NEW_LEAD_GROUPS.fresh],
    ["1차 부재", NEW_LEAD_GROUPS.absent1],
    ["2차 상담예약", NEW_LEAD_GROUPS.consult2],
    ["2차 상담완료", NEW_LEAD_GROUPS.consult2],
    ["보류", NEW_LEAD_GROUPS.hold],
    ["거절", NEW_LEAD_GROUPS.rejected],
  ];

  for (const [value, expectedGroup] of CASES) {
    it(`상담 상황 = «${value}» → ${expectedGroup}`, async () => {
      const item = repo.createItem(ctx, boardId, { title: "가밸브 주식회사" });
      const groupName = new Map(repo.listGroups(ctx, boardId).map((group) => [group.id, group.name]));

      await svc.setCells(ctx, boardId, item.id, { consult_status: value });

      const moved = repo.getItem(ctx, item.id);
      expect(groupName.get(moved!.group_id!)).toBe(expectedGroup);
    });
  }

  it("옮겨간 뒤에도 그때까지 쌓인 값은 그대로다 (D78 — 정보가 쌓인다)", async () => {
    const item = repo.createItem(ctx, boardId, { title: "라건설 주식회사" });
    await svc.setCells(ctx, boardId, item.id, { industry: "건설업", contract_fee: 500000 });

    await svc.setCells(ctx, boardId, item.id, { consult_status: "거절" });

    const after = await new BoardsService(asyncRepo).getItem(ctx, boardId, item.id);
    expect(after?.values.industry).toBe("건설업");
    expect(after?.values.contract_fee).toBe(500000);
    expect(after?.values.consult_status).toBe("거절");
  });

  it("이동 규칙이 없는 값은 카드를 옮기지 않는다", async () => {
    const item = repo.createItem(ctx, boardId, { title: "마포장 주식회사" });
    await svc.setCells(ctx, boardId, item.id, { consult_status: "거절" });
    const rejected = repo.getItem(ctx, item.id)!.group_id;

    // 「컨택 이동」에는 그룹 이동 규칙이 없다 — 그 열의 일은 탭 넘김이다.
    await svc.setCells(ctx, boardId, item.id, { contact_move: "컨택 대기" });

    expect(repo.getItem(ctx, item.id)!.group_id).toBe(rejected);
  });
});
