import { beforeEach, describe, expect, it, vi } from "vitest";

const ids = {
  org: "00000000-0000-4000-8000-000000000001",
  user: "00000000-0000-4000-8000-000000000010",
  board: "00000000-0000-4000-8000-000000000020",
  item: "00000000-0000-4000-8000-000000000030",
  request: "00000000-0000-4000-8000-000000000040",
};

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), createClient: vi.fn(), eventRows: [] as Record<string, unknown>[], members: [] as { id: string; name: string }[] }));

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
    for (const method of ["select", "eq", "in", "is", "order", "limit"]) {
      builder[method] = vi.fn(() => builder);
    }
    const filters: [string, unknown][] = [];
    let kinds: string[] | undefined;
    let limit = 100;
    builder.eq = vi.fn((key: string, value: unknown) => { filters.push([key, value]); return builder; });
    builder.in = vi.fn((_key: string, values: string[]) => { kinds = values; return builder; });
    builder.limit = vi.fn((value: number) => { limit = value; return builder; });
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
      Promise.resolve(table === "board_item_detail_events" ? {
        data: mocks.eventRows.filter((row) => filters.every(([key, value]) => row[key] === value) && (!kinds || kinds.includes(String(row.kind)))).slice(0, limit), error: null,
      } : queryResult(table)).then(resolve);
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
  listOrgMemberOptions: vi.fn(async () => mocks.members),
}));
vi.mock("@/lib/boards/server", () => ({ createRequestBoards: vi.fn() }));
vi.mock("@/lib/notices/official-file", () => ({
  BOARD_ITEM_FILES_BUCKET: "board-item-files",
  boardItemStoragePath: vi.fn(),
  encodeNoticeFile: vi.fn(),
}));

import {
  loadItemDetailAction,
  removeItemCloudFolderAction,
  saveItemCloudFolderAction,
} from "./item-detail-actions";

describe("Issue #574 cloud folder server actions", () => {
  beforeEach(() => {
    mocks.rpc.mockReset().mockResolvedValue({ data: [], error: null });
    mocks.createClient.mockReset().mockResolvedValue(client);
    client.from.mockClear();
    mocks.eventRows = [];
    mocks.members = [];
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
      p_provider: "google_drive",
      p_folder_ref: "customer-a",
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
      p_provider: null,
      p_folder_ref: null,
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


it("keeps a separate conversation budget and resolves only referenced allowed members", async () => {
  const base = { org_id: ids.org, board_id: ids.board, item_id: ids.item, actor_id: ids.user, body: "기록", deleted_at: null };
  mocks.eventRows = Array.from({ length: 120 }, (_, index) => ({ ...base, id: `change-${index}`, kind: "field_change", created_at: "2026-09-16T00:00:00Z", metadata: { column_key: "owner", before: "old-member", after: ids.user } }));
  mocks.eventRows.push({ ...base, id: "conversation", kind: "memo", body: "이전 담당 대화", created_at: "2026-09-15T00:00:00Z" });
  mocks.eventRows.push({ ...base, id: "foreign", org_id: "other-org", kind: "memo", created_at: "2026-09-16T00:00:00Z" });
  mocks.members = [{ id: ids.user, name: "담당 A" }, { id: "old-member", name: "담당 B" }, { id: "unrelated", name: "다른 구성원" }];
  const result = await loadItemDetailAction(ids.board, ids.item);
  expect(result.ok).toBe(true);
  expect(result.events).toHaveLength(101);
  expect(result.events.at(-1)?.id).toBe("conversation");
  expect(result.events.some((event) => event.id === "foreign")).toBe(false);
  expect(result.events[0].metadata).toMatchObject({ before: "old-member" });
  expect(result.members.map((member) => member.id)).toEqual([ids.user, "old-member"]);
});
