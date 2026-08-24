import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  remove: vi.fn(),
  encode: vi.fn(),
}));

const requestId = "00000000-0000-4000-8000-000000000701";
const client = {
  from: vi.fn((table: string) => {
    const result = table === "items"
      ? { data: { id: "00000000-0000-4000-8000-000000000030", board_id: "00000000-0000-4000-8000-000000000020", org_id: "00000000-0000-4000-8000-000000000001", assigned_to: "00000000-0000-4000-8000-000000000010", deleted_at: null }, error: null }
      : { data: [], error: null };
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "order", "limit"]) builder[method] = vi.fn(() => builder);
    builder.maybeSingle = vi.fn(async () => result);
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return builder;
  }),
  rpc: mocks.rpc,
  storage: {
    from: vi.fn(() => ({ remove: mocks.remove })),
  },
};

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({
    org: { id: "00000000-0000-4000-8000-000000000001" },
    user: { id: "00000000-0000-4000-8000-000000000010" },
    role: "owner",
    scope: "all",
  })),
}));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: vi.fn(async () => ({ kind: "allowed" })) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => client) }));
vi.mock("@/lib/deal/members", () => ({ listOrgMemberOptions: vi.fn(async () => []) }));
vi.mock("@/lib/boards/server", () => ({ createRequestBoards: vi.fn() }));
vi.mock("@/lib/boards/detail-layout", () => ({ resolveDetailLayout: vi.fn() }));
vi.mock("@/lib/notices/official-file", () => ({
  BOARD_ITEM_FILES_BUCKET: "board-item-files",
  boardItemStoragePath: vi.fn((orgId: string, boardId: string, itemId: string, fileId: string, name: string) => `${orgId}/${boardId}/${itemId}/${fileId}__${name}`),
  encodeNoticeFile: mocks.encode,
}));

import { uploadItemDetailFileAction } from "./item-detail-actions";

describe("Issue #542 reserved detail file upload", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.remove.mockReset().mockResolvedValue({ error: null });
    mocks.encode.mockReset().mockResolvedValue({
      id: requestId,
      name: "견적서.pdf",
      mimeType: "application/pdf",
      size: 3,
      storagePath: `00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000020/00000000-0000-4000-8000-000000000030/${requestId}__견적서.pdf`,
    });
  });

  it("같은 request id로 먼저 예약하고 등록 실패 시 Storage와 예약을 함께 되돌린다", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: [{ file_id: requestId, state: "pending", replayed: false }], error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "22023" } })
      .mockResolvedValueOnce({ data: true, error: null });
    const form = new FormData();
    form.set("requestId", requestId);
    form.set("file", new File([new Uint8Array([1, 2, 3])], "견적서.pdf", { type: "application/pdf" }));
    const result = await uploadItemDetailFileAction(
      "00000000-0000-4000-8000-000000000020",
      "00000000-0000-4000-8000-000000000030",
      form,
    );
    expect(result.ok).toBe(false);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "reserve_board_item_detail_file",
      "register_board_item_detail_file",
      "cancel_board_item_detail_file",
    ]);
    expect(mocks.encode).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ fileId: requestId, upsert: true }));
    expect(mocks.remove).toHaveBeenCalledOnce();
  });

  it("등록 응답이 모호하고 예약 취소가 거부되면 이미 확정됐을 수 있는 Storage 객체를 지우지 않는다", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: [{ file_id: requestId, state: "pending", replayed: true }], error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "57014" } })
      .mockResolvedValueOnce({ data: false, error: null });
    const form = new FormData();
    form.set("requestId", requestId);
    form.set("file", new File([new Uint8Array([1])], "견적서.pdf", { type: "application/pdf" }));

    const result = await uploadItemDetailFileAction(
      "00000000-0000-4000-8000-000000000020",
      "00000000-0000-4000-8000-000000000030",
      form,
    );

    expect(result.ok).toBe(false);
    expect(mocks.encode).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ upsert: true }));
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("이미 finalized 된 동일 요청은 Storage 재업로드와 등록을 반복하지 않는다", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [{ file_id: requestId, state: "finalized", replayed: true }], error: null });
    const form = new FormData();
    form.set("requestId", requestId);
    form.set("file", new File([new Uint8Array([1])], "견적서.pdf", { type: "application/pdf" }));

    await uploadItemDetailFileAction(
      "00000000-0000-4000-8000-000000000020",
      "00000000-0000-4000-8000-000000000030",
      form,
    );

    expect(mocks.encode).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
