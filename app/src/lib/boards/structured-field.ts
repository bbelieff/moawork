export const OTHER_INFO_KEYS = [
  "closedHistory",
  "export",
  "intellectualProperty",
  "certifications",
  "otherBusinesses",
] as const;

export const OTHER_INFO_COLUMN_KEY = "other_info";
export const OTHER_INFO_FACET_PREFIX = "__other_info_facet__:";

export type OtherInfoKey = (typeof OTHER_INFO_KEYS)[number];

export const OTHER_INFO_LABELS: Record<OtherInfoKey, string> = {
  closedHistory: "폐업이력",
  export: "수출여부",
  intellectualProperty: "지재권",
  certifications: "보유인증",
  otherBusinesses: "다른사업자",
};

export interface OtherInfoEntry {
  checked: boolean;
  text: string;
}

export type OtherInfoValue = {
  version: 1;
} & Record<OtherInfoKey, OtherInfoEntry>;

export interface OtherInfoLegacyInput {
  closed_business?: unknown;
  export_status?: unknown;
}

export function otherInfoLegacyFromValues(values: Readonly<Record<string, unknown>>): OtherInfoLegacyInput {
  return {
    closed_business: values.closed_business,
    export_status: values.export_status,
  };
}

export type OtherInfoFacetState = "missing" | "false" | "true";
export type OtherInfoFacetSelection = Partial<Record<OtherInfoKey, readonly OtherInfoFacetState[]>>;

export interface OtherInfoProjection {
  value: OtherInfoValue;
  source: "missing" | "structured" | "legacy";
  present: Readonly<Record<OtherInfoKey, boolean>>;
}

const EMPTY_PRESENT: Record<OtherInfoKey, boolean> = {
  closedHistory: false,
  export: false,
  intellectualProperty: false,
  certifications: false,
  otherBusinesses: false,
};

function emptyEntry(): OtherInfoEntry {
  return { checked: false, text: "" };
}

export function emptyOtherInfoValue(): OtherInfoValue {
  return {
    version: 1,
    closedHistory: emptyEntry(),
    export: emptyEntry(),
    intellectualProperty: emptyEntry(),
    certifications: emptyEntry(),
    otherBusinesses: emptyEntry(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function readEntry(value: unknown): OtherInfoEntry | null {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["checked", "text"])
    || typeof value.checked !== "boolean"
    || typeof value.text !== "string"
  ) return null;
  return {
    checked: value.checked,
    text: value.text,
  };
}

/** Strict durable boundary: version 1, exactly five entries, no future/partial keys. */
export function parseOtherInfoValue(input: unknown): OtherInfoValue | null {
  if (
    !isRecord(input)
    || input.version !== 1
    || !hasExactKeys(input, ["version", ...OTHER_INFO_KEYS])
  ) return null;
  const entries = OTHER_INFO_KEYS.map((key) => readEntry(input[key]));
  if (!entries.every((entry): entry is OtherInfoEntry => entry !== null)) return null;
  const value = emptyOtherInfoValue();
  OTHER_INFO_KEYS.forEach((key, index) => { value[key] = entries[index]; });
  return value;
}

export function isOtherInfoValue(input: unknown): input is OtherInfoValue {
  return parseOtherInfoValue(input) !== null;
}

interface LegacyText {
  original: string;
  normalized: string;
}

function legacyText(value: unknown): LegacyText | null {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized ? { original: value, normalized } : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    const text = String(value);
    return { original: text, normalized: text };
  }
  return null;
}

function projectLegacyEntry(value: unknown, checkedValues: ReadonlySet<string>): OtherInfoEntry | null {
  const text = legacyText(value);
  if (text === null) return null;
  return { checked: checkedValues.has(text.normalized), text: text.original };
}

const CLOSED_HISTORY_TRUE = new Set(["폐업", "폐업 이력 있음", "있음", "true"]);
const EXPORT_TRUE = new Set(["수출 중", "수출 예정", "수출 있음", "있음", "true"]);

/**
 * Reads the additive v1 object without erasing incomplete or historical rows.
 * Legacy select values are projected for display/filtering only; this helper never
 * claims that a projected value has been migrated.
 */
