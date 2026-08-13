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
 *   ② 컬럼 22개가 목업 순서 그대로 · 맨 오른쪽 «컨택 이동» 고정
 *   ③ 셀을 고치면 저장되고, 다시 읽어도 남는다
 *   ④ 「상담 상황」을 바꾸면 카드가 그 그룹으로 옮겨간다 (6규칙 전부)
 */

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { GroupTable } from "@/components/board/GroupTable";
import { BoardToolbar } from "@/components/board/BoardToolbar";
import { EMPTY_FILTERS } from "@/components/board/filters";
import { BoardsService } from "@/lib/boards/service";
import { LocalBoardsRepo, toAsyncBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { resetDb } from "@/lib/repo/local/store";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import type { Ctx } from "@/lib/types";
import { NEW_LEAD_GROUPS, NEW_LEAD_TAB } from "./new-lead";
import { ensureDefaultTab } from "./install";

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
    sort_order: 0,
    created_at: "2026-08-12T00:00:00Z",
    updated_at: "2026-08-12T00:00:00Z",
    values: {},
  };
}

function renderTab(columns: BoardColumn[]) {
  return renderToStaticMarkup(
    <GroupTable
      boardId={boardId}
      groupId={null}
      columns={columns}
      rows={[emptyRow()]}
      readOnly={false}
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

describe("② 표 렌더 — 컬럼 22개와 고정 열", () => {
  it("22개 컬럼 라벨이 목업 순서 그대로 화면에 나온다", () => {
    const columns = repo.listColumns(ctx, boardId);
    const html = renderTab(columns);

    expect(columns).toHaveLength(22);
    // 마크업에서 라벨이 나타나는 순서가 목업 순서와 같아야 한다.
    const positions = NEW_LEAD_TAB.columns.map((column) => html.indexOf(`>${column.label}<`));
    for (const [index, position] of positions.entries()) {
      expect(position, `${NEW_LEAD_TAB.columns[index].label} 가 렌더되지 않았다`).toBeGreaterThan(-1);
    }
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("맨 오른쪽 «컨택 이동» 이 sticky 로 고정된다 — 가로 스크롤해도 보인다", () => {
    const html = renderTab(repo.listColumns(ctx, boardId));
    expect(html).toContain("sticky right-0");
  });

  it("✉ 발송 3칸은 편집창이 열리지 않는다 — 클릭해도 돈이 나가지 않는다", () => {
    const html = renderTab(repo.listColumns(ctx, boardId));
    for (const key of ["absence_notice", "consult1_notice", "confirm2_notice"]) {
      expect(html, key).not.toContain(`name="columnKey" value="${key}"`);
    }
    // 대조군 — 일반 입력 칸은 편집창이 있다. (없으면 위 단언이 무의미해진다)
    expect(html).toContain('name="columnKey" value="recontact_on"');
  });

  it("출처 배지 4종이 헤더에 뜬다 — 이 탭이 실제로 쓰는 것 (⟳ ✎ ▼ ✉)", () => {
    const html = renderTab(repo.listColumns(ctx, boardId));
    for (const mark of ["⟳", "✎", "▼", "✉"]) expect(html, mark).toContain(mark);
  });
});

describe("⑤ 필터는 칩 + 팝오버다 — 네이티브 select 나열 금지", () => {
  function renderToolbar() {
    return renderToStaticMarkup(
      <BoardToolbar
        columns={repo.listColumns(ctx, boardId)}
        filters={EMPTY_FILTERS}
        onChange={() => {}}
        matched={5}
        total={5}
        people={[]}
      />,
    );
  }

  it("네이티브 <select> 를 쓰지 않는다 (ui-guidelines 원칙 9)", () => {
    expect(renderToolbar()).not.toContain("<select");
  });

  it("「상담 상황」이 필터 칩으로 뜬다 — 이 탭의 핵심 필터다", () => {
    const html = renderToolbar();
    expect(html).toContain("상담 상황");
    // 팝오버 안에 선택지가 체크 옵션으로 들어 있다.
    for (const option of ["상담 전", "1차 부재", "거절"]) expect(html, option).toContain(option);
  });

  it("선택지를 가진 컬럼이 전부 칩이 된다 — status 타입도 포함", () => {
    const html = renderToolbar();
    for (const label of ["업종/업태", "피드백 상황", "컨택 이동", "시도"]) {
      expect(html, label).toContain(label);
    }
  });

  it("팝오버는 <details> 로 열고 닫는다 — 도구줄이 한 줄로 유지된다", () => {
    expect(renderToolbar()).toContain("<details");
  });
});

describe("③ 셀을 고치면 저장되고 다시 읽어도 남는다", () => {
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

  /**
   * 22칸 중 손으로 고칠 수 있는 것은 일부뿐이다 — 목업이 정한 «출처» 가 그것을 정한다.
   * `⟳ auto`("광고 폼에서 들어옴")는 사람이 타이핑하는 칸이 아니라서 서버가 쓰기를 막는다.
   * 대표자명·연락처·시도가 여기 속한다. 화면에서 안 열리는 게 맞다.
   */
  it("⟳ auto 칸은 손으로 못 고친다 — 광고 폼에서 들어오는 값이다", async () => {
    const item = repo.createItem(ctx, boardId, { title: "다전자 주식회사" });

    const result = await svc.setCells(ctx, boardId, item.id, { rep_name: "손입력" });

    expect(result.errors.length).toBeGreaterThan(0);
    expect((await new BoardsService(asyncRepo).getItem(ctx, boardId, item.id))?.values.rep_name).toBeUndefined();
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
