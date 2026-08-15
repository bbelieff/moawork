import { sanitizeFileName, validateUpload } from "@/lib/services/files";

export const NOTICE_FILE_VALUE_PREFIX = "__notice_file/";
export interface StoredNoticeFile { id: string; name: string; mimeType: string; size: number; contentB64: string }

export async function encodeNoticeFile(file: File): Promise<StoredNoticeFile> {
  const verdict = validateUpload({ name: file.name, size_bytes: file.size });
  if (!verdict.ok) throw new Error(verdict.reason);
  return { id: crypto.randomUUID(), name: sanitizeFileName(file.name), mimeType: file.type || "application/octet-stream", size: file.size, contentB64: Buffer.from(await file.arrayBuffer()).toString("base64") };
}

export function parseNoticeFile(value: unknown): StoredNoticeFile | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredNoticeFile>;
    return typeof parsed.id === "string" && typeof parsed.name === "string" && typeof parsed.contentB64 === "string" && typeof parsed.mimeType === "string" && typeof parsed.size === "number" ? parsed as StoredNoticeFile : null;
  } catch { return null; }
}
