import { beforeEach, describe, expect, it, vi } from "vitest";

const ids = {
  org: "00000000-0000-4000-8000-000000000001",
  user: "00000000-0000-4000-8000-000000000010",
  board: "00000000-0000-4000-8000-000000000020",
  item: "00000000-0000-4000-8000-000000000030",
  request: "00000000-0000-4000-8000-000000000040",
};

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), createClient: vi.fn() }));

function queryResult(table: string) {
  if (table === "board_item_detail_links") {
    return {
      data: [
        {
          id: "cloud",
          label: "클라우드 폴더",
          url: "https://drive.google.com/drive/folders/customer-a",
          created_at: "2026-08-26T01:00:00Z",
          link_kind: "cloud_folder",
        },
        {
          id: "legacy",
          label: "기존 자료",
          url: "https://legacy.example.com/folders/a",
          created_at: "2026-08-25T01:00:00Z",
          link_kind: null,
        },
      ],
      error: null,
    };
  }
  return { data: [], error: null };
}

const client = {
  from: vi.fn((table: string) => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "order", "limit"]) {
      builder[method] = vi.fn(() => builder);
    }
    builder.maybeSingle = vi.fn(async () =>
      table === "items"
        ? {
            data: {
              id: ids.item,
              board_id: ids.board,
              org_id: ids.org,
              assigned_to: ids.user,
              deleted_at: null,
            },
            error: null,
          }
        : { data: null, error: null },
    );
    builder.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve(queryResult(table)).then(resolve);
    return builder;
  }),
  rpc: mocks.rpc,
  storage: {
    from: vi.fn(() => ({
      createSignedUrl: vi.fn(async () => ({ data: null, error: null })),
    })),
  },
};

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({
    org: { id: ids.org },
    user: { id: ids.user },
    role: "owner",
    scope: "all",
  })),
}));
vi.mock("@/lib/perm/guard", () => ({
  loadPermGuard: vi.fn(async () => ({ kind: "allowed" })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));
vi.mock("@/lib/deal/members", () => ({
  listOrgMemberOptions: vi.fn(async () => []),
}));
vi.mock("@/lib/boards/server", () => ({ createRequestBoards: vi.fn() }));
vi.mock("@/lib/notices/official-file", () => ({
  BOARD_ITEM_FILES_BUCKET: "board-item-files",
  boardItemStoragePath: vi.fn(),
  encodeNoticeFile: vi.fn(),
}));

import {
  removeItemCloudFolderAction,
  saveItemCloudFolderAction,
} from "./item-detail-actions";

describe("Issue #574 cloud folder server actions", () => {
  beforeEach(() => {
    mocks.rpc.mockReset().mockResolvedValue({ data: [], error: null });
    mocks.createClient.mockReset().mockResolvedValue(client);
    client.from.mockClear();
  });

  it("normalizes a folder URL, calls the canonical RPC and separates the cloud row from legacy links", async () => {
    const result = await saveItemCloudFolderAction({
      boardId: ids.board,
      itemId: ids.item,
      url: "  https://drive.google.com/drive/folders/customer-a  ",
      requestId: ids.request,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("set_board_item_cloud_folder", {
      p_org_id: ids.org,
      p_board_id: ids.board,
      p_item_id: ids.item,
      p_url: "https://drive.google.com/drive/folders/customer-a",
      p_request_id: ids.request,
    });
    expect(result.cloudFolder).toMatchObject({ providerLabel: "Google Drive" });
    expect(result.links).toEqual([
      expect.objectContaining({ id: "legacy", label: "기존 자료" }),
    ]);
  });

  it("removes only through the same canonical RPC with a null URL", async () => {
    await removeItemCloudFolderAction({
      boardId: ids.board,
      itemId: ids.item,
      requestId: ids.request,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("set_board_item_cloud_folder", {
      p_org_id: ids.org,
      p_board_id: ids.board,
      p_item_id: ids.item,
      p_url: null,
      p_request_id: ids.request,
    });
  });

  it.each(["javascript:alert(1)", "data:text/html,unsafe", "https://example.com/file.pdf"])(
    "rejects unsafe or file input before any database request: %s",
    async (url) => {
      const result = await saveItemCloudFolderAction({
        boardId: ids.board,
        itemId: ids.item,
        url,
        requestId: ids.request,
      });
      expect(result.ok).toBe(false);
      expect(mocks.createClient).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
});
