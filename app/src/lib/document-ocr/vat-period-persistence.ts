export const VAT_PERIOD_RPC = {
  read: "list_board_item_vat_periods",
  confirm: "confirm_board_item_vat_periods",
} as const;

export type VatPeriodInput = Readonly<{
  periodStart: string;
  periodEnd: string;
  salesAmount: string;
}>;

export type VatPeriodConfirmationInput = Readonly<{
  sourceFileId: string;
  documentBizNo: string;
  periods: readonly VatPeriodInput[];
}>;

export type PersistedVatPeriod = VatPeriodInput & Readonly<{
  sourceFileId: string;
  appliedVersion: number;
}>;

export type VatPeriodSnapshot = Readonly<{
  version: number;
  replayed: boolean;
  periods: readonly PersistedVatPeriod[];
}>;

type JsonRecord = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function date(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function amount(value: unknown): string | null {
  const text = typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === "string" ? value : "";
  return /^(0|[1-9]\d*)$/.test(text) ? text : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function field(row: JsonRecord, camel: string, snake: string): unknown {
  return row[camel] ?? row[snake];
}

export function normalizeVatPeriodConfirmation(
  value: VatPeriodConfirmationInput,
): VatPeriodConfirmationInput | null {
  const documentBizNo = value.documentBizNo.replace(/\D/g, "");
  if (!UUID.test(value.sourceFileId) || documentBizNo.length !== 10 || value.periods.length === 0) return null;

  const seen = new Set<string>();
  const periods: VatPeriodInput[] = [];
  for (const input of value.periods) {
    const periodStart = date(input.periodStart);
    const periodEnd = date(input.periodEnd);
    const salesAmount = amount(input.salesAmount);
    if (!periodStart || !periodEnd || !salesAmount || periodStart > periodEnd) return null;
    const key = `${periodStart}:${periodEnd}`;
    if (seen.has(key)) return null;
    seen.add(key);
    periods.push({ periodStart, periodEnd, salesAmount });
  }

  periods.sort((left, right) =>
    left.periodStart.localeCompare(right.periodStart) || left.periodEnd.localeCompare(right.periodEnd)
  );
  return { sourceFileId: value.sourceFileId, documentBizNo, periods };
}

export function parseVatPeriodSnapshot(value: unknown): VatPeriodSnapshot | null {
  const source = Array.isArray(value) && value.length === 1 ? value[0] : value;
  const row = record(source);
  if (!row) return null;
  const version = integer(row.version);
  const rows = row.periods;
  if (version === null || typeof row.replayed !== "boolean" || !Array.isArray(rows)) return null;

  const periods: PersistedVatPeriod[] = [];
  const seen = new Set<string>();
  for (const value of rows) {
    const period = record(value);
    if (!period) return null;
    const periodStart = date(field(period, "periodStart", "period_start"));
    const periodEnd = date(field(period, "periodEnd", "period_end"));
    const salesAmount = amount(field(period, "salesAmount", "sales_amount"));
    const sourceFileId = field(period, "sourceFileId", "source_file_id");
    const appliedVersion = integer(field(period, "appliedVersion", "applied_version"));
    if (
      !periodStart || !periodEnd || periodStart > periodEnd || !salesAmount ||
      typeof sourceFileId !== "string" || !UUID.test(sourceFileId) || appliedVersion === null
    ) return null;
    const key = `${periodStart}:${periodEnd}`;
    if (seen.has(key)) return null;
    seen.add(key);
    periods.push({ periodStart, periodEnd, salesAmount, sourceFileId, appliedVersion });
  }

  periods.sort((left, right) =>
    left.periodStart.localeCompare(right.periodStart) || left.periodEnd.localeCompare(right.periodEnd)
  );
  return { version, replayed: row.replayed, periods };
}
