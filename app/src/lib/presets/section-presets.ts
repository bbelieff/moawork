import type { Ctx } from "@/lib/types";
import type { FieldOption } from "@/lib/types";
import type { Board, BoardColumn, BoardGroup } from "@/lib/boards/types";
import type { BoardsRepo } from "@/lib/boards/store";

export const SECTION_PRESET_SOURCE = "user.section-preset/";
export function isSectionPresetSource(source: string | null | undefined): boolean {
  return Boolean(source?.startsWith(SECTION_PRESET_SOURCE));
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
    const templates = await this.boards.listSectionPresetBoards(ctx);
    return Promise.all(templates.map(async (board) => ({
      id: board.id,
      name: board.name,
      groups: (await this.boards.listGroups(ctx, board.id)).map(({ name, color }) => ({ name, color })),
      columns: (await this.boards.listColumns(ctx, board.id)).map((column) => snapshotSectionPreset("", [], [column]).columns[0]),
      created_at: board.created_at,
    })));
  }

  async get(ctx: Ctx, id: string): Promise<SectionPresetRecord | undefined> {
    const board = await this.boards.getBoard(ctx, id);
    if (!board?.source?.startsWith(SECTION_PRESET_SOURCE)) return undefined;
    return {
      id: board.id,
      name: board.name,
      groups: (await this.boards.listGroups(ctx, id)).map(({ name, color }) => ({ name, color })),
      columns: (await this.boards.listColumns(ctx, id)).map((column) => snapshotSectionPreset("", [], [column]).columns[0]),
      created_at: board.created_at,
    };
  }

  async create(ctx: Ctx, input: ReturnType<typeof snapshotSectionPreset>): Promise<void> {
    const template = await this.boards.createBoard(ctx, {
      name: input.name,
      description: "아이템 프리셋 구조",
      source: `${SECTION_PRESET_SOURCE}${crypto.randomUUID()}`,
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
