import type { Ctx } from "@/lib/types";
import type { FieldOption } from "@/lib/types";
import type { Board, BoardColumn, BoardGroup } from "@/lib/boards/types";
import type { BoardsRepo } from "@/lib/boards/store";

export const SECTION_PRESET_SOURCE = "user.section-preset/";
const COLUMN_TEMPLATE_SEGMENT = `${SECTION_PRESET_SOURCE}column-template/`;
export function isSectionPresetSource(source: string | null | undefined): boolean {
  return Boolean(source?.startsWith(SECTION_PRESET_SOURCE));
}

function isGroupSectionPresetSource(source: string | null | undefined): boolean {
  return Boolean(source?.startsWith(SECTION_PRESET_SOURCE) && !source.startsWith(COLUMN_TEMPLATE_SEGMENT));
}

export type SectionPresetBoardsRepo = BoardsRepo & { listSectionPresetBoards(ctx: Ctx): Promise<Board[]> };

export type SectionPresetColumn = Pick<BoardColumn, "key" | "label" | "type" | "source" | "rightPinned" | "width" | "move_rule_jsonb" | "is_readonly"> & {
  options: FieldOption[];
};
export type SectionPresetGroup = Pick<BoardGroup, "name" | "color">;

export interface SectionPresetRecord {
  id: string;
  name: string;
  groups: SectionPresetGroup[];
  columns: SectionPresetColumn[];
  created_at: string;
  /**
   * 이 프리셋을 담고 있는 템플릿 보드의 `source`(항상 `SECTION_PRESET_SOURCE` 로 시작).
   * 저장 요청마다 **결정적인** 값을 넣어 두면 같은 요청의 재전송을 여기서 알아볼 수 있다
   * (BBE-174 멱등성 — `lib/presets/group-preset.ts` 의 `groupPresetRequestSource`).
   */
  source: string | null;
}

export function snapshotSectionPreset(name: string, groups: BoardGroup[], columns: BoardColumn[]) {
  return {
    name: name.trim(),
    groups: groups.map(({ name: groupName, color }) => ({ name: groupName, color })),
    columns: columns.map((column) => ({
      key: column.key,
      label: column.label,
      type: column.type,
      source: column.source,
      rightPinned: column.rightPinned,
      options: column.options_jsonb?.options ?? [],
      width: column.width,
      move_rule_jsonb: column.move_rule_jsonb,
      is_readonly: column.is_readonly,
    })),
  };
}

export class SectionPresetRepo {
  constructor(private readonly boards: SectionPresetBoardsRepo) {}

  async list(ctx: Ctx): Promise<SectionPresetRecord[]> {
    const templates = (await this.boards.listSectionPresetBoards(ctx)).filter((board) => isGroupSectionPresetSource(board.source));
    return Promise.all(templates.map(async (board) => ({
      id: board.id,
      name: board.name,
      groups: (await this.boards.listGroups(ctx, board.id)).map(({ name, color }) => ({ name, color })),
      columns: (await this.boards.listColumns(ctx, board.id)).map((column) => snapshotSectionPreset("", [], [column]).columns[0]),
      created_at: board.created_at,
      source: board.source ?? null,
    })));
  }

  async get(ctx: Ctx, id: string): Promise<SectionPresetRecord | undefined> {
    const board = await this.boards.getBoard(ctx, id);
    if (!board || !isGroupSectionPresetSource(board.source)) return undefined;
    return {
      id: board.id,
      name: board.name,
      groups: (await this.boards.listGroups(ctx, id)).map(({ name, color }) => ({ name, color })),
      columns: (await this.boards.listColumns(ctx, id)).map((column) => snapshotSectionPreset("", [], [column]).columns[0]),
      created_at: board.created_at,
      source: board.source ?? null,
    };
  }

  /**
   * 같은 `source` 로 이미 저장된 프리셋. 저장 요청의 재전송(replay)을 알아보는 데 쓴다.
   * source 는 조직 안에서만 의미가 있으므로 조직 밖은 애초에 목록에 들어오지 않는다.
   */
  async findBySource(ctx: Ctx, source: string): Promise<SectionPresetRecord | undefined> {
    const templates = (await this.boards.listSectionPresetBoards(ctx)).filter((board) => isGroupSectionPresetSource(board.source));
    const match = templates.find((board) => board.source === source);
    return match ? this.get(ctx, match.id) : undefined;
  }

  /**
   * `source` 를 주면 그 값을 그대로 쓴다(멱등 저장). 주지 않으면 예전처럼 임의 UUID —
   * 기존 호출부(탭 단위 저장)의 동작을 바꾸지 않기 위해서다.
   */
  async create(
    ctx: Ctx,
    input: ReturnType<typeof snapshotSectionPreset>,
    source?: string,
  ): Promise<void> {
    const template = await this.boards.createBoard(ctx, {
      name: input.name,
      description: "아이템 프리셋 구조",
      source: source ?? `${SECTION_PRESET_SOURCE}${crypto.randomUUID()}`,
    });
    for (const group of input.groups) await this.boards.createGroup(ctx, template.id, group);
    for (const column of input.columns) await this.boards.createColumn(ctx, template.id, {
      key: column.key, label: column.label, type: column.type, source: column.source,
      rightPinned: column.rightPinned, options: column.options, width: column.width,
      moveRule: column.move_rule_jsonb, readOnly: column.is_readonly,
    });
  }

  async delete(ctx: Ctx, id: string): Promise<void> {
    const preset = await this.get(ctx, id);
    if (preset) await this.boards.deleteBoard(ctx, id);
  }
}
