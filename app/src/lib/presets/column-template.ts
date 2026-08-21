import type { Ctx } from "@/lib/types";
import type { Board, BoardColumn } from "@/lib/boards/types";
import type { BoardsRepo } from "@/lib/boards/store";

export const COLUMN_TEMPLATE_SOURCE = "user.section-preset/column-template/";

export type ColumnTemplateScope = "private" | "org";

export type ColumnTemplateMetadata = {
  description: string | null;
  required: boolean;
  validation: Record<string, unknown>;
  editPolicy: Record<string, unknown>;
  viewPolicy: Record<string, unknown>;
  summaryHidden: boolean;
  wrapMode: string;
};

export type ColumnTemplateRecord = {
  id: string;
  templateKey: string;
  name: string;
  scope: ColumnTemplateScope;
  ownerId: string;
  version: number;
  createdAt: string;
  column: BoardColumn;
  metadata: ColumnTemplateMetadata;
};

type SourceParts = Omit<ColumnTemplateRecord, "id" | "name" | "createdAt" | "column" | "metadata"> & {
  requestId: string;
};

function encoded(value: string): string {
  return encodeURIComponent(value);
}

export function columnTemplateSource(parts: SourceParts): string {
  return `${COLUMN_TEMPLATE_SOURCE}${encoded(parts.templateKey)}/${parts.scope}/${encoded(parts.ownerId)}/v${parts.version}/${encoded(parts.requestId)}`;
}

export function parseColumnTemplateSource(source: string | null | undefined): SourceParts | null {
  if (!source?.startsWith(COLUMN_TEMPLATE_SOURCE)) return null;
  const rest = source.slice(COLUMN_TEMPLATE_SOURCE.length).split("/");
  if (rest.length !== 5 || !/^v[1-9]\d*$/.test(rest[3])) return null;
  if (rest[1] !== "private" && rest[1] !== "org") return null;
  try {
    return {
      templateKey: decodeURIComponent(rest[0]),
      scope: rest[1],
      ownerId: decodeURIComponent(rest[2]),
      version: Number(rest[3].slice(1)),
      requestId: decodeURIComponent(rest[4]),
    };
  } catch {
    return null;
  }
}

export function isColumnTemplateSource(source: string | null | undefined): boolean {
  return parseColumnTemplateSource(source) !== null;
}

export function columnTemplateMetadata(column: BoardColumn): ColumnTemplateMetadata {
  const row = column as BoardColumn & {
    description?: string | null;
    is_required?: boolean;
    validation_jsonb?: Record<string, unknown>;
    edit_policy_jsonb?: Record<string, unknown>;
    view_policy_jsonb?: Record<string, unknown>;
    summary_hidden?: boolean;
    wrap_mode?: string;
  };
  return {
    description: row.description ?? null,
    required: Boolean(row.is_required),
    validation: row.validation_jsonb ?? {},
    editPolicy: row.edit_policy_jsonb ?? {},
    viewPolicy: row.view_policy_jsonb ?? {},
    summaryHidden: Boolean(row.summary_hidden),
    wrapMode: row.wrap_mode ?? "truncate",
  };
}

export function columnTemplatePayload(record: Pick<ColumnTemplateRecord, "column" | "metadata">) {
  return {
    key: record.column.key,
    label: record.column.label,
    type: record.column.type,
    source: record.column.source,
    position: Number.MAX_SAFE_INTEGER,
    description: record.metadata.description,
    required: record.metadata.required,
    validation: record.metadata.validation,
    editPolicy: record.metadata.editPolicy,
    viewPolicy: record.metadata.viewPolicy,
    summaryHidden: record.metadata.summaryHidden,
    wrapMode: record.metadata.wrapMode,
  };
}

export function previewColumnTemplate(template: ColumnTemplateRecord, target?: BoardColumn) {
  if (!target) return { mode: "create" as const, changes: ["새 컬럼으로 추가"], valueLossRisk: false };
  const before = columnTemplateMetadata(target);
  const changes = (Object.keys(template.metadata) as Array<keyof ColumnTemplateMetadata>)
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(template.metadata[key]));
  return {
    mode: "settings" as const,
    changes,
    typeMismatch: target.type !== template.column.type,
    valueLossRisk: false,
  };
}

export type ColumnTemplateBoardsRepo = BoardsRepo & { listSectionPresetBoards(ctx: Ctx): Promise<Board[]> };

