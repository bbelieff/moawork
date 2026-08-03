import type { BoardFileValue } from "@/lib/boards/types";

export type LegacyCutoverStatus = "pending" | "applied_verified" | "rolled_back";

export interface LegacyDryRunResult {
  source: number;
  inserted: number;
  update: 0;
  unchanged: number;
  conflict: number;
  quarantine: number;
  missing: number;
  quarantine_reasons: Record<string, number>;
  sample: Array<{ ordinal: number; mapped: true }>;
  quarantine_sample: Array<{ ordinal: number; reason: string }>;
  schema_ok: boolean;
  schema_error_code: string | null;
  source_checksum: string;
  source_schema_fingerprint: string;
  target_schema_fingerprint: string;
}

export interface LegacyApplyResult extends LegacyDryRunResult {
  status: LegacyCutoverStatus;
  batch_id: string;
  target_checksum: string;
  replayed: boolean;
}

export interface LegacyDealFileRef {
  name?: unknown;
  mime_type?: unknown;
  size_bytes?: unknown;
  storage_path?: unknown;
  data_url?: unknown;
  [key: string]: unknown;
}

export type LegacyFileResult =
  | { ok: true; value: BoardFileValue[] | null }
  | { ok: false; reason: "inline_only" | "cross_org_path" | "malformed" };
