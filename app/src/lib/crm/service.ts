/**
 * core.crm 서비스 레이어 (T02).
 * 도메인 로직(수식·파이프라인·뷰) + 스토어(영속성)를 오케스트레이션한다.
 * API 라우트는 이 서비스만 호출한다.
 */

import type {
  Board,
  BoardColumn,
  CellValue,
  Item,
  ItemWithValues,
  PipelineStage,
  RequestContext,
  SavedView,
  ViewConfig,
} from "./types";
import type { CrmStore } from "./store";
import { DEFAULT_STAGES, computeStageMoveEffect } from "./pipeline";
import { DEFAULT_COLUMNS } from "./templates";
import { evaluateFormulas } from "./formulas";
import { applyView } from "./views";
import { ValidationError } from "./validation";

export class NotFoundError extends Error {
  constructor(message = "찾을 수 없습니다") {
    super(message);
    this.name = "NotFoundError";
  }
}

export interface BoardDetail {
  board: Board;
  stages: PipelineStage[];
  columns: BoardColumn[];
}

export interface ServiceOptions {
  /** 오늘 날짜(YYYY-MM-DD) 공급자 — 자동화 결정성. */
  today?: () => string;
}

export class CrmService {
  constructor(
    private readonly store: CrmStore,
    private readonly opts: ServiceOptions = {},
  ) {}

  private today(): string {
    return (this.opts.today ?? (() => new Date().toISOString().slice(0, 10)))();
  }

  // ── boards ────────────────────────────────────────────

  async createBoard(ctx: RequestContext, input: { name: string; description?: string }) {
    return this.store.createBoard(
      ctx.orgId,
      ctx.userId,
      input,
      DEFAULT_STAGES.map((s) => ({
        key: s.key,
        label: s.label,
        position: s.position,
        color: s.color,
        isTerminal: s.isTerminal,
      })),
      DEFAULT_COLUMNS.map((c) => ({
        key: c.key,
        title: c.title,
        type: c.type,
        position: c.position,
        settings: c.settings,
      })),
    );
  }

  listBoards(ctx: RequestContext) {
    return this.store.listBoards(ctx.orgId);
  }

  async getBoardDetail(ctx: RequestContext, boardId: string): Promise<BoardDetail> {
    const board = await this.store.getBoard(ctx.orgId, boardId);
    if (!board) throw new NotFoundError("보드를 찾을 수 없습니다");
    const [stages, columns] = await Promise.all([
      this.store.listStages(ctx.orgId, boardId),
      this.store.listColumns(ctx.orgId, boardId),
    ]);
    return { board, stages, columns };
  }

  async updateBoard(
    ctx: RequestContext,
    boardId: string,
    patch: { name?: string; description?: string; archived?: boolean },
  ) {
    const updated = await this.store.updateBoard(ctx.orgId, boardId, patch);
    if (!updated) throw new NotFoundError("보드를 찾을 수 없습니다");
    return updated;
  }

  async deleteBoard(ctx: RequestContext, boardId: string) {
    const ok = await this.store.deleteBoard(ctx.orgId, boardId);
    if (!ok) throw new NotFoundError("보드를 찾을 수 없습니다");
  }

  // ── items ─────────────────────────────────────────────

  private async stageByKey(
    ctx: RequestContext,
    boardId: string,
    key: string,
  ): Promise<PipelineStage> {
    const stages = await this.store.listStages(ctx.orgId, boardId);
    const stage = stages.find((s) => s.key === key);
    if (!stage) throw new ValidationError(`알 수 없는 단계: ${key}`);
    return stage;
  }

  private async compose(
    ctx: RequestContext,
    boardId: string,
    items: Item[],
  ): Promise<ItemWithValues[]> {
    if (items.length === 0) return [];
    const columns = await this.store.listColumns(ctx.orgId, boardId);
    const colById = new Map(columns.map((c) => [c.id, c]));
    const values = await this.store.listValues(
      ctx.orgId,
      items.map((i) => i.id),
    );
    const valuesByItem = new Map<string, Record<string, CellValue>>();
    for (const v of values) {
      const col = colById.get(v.columnId);
      if (!col) continue;
      const bag = valuesByItem.get(v.itemId) ?? {};
      bag[col.key] = v.value;
      valuesByItem.set(v.itemId, bag);
    }
    return items.map((it) => {
      const vals = valuesByItem.get(it.id) ?? {};
      return {
        ...it,
        values: vals,
        formulas: evaluateFormulas(columns, vals),
      };
    });
  }