function templateDescription(column: BoardColumn): string {
  return JSON.stringify({ kind: "column-template", metadata: columnTemplateMetadata(column) });
}

function metadataFromBoard(board: Board, column: BoardColumn): ColumnTemplateMetadata {
  try {
    const parsed = JSON.parse(board.description ?? "") as { kind?: string; metadata?: ColumnTemplateMetadata };
    if (parsed.kind === "column-template" && parsed.metadata) return parsed.metadata;
  } catch {
    // Older/incomplete records fail closed to the column defaults below.
  }
  return columnTemplateMetadata(column);
}

export class ColumnTemplateRepo {
  constructor(private readonly boards: ColumnTemplateBoardsRepo) {}

  async list(ctx: Ctx): Promise<ColumnTemplateRecord[]> {
    const boards = await this.boards.listSectionPresetBoards(ctx);
    const visible = boards.filter((board) => {
      const source = parseColumnTemplateSource(board.source);
      return source && (source.scope === "org" || source.ownerId === ctx.user.id);
    });
    const records = await Promise.all(visible.map(async (board) => this.fromBoard(ctx, board)));
    return records.filter((record): record is ColumnTemplateRecord => Boolean(record))
      .sort((a, b) => a.name.localeCompare(b.name) || b.version - a.version);
  }

  async get(ctx: Ctx, id: string): Promise<ColumnTemplateRecord | undefined> {
    const board = await this.boards.getBoard(ctx, id);
    const source = parseColumnTemplateSource(board?.source);
    if (!board || !source || (source.scope === "private" && source.ownerId !== ctx.user.id)) return undefined;
    return this.fromBoard(ctx, board);
  }

  async latest(ctx: Ctx, templateKey: string): Promise<ColumnTemplateRecord | undefined> {
    return (await this.list(ctx)).filter((record) => record.templateKey === templateKey)
      .sort((a, b) => b.version - a.version)[0];
  }

  async createVersion(ctx: Ctx, input: {
    templateKey: string; name: string; scope: ColumnTemplateScope; requestId: string;
    column: BoardColumn; version: number;
  }): Promise<ColumnTemplateRecord> {
    if (input.scope === "org" && ctx.role !== "owner" && ctx.role !== "admin") {
      throw new Error("ORG_PUBLISH_DENIED");
    }
    const source = columnTemplateSource({
      templateKey: input.templateKey, scope: input.scope, ownerId: ctx.user.id,
      version: input.version, requestId: input.requestId,
    });
    const stored = await this.boards.listSectionPresetBoards(ctx);
    const replay = stored.find((board) => board.source === source);
    if (replay) return (await this.fromBoard(ctx, replay))!;
    const versionExists = stored.some((board) => {
      const parsed = parseColumnTemplateSource(board.source);
      return parsed?.templateKey === input.templateKey && parsed.version === input.version;
    });
    if (versionExists) throw new Error("VERSION_CONFLICT");
    const board = await this.boards.createBoard(ctx, {
      name: input.name,
      description: templateDescription(input.column),
      source,
    });
    await this.boards.createColumn(ctx, board.id, {
      key: input.column.key, label: input.column.label, type: input.column.type,
      source: input.column.source, rightPinned: input.column.rightPinned,
      options: input.column.options_jsonb?.options ?? [], width: input.column.width,
      moveRule: input.column.move_rule_jsonb, readOnly: input.column.is_readonly,
    });
    return (await this.fromBoard(ctx, board))!;
  }

  async deleteAll(ctx: Ctx, templateKey: string): Promise<number> {
    const versions = (await this.list(ctx)).filter((record) => record.templateKey === templateKey);
    for (const version of versions) await this.boards.deleteBoard(ctx, version.id);
    return versions.length;
  }

  private async fromBoard(ctx: Ctx, board: Board): Promise<ColumnTemplateRecord | undefined> {
    const source = parseColumnTemplateSource(board.source);
    if (!source) return undefined;
    const columns = await this.boards.listColumns(ctx, board.id);
    if (columns.length !== 1) return undefined;
    return {
      id: board.id, templateKey: source.templateKey, name: board.name, scope: source.scope,
      ownerId: source.ownerId, version: source.version, createdAt: board.created_at,
      column: columns[0], metadata: metadataFromBoard(board, columns[0]),
    };
  }
}
