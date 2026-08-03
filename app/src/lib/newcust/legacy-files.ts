import type { LegacyDealFileRef, LegacyFileResult } from "./legacy-types";

const SAFE_KEYS = new Set(["name", "mime_type", "size_bytes", "storage_path", "data_url", "id", "uploaded_by", "created_at"]);

export function normalizeLegacyFiles(orgId: string, raw: unknown): LegacyFileResult {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (!Array.isArray(raw)) return { ok: false, reason: "malformed" };
  const prefix = `${orgId}/`;
  const value = [];
  const paths = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return { ok: false, reason: "malformed" };
    const file = entry as LegacyDealFileRef;
    if (Object.keys(file).some((key) => !SAFE_KEYS.has(key))) return { ok: false, reason: "malformed" };
    if (typeof file.storage_path !== "string" || file.storage_path.length === 0) {
      return { ok: false, reason: file.data_url ? "inline_only" : "malformed" };
    }
    if (!file.storage_path.startsWith(prefix) || file.storage_path.includes("..") || /^(?:https?:|data:)/i.test(file.storage_path)) {
      return { ok: false, reason: "cross_org_path" };
    }
    if (paths.has(file.storage_path)) return { ok: false, reason: "malformed" };
    paths.add(file.storage_path);
    if (typeof file.name !== "string" || typeof file.mime_type !== "string" || typeof file.size_bytes !== "number" || !Number.isSafeInteger(file.size_bytes) || file.size_bytes < 0) {
      return { ok: false, reason: "malformed" };
    }
    value.push({ path: file.storage_path, name: file.name, size: file.size_bytes, mime: file.mime_type });
  }
  return { ok: true, value: value.length ? value : null };
}