export function projectOtherInfoValue(
  input: unknown,
  legacy: OtherInfoLegacyInput = {},
): OtherInfoProjection {
  const value = emptyOtherInfoValue();
  const present = { ...EMPTY_PRESENT };
  let hasStructuredEntry = false;

  const structured = parseOtherInfoValue(input);
  if (structured) {
    OTHER_INFO_KEYS.forEach((key) => {
      value[key] = structured[key];
      present[key] = true;
    });
    hasStructuredEntry = true;
  }

  if (hasStructuredEntry) {
    return { value, source: "structured", present };
  }

  const closedHistory = projectLegacyEntry(legacy.closed_business, CLOSED_HISTORY_TRUE);
  const exportEntry = projectLegacyEntry(legacy.export_status, EXPORT_TRUE);
  if (closedHistory) {
    value.closedHistory = closedHistory;
    present.closedHistory = true;
  }
  if (exportEntry) {
    value.export = exportEntry;
    present.export = true;
  }

  return {
    value,
    source: closedHistory || exportEntry ? "legacy" : "missing",
    present,
  };
}

export function otherInfoFacetFilterKey(columnKey: string, key: OtherInfoKey): string {
  return `${OTHER_INFO_FACET_PREFIX}${encodeURIComponent(columnKey)}:${key}`;
}

export function parseOtherInfoFacetFilterKey(key: string): { columnKey: string; facetKey: OtherInfoKey } | null {
  if (!key.startsWith(OTHER_INFO_FACET_PREFIX)) return null;
  const payload = key.slice(OTHER_INFO_FACET_PREFIX.length);
  const separator = payload.lastIndexOf(":");
  if (separator <= 0) return null;
  const candidate = payload.slice(separator + 1);
  if (!OTHER_INFO_KEYS.includes(candidate as OtherInfoKey)) return null;
  try {
    const columnKey = decodeURIComponent(payload.slice(0, separator));
    return columnKey ? { columnKey, facetKey: candidate as OtherInfoKey } : null;
  } catch {
    return null;
  }
}

export function otherInfoSearchText(input: unknown, legacy?: OtherInfoLegacyInput): string {
  const projection = projectOtherInfoValue(input, legacy);
  return OTHER_INFO_KEYS.flatMap((key) => {
    const entry = projection.value[key];
    return [OTHER_INFO_LABELS[key], entry.checked ? "체크" : "미체크", entry.text];
  }).join(" ");
}

export function checkedOtherInfoCount(input: unknown, legacy?: OtherInfoLegacyInput): number {
  const { value } = projectOtherInfoValue(input, legacy);
  return OTHER_INFO_KEYS.reduce((count, key) => count + Number(value[key].checked), 0);
}

export function otherInfoCountLabel(input: unknown, legacy?: OtherInfoLegacyInput): string {
  return `${checkedOtherInfoCount(input, legacy)}건`;
}

/** Lossless human-readable detail/export projection; unchecked text is intentionally retained. */
export function otherInfoDetailText(input: unknown, legacy?: OtherInfoLegacyInput): string {
  const projection = projectOtherInfoValue(input, legacy);
  const entries = OTHER_INFO_KEYS.map((key) => {
    if (!projection.present[key]) return `${OTHER_INFO_LABELS[key]}=값 없음`;
    const entry = projection.value[key];
    const state = entry.checked ? "체크" : "미체크";
    return `${OTHER_INFO_LABELS[key]}=${state}${entry.text ? `(${entry.text})` : ""}`;
  });
  return `${otherInfoCountLabel(input, legacy)} · ${entries.join(" · ")}`;
}

export function otherInfoFacetState(
  input: unknown,
  key: OtherInfoKey,
  legacy?: OtherInfoLegacyInput,
): OtherInfoFacetState {
  const projection = projectOtherInfoValue(input, legacy);
  if (!projection.present[key]) return "missing";
  return projection.value[key].checked ? "true" : "false";
}

export function matchesOtherInfoFacet(
  input: unknown,
  key: OtherInfoKey,
  selected: readonly OtherInfoFacetState[],
  legacy?: OtherInfoLegacyInput,
): boolean {
  if (selected.length === 0) return true;
  return selected.includes(otherInfoFacetState(input, key, legacy));
}

/** Same-facet states are ORed; separate facets are ANDed. */
export function matchesOtherInfoFacets(
  input: unknown,
  selection: OtherInfoFacetSelection,
  legacy?: OtherInfoLegacyInput,
): boolean {
  return OTHER_INFO_KEYS.every((key) => {
    const selected = selection[key] ?? [];
    return matchesOtherInfoFacet(input, key, selected, legacy);
  });
}

export function updateOtherInfoEntry(
  value: OtherInfoValue,
  key: OtherInfoKey,
  patch: Partial<OtherInfoEntry>,
): OtherInfoValue {
  return {
    ...value,
    [key]: {
      ...value[key],
      ...patch,
    },
  };
}
