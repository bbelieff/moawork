import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeFileName, validateUpload } from "@/lib/services/files";

export const NOTICE_FILE_VALUE_PREFIX = "__notice_file/";
export const BOARD_ITEM_FILES_BUCKET = "board-item-files";

/**
 * 저장 형태 둘 — BBE-239 로 base64(레거시) → Storage(신규) 전환.
 * 새 업로드는 `storagePath` 만 쓴다. 기존에 이미 올라간 `contentB64` 행도
 * 계속 읽혀야 해서(하위호환) 유니온으로 둘 다 받는다.
 */
export interface StoredNoticeFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  contentB64?: string;
  storagePath?: string;
}

/** {orgId}/{boardId}/{itemId}/{fileId}__{filename} — storage.foldername(name)[1] 이 orgId. */
export function boardItemStoragePath(
  orgId: string,
  boardId: string,
  itemId: string,
  fileId: string,
  fileName: string,
): string {
  return `${orgId}/${boardId}/${itemId}/${fileId}__${sanitizeFileName(fileName)}`;
}

/**
 * 파일을 인코딩한다 — `client` 가 있으면 Supabase Storage 에 업로드하고 `storagePath` 를
 * 반환한다. 로컬 시드(`client` 없음)에서는 Storage 가 없으므로 base64 로 폴백한다
 * (기존 로컬 개발 경로를 깨지 않기 위한 의도적 타협 — `contact_move` 의 `!graph.client`
 * 처리와 같은 종류의 판단).
 */
export async function encodeNoticeFile(
  file: File,
  ctx?: { client: SupabaseClient; orgId: string; boardId: string; itemId: string; fileId?: string; upsert?: boolean },
): Promise<StoredNoticeFile> {
  const verdict = validateUpload({ name: file.name, size_bytes: file.size });
  if (!verdict.ok) throw new Error(verdict.reason);
  const id = ctx?.fileId ?? crypto.randomUUID();
  const name = sanitizeFileName(file.name);
  const mimeType = file.type || "application/octet-stream";

  if (ctx) {
    const storagePath = boardItemStoragePath(ctx.orgId, ctx.boardId, ctx.itemId, id, name);
    const { error } = await ctx.client.storage
      .from(BOARD_ITEM_FILES_BUCKET)
      .upload(storagePath, file, { contentType: mimeType, upsert: ctx.upsert ?? false });
    if (error) throw new Error(error.message);
    return { id, name, mimeType, size: file.size, storagePath };
  }

  return { id, name, mimeType, size: file.size, contentB64: Buffer.from(await file.arrayBuffer()).toString("base64") };
}

export function parseNoticeFile(value: unknown): StoredNoticeFile | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredNoticeFile>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.name !== "string" ||
      typeof parsed.mimeType !== "string" ||
      typeof parsed.size !== "number"
    ) {
      return null;
    }
    if (typeof parsed.storagePath === "string") {
      return { id: parsed.id, name: parsed.name, mimeType: parsed.mimeType, size: parsed.size, storagePath: parsed.storagePath };
    }
    if (typeof parsed.contentB64 === "string") {
      return { id: parsed.id, name: parsed.name, mimeType: parsed.mimeType, size: parsed.size, contentB64: parsed.contentB64 };
    }
    return null;
  } catch {
    return null;
  }
}

/** 저장된 파일의 바이트를 내려받는다 — storagePath 면 Storage 에서, contentB64 면(레거시) 그대로 디코드. */
export async function loadNoticeFileBytes(
  stored: StoredNoticeFile,
  client: SupabaseClient | null,
): Promise<Buffer> {
  if (stored.storagePath) {
    if (!client) throw new Error("파일을 내려받으려면 연결된 워크스페이스가 필요합니다.");
    const { data, error } = await client.storage.from(BOARD_ITEM_FILES_BUCKET).download(stored.storagePath);
    if (error || !data) throw new Error(error?.message ?? "파일을 찾을 수 없습니다.");
    return Buffer.from(await data.arrayBuffer());
  }
  if (stored.contentB64) return Buffer.from(stored.contentB64, "base64");
  throw new Error("파일 내용을 찾을 수 없습니다.");
}