  async createItem(
    ctx: RequestContext,
    boardId: string,
    input: { name: string; stageKey?: string; values?: Record<string, CellValue> },
  ): Promise<ItemWithValues> {
    const detail = await this.getBoardDetail(ctx, boardId);
    const stage = input.stageKey
      ? detail.stages.find((s) => s.key === input.stageKey)
      : detail.stages[0];
    if (input.stageKey && !stage) throw new ValidationError(`알 수 없는 단계: ${input.stageKey}`);
    const position = (await this.store.listItems(ctx.orgId, boardId)).length;
    const item = await this.store.createItem(ctx.orgId, ctx.userId, boardId, {
      name: input.name,
      stageId: stage?.id ?? null,
      position,
    });
    if (input.values && Object.keys(input.values).length > 0) {
      await this.store.setValues(ctx.orgId, item.id, input.values);
    }
    const [composed] = await this.compose(ctx, boardId, [item]);
    return composed;
  }

  async listItems(
    ctx: RequestContext,
    boardId: string,
    opts: { viewId?: string } = {},
  ): Promise<ItemWithValues[]> {
    await this.getBoardDetail(ctx, boardId); // 존재/스코프 확인
    const items = await this.store.listItems(ctx.orgId, boardId);
    const composed = await this.compose(ctx, boardId, items);
    if (!opts.viewId) return composed;
    const view = await this.store.getView(ctx.orgId, opts.viewId);
    if (!view || view.boardId !== boardId) throw new NotFoundError("뷰를 찾을 수 없습니다");
    const stages = await this.store.listStages(ctx.orgId, boardId);
    const stageKeyOf = (sid: string | null) => stages.find((s) => s.id === sid)?.key ?? null;
    return applyView(composed, view.config, stageKeyOf);
  }

  async getItem(ctx: RequestContext, itemId: string): Promise<ItemWithValues> {
    const item = await this.store.getItem(ctx.orgId, itemId);
    if (!item) throw new NotFoundError("아이템을 찾을 수 없습니다");
    const [composed] = await this.compose(ctx, item.boardId, [item]);
    return composed;
  }

  async updateItem(
    ctx: RequestContext,
    itemId: string,
    patch: { name?: string; values?: Record<string, CellValue> },
  ): Promise<ItemWithValues> {
    const item = await this.store.getItem(ctx.orgId, itemId);
    if (!item) throw new NotFoundError("아이템을 찾을 수 없습니다");
    if (patch.name !== undefined) {
      await this.store.updateItem(ctx.orgId, itemId, { name: patch.name });
    }
    if (patch.values && Object.keys(patch.values).length > 0) {
      await this.store.setValues(ctx.orgId, itemId, patch.values);
    }
    return this.getItem(ctx, itemId);
  }

  async deleteItem(ctx: RequestContext, itemId: string) {
    const ok = await this.store.deleteItem(ctx.orgId, itemId);
    if (!ok) throw new NotFoundError("아이템을 찾을 수 없습니다");
  }

  /** 파이프라인 단계 이동 + 자동화 부수효과 적용. */
  async moveItemStage(
    ctx: RequestContext,
    itemId: string,
    toStageKey: string,
  ): Promise<ItemWithValues> {
    const item = await this.store.getItem(ctx.orgId, itemId);
    if (!item) throw new NotFoundError("아이템을 찾을 수 없습니다");

    const stages = await this.store.listStages(ctx.orgId, item.boardId);
    const toStage = stages.find((s) => s.key === toStageKey);
    if (!toStage) throw new ValidationError(`알 수 없는 단계: ${toStageKey}`);
    const fromStage = stages.find((s) => s.id === item.stageId);

    const [current] = await this.compose(ctx, item.boardId, [item]);
    const effect = computeStageMoveEffect(
      toStage.key,
      fromStage?.isTerminal ?? false,
      current.values,
      this.today(),
    );

    await this.store.updateItem(ctx.orgId, itemId, {
      stageId: toStage.id,
      completedAt: effect.completedAt,
    });
    if (Object.keys(effect.columnPatches).length > 0) {
      await this.store.setValues(ctx.orgId, itemId, effect.columnPatches);
    }
    return this.getItem(ctx, itemId);
  }

  // ── saved views ───────────────────────────────────────

  async createView(
    ctx: RequestContext,
    boardId: string,
    input: { name: string; config: ViewConfig; isDefault?: boolean },
  ): Promise<SavedView> {
    await this.getBoardDetail(ctx, boardId);
    return this.store.createView(ctx.orgId, ctx.userId, boardId, {
      name: input.name,
      config: input.config,
      isDefault: input.isDefault ?? false,
    });
  }

  async listViews(ctx: RequestContext, boardId: string) {
    await this.getBoardDetail(ctx, boardId);
    return this.store.listViews(ctx.orgId, boardId);
  }

  async updateView(
    ctx: RequestContext,
    viewId: string,
    patch: { name?: string; config?: ViewConfig; isDefault?: boolean },
  ) {
    const updated = await this.store.updateView(ctx.orgId, viewId, patch);
    if (!updated) throw new NotFoundError("뷰를 찾을 수 없습니다");
    return updated;
  }

  async deleteView(ctx: RequestContext, viewId: string) {
    const ok = await this.store.deleteView(ctx.orgId, viewId);
    if (!ok) throw new NotFoundError("뷰를 찾을 수 없습니다");
  }
}
