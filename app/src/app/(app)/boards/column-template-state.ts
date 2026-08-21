import type { ColumnTemplateRecord } from "@/lib/presets/column-template";

export type ColumnTemplateActionState = {
  ok: boolean;
  message: string | null;
  templates: ColumnTemplateRecord[];
};

export const INITIAL_COLUMN_TEMPLATE_STATE: ColumnTemplateActionState = { ok: true, message: null, templates: [] };
