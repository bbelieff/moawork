import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  boardItemStoragePath,
  encodeNoticeFile,
  loadNoticeFileBytes,
  parseNoticeFile,
  type StoredNoticeFile,
} from "./official-file";

describe("notice official PDF boundary", () => {
  it("reuses BBE-16 validation and keeps bytes behind metadata", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "notice.pdf", { type: "application/pdf" });
    const stored = await encodeNoticeFile(file);
    expect(stored).toMatchObject({ name: "notice.pdf", mimeType: "application/pdf", size: 3 });
    expect(parseNoticeFile(JSON.stringify(stored))).toEqual(stored);
    expect(parseNoticeFile("not-json")).toBeNull();
  });
  it("rejects the same unsafe extension as the BBE-16 boundary", async () => {
    await expect(encodeNoticeFile(new File(["x"], "attack.exe"))).rejects.toThrow();
  });
});

/** 가짜 Supabase Storage 클라이언트 — upload/download 만 흉내낸다. */
function fakeStorageClient(opts: { uploadError?: string } = {}): {
  client: SupabaseClient;
  uploaded: { path: string; contentType?: string }[];
} {
  const uploaded: { path: string; contentType?: string }[] = [];
  const client = {
    storage: {
      from: () => ({
        upload: vi.fn(async (path: string, _file: unknown, options?: { contentType?: string }) => {
          if (opts.uploadError) return { data: null, error: { message: opts.uploadError } };
          uploaded.push({ path, contentType: options?.contentType });
          return { data: { path }, error: null };
        }),
        download: vi.fn(async (path: string) => {
          if (path !== uploaded[0]?.path) return { data: null, error: { message: "not found" } };
          return { data: new Blob([new Uint8Array([9, 9, 9])]), error: null };
        }),
      }),
    },
  } as unknown as SupabaseClient;
  return { client, uploaded };
}

describe("BBE-239 · Storage 경로 업로드/다운로드", () => {
  it("client 가 있으면 base64 대신 Storage 에 업로드하고 storagePath 를 반환한다", async () => {
    const { client, uploaded } = fakeStorageClient();
    const file = new File([new Uint8Array([1, 2, 3])], "공문.pdf", { type: "application/pdf" });

    const stored = await encodeNoticeFile(file, { client, orgId: "org-1", boardId: "board-1", itemId: "item-1" });

    expect(stored.storagePath).toBeDefined();
    expect(stored.contentB64).toBeUndefined();
    expect(stored.storagePath).toBe(boardItemStoragePath("org-1", "board-1", "item-1", stored.id, "공문.pdf"));
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0].path).toBe(stored.storagePath);
  });

  it("storagePath 경로는 storage.foldername(name)[1] 이 orgId 가 되는 규약을 지킨다", () => {
    const path = boardItemStoragePath("org-9", "board-9", "item-9", "file-9", "a.pdf");
    expect(path.split("/")[0]).toBe("org-9");
  });

  it("업로드 실패는 그대로 던진다(삼키지 않는다)", async () => {
    const { client } = fakeStorageClient({ uploadError: "quota exceeded" });
    const file = new File([new Uint8Array([1])], "x.pdf", { type: "application/pdf" });
    await expect(
      encodeNoticeFile(file, { client, orgId: "org-1", boardId: "board-1", itemId: "item-1" }),
    ).rejects.toThrow("quota exceeded");
  });

  it("parseNoticeFile 은 레거시 contentB64 행과 신규 storagePath 행을 둘 다 읽는다", () => {
    const legacy = { id: "f1", name: "old.pdf", mimeType: "application/pdf", size: 3, contentB64: "AQID" };
    const fresh = { id: "f2", name: "new.pdf", mimeType: "application/pdf", size: 3, storagePath: "org/board/item/f2__new.pdf" };
    expect(parseNoticeFile(JSON.stringify(legacy))).toEqual(legacy);
    expect(parseNoticeFile(JSON.stringify(fresh))).toEqual(fresh);
    expect(parseNoticeFile(JSON.stringify({ id: "f3", name: "x", mimeType: "y", size: 1 }))).toBeNull();
  });

  it("loadNoticeFileBytes — 레거시 contentB64 는 client 없이도 디코드된다", async () => {
    const stored: StoredNoticeFile = { id: "f1", name: "old.pdf", mimeType: "application/pdf", size: 3, contentB64: Buffer.from([1, 2, 3]).toString("base64") };
    const bytes = await loadNoticeFileBytes(stored, null);
    expect([...bytes]).toEqual([1, 2, 3]);
  });

  it("loadNoticeFileBytes — storagePath 는 Storage 에서 내려받는다(하위호환 통합 확인)", async () => {
    const { client, uploaded } = fakeStorageClient();
    const file = new File([new Uint8Array([1, 2, 3])], "공문.pdf", { type: "application/pdf" });
    const stored = await encodeNoticeFile(file, { client, orgId: "org-1", boardId: "board-1", itemId: "item-1" });
    expect(uploaded).toHaveLength(1);

    const bytes = await loadNoticeFileBytes(stored, client);
    expect([...bytes]).toEqual([9, 9, 9]);
  });

  it("loadNoticeFileBytes — storagePath 인데 client 가 없으면 던진다(조용히 빈 파일이 되지 않는다)", async () => {
    const stored: StoredNoticeFile = { id: "f2", name: "new.pdf", mimeType: "application/pdf", size: 3, storagePath: "org/board/item/f2__new.pdf" };
    await expect(loadNoticeFileBytes(stored, null)).rejects.toThrow();
  });
});
