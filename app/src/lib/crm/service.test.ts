import { describe, it, expect, beforeEach } from "vitest";
import { CrmService, NotFoundError } from "./service";
import { InMemoryCrmStore } from "./store";
import { ValidationError } from "./validation";
import type { RequestContext } from "./types";

const ctx: RequestContext = { orgId: "org1", userId: "user1" };
const other: RequestContext = { orgId: "org2", userId: "user2" };
const TODAY = "2026-07-21";

function mkService() {
  let seq = 0;
  const store = new InMemoryCrmStore({
    genId: () => `id-${++seq}`,
    now: () => "2026-07-21T00:00:00.000Z",
  });
  const service = new CrmService(store, { today: () => TODAY });
  return { store, service };
}

describe("CrmService — 보드 프로비저닝", () => {
  it("보드 생성 시 기본 4단계 + 수식 포함 컬럼 세트가 붙는다", async () => {
    const { service } = mkService();
    const { board } = await service.createBoard(ctx, { name: "신규고객" });
    const detail = await service.getBoardDetail(ctx, board.id);
    expect(detail.stages.map((s) => s.key)).toEqual([
      "consulting",
      "awaiting_contract",
      "in_progress",
      "done",
    ]);
    const formulaCols = detail.columns.filter((c) => c.type === "formula").map((c) => c.key);
    expect(formulaCols).toEqual(["commission", "total_revenue", "d_plus_180", "d_plus_365"]);
  });

  it("다른 org 는 보드를 볼 수 없다(테넌트 격리)", async () => {
    const { service } = mkService();
    const { board } = await service.createBoard(ctx, { name: "신규고객" });
    await expect(service.getBoardDetail(other, board.id)).rejects.toThrow(NotFoundError);
    expect(await service.listBoards(other)).toEqual([]);
  });
});

describe("CrmService — 아이템 + 수식", () => {
  it("아이템 생성 시 첫 단계로 배치되고 수식이 계산된다", async () => {
    const { service } = mkService();
    const { board } = await service.createBoard(ctx, { name: "신규고객" });
    const item = await service.createItem(ctx, board.id, {
      name: "홍길동",
      values: { contract_amount: 100_000_000, commission_rate: 3, contract_date: "2026-07-21" },
    });
    expect(item.name).toBe("홍길동");
    expect(item.formulas.commission).toBe(3_000_000);
    expect(item.formulas.total_revenue).toBe(3_300_000);
    expect(item.formulas.d_plus_180).toBe("2027-01-17");
    expect(item.formulas.d_plus_365).toBe("2027-07-21");
  });

  it("값 갱신 시 수식이 재계산된다", async () => {
    const { service } = mkService();
    const { board } = await service.createBoard(ctx, { name: "b" });
    const item = await service.createItem(ctx, board.id, { name: "x" });
    expect(item.formulas.commission).toBeNull();
    const updated = await service.updateItem(ctx, item.id, {
      values: { contract_amount: 50_000_000, commission_rate: 4 },
    });
    expect(updated.formulas.commission).toBe(2_000_000);
  });

  it("알 수 없는 단계로 생성 시 검증 에러", async () => {
    const { service } = mkService();
    const { board } = await service.createBoard(ctx, { name: "b" });
    await expect(
      service.createItem(ctx, board.id, { name: "x", stageKey: "ghost" }),
    ).rejects.toThrow(ValidationError);
  });
});

describe("CrmService — 파이프라인 단계 이동 자동화", () => {
  it("진행중 진입 시 계약일이 오늘로 자동 세팅되고 D+180/365 가 생긴다", async () => {
    const { service } = mkService();
    const { board } = await service.createBoard(ctx, { name: "b" });
    const item = await service.createItem(ctx, board.id, {
      name: "x",
      values: { contract_amount: 100_000_000, commission_rate: 3 },
    });
    expect(item.values.contract_date).toBeUndefined();

    const moved = await service.moveItemStage(ctx, item.id, "in_progress");
    expect(moved.values.contract_date).toBe(TODAY);
    expect(moved.formulas.d_plus_180).toBe("2027-01-17");
  });

  it("완료 진입 시 completed_at 스탬프 + 완료일 세팅", async () => {
    const { service } = mkService();
    const { board } = await service.createBoard(ctx, { name: "b" });
    const item = await service.createItem(ctx, board.id, { name: "x" });
    const done = await service.moveItemStage(ctx, item.id, "done");
    expect(done.completedAt).toBe("2026-07-21T00:00:00.000Z");
    expect(done.values.completed_date).toBe(TODAY);
  });

  it("완료에서 이탈하면 completed_at 이 해제된다", async () => {
    const { service } = mkService();
    const { board } = await service.createBoard(ctx, { name: "b" });
    const item = await service.createItem(ctx, board.id, { name: "x" });
    await service.moveItemStage(ctx, item.id, "done");
    const back = await service.moveItemStage(ctx, item.id, "in_progress");
    expect(back.completedAt).toBeNull();
  });

  it("존재하지 않는 아이템 이동은 NotFound", async () => {
    const { service } = mkService();
    await expect(service.moveItemStage(ctx, "ghost", "done")).rejects.toThrow(NotFoundError);
  });
});

describe("CrmService — 저장뷰", () => {
  let service: CrmService;
  let boardId: string;

  beforeEach(async () => {
    const s = mkService();
    service = s.service;
    const { board } = await service.createBoard(ctx, { name: "b" });
    boardId = board.id;
    // 3건: 상담중 300 / 완료 100 / 완료 200
    const a = await service.createItem(ctx, boardId, {
      name: "a",
      values: { contract_amount: 300 },
    });
    const b = await service.createItem(ctx, boardId, {
      name: "b",
      values: { contract_amount: 100 },
    });
    const c = await service.createItem(ctx, boardId, {
      name: "c",
      values: { contract_amount: 200 },
    });
    await service.moveItemStage(ctx, b.id, "done");
    await service.moveItemStage(ctx, c.id, "done");
    void a;
  });

  it("단계 필터 + 금액 오름차순 정렬을 저장뷰로 적용", async () => {
    const view = await service.createView(ctx, boardId, {
      name: "완료건",
      config: {
        filters: [{ columnKey: "__stage__", operator: "eq", value: "done" }],
        sorts: [{ columnKey: "contract_amount", direction: "asc" }],
      },
    });
    const items = await service.listItems(ctx, boardId, { viewId: view.id });
    expect(items.map((i) => i.name)).toEqual(["b", "c"]);
  });

  it("뷰 없이 조회하면 전체(생성 순서)", async () => {
    const items = await service.listItems(ctx, boardId);
    expect(items.map((i) => i.name)).toEqual(["a", "b", "c"]);
  });

  it("다른 보드의 뷰 id 로 조회하면 NotFound", async () => {
    const { board: other2 } = await service.createBoard(ctx, { name: "other" });
    const v = await service.createView(ctx, other2.id, {
      name: "v",
      config: { filters: [], sorts: [] },
    });
    await expect(service.listItems(ctx, boardId, { viewId: v.id })).rejects.toThrow(NotFoundError);
  });
});
