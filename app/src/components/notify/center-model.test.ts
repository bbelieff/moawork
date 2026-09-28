import { describe, it, expect, vi } from "vitest";
import {
  centerItems,
  EMPTY_FILTERS,
  filterCenterItems,
  requestReadAll,
  type CenterItem,
} from "./center-model";
import type { NotifySnapshot } from "@/lib/notify/server";
const item: CenterItem = {
  id: "1",
  title: "회사 A 일정",
  body: "검토 요청",
  actor: "작성자",
  route: "mine",
  type: "requested",
  at: "2026-09-14T16:00:00Z",
  read: false,
  action: true,
  href: null,
  distance: 0,
  path: "",
};
describe("notification center", () => {
  it("combines route, sender, company, unread and Korean date filters", () => {
    const filters = {
      ...EMPTY_FILTERS,
      route: "mine",
      actor: "작성자",
      company: "회사 A",
      search: "검토",
      type: "requested",
      from: "2026-09-15",
      to: "2026-09-15",
      unread: true,
    };
    expect(
      filterCenterItems(
        [
          item,
          { ...item, id: "2", read: true },
          { ...item, id: "3", route: "team" },
        ],
        filters,
      ),
    ).toEqual([item]);
    expect(filterCenterItems([item], { ...filters, to: "2026-09-14" })).toEqual(
      [],
    );
  });
  it("does not treat unknown read state as unread", () => {
    expect(
      filterCenterItems([{ ...item, read: undefined }], {
        ...EMPTY_FILTERS,
        unread: true,
      }),
    ).toEqual([]);
  });
  it("read action never resolves an outstanding task", () => {
    const n = {
      id: "n",
      org_id: "o",
      user_id: "u",
      type: "requested",
      title: "요청",
      body: null,
      target_type: null,
      target_id: null,
      actor_id: null,
      is_action: true,
      read_at: "2026-09-15",
      resolved_at: null,
      created_at: item.at,
    };
    const snapshot: NotifySnapshot = {
      bell: { kind: "none" },
      sidebar: {},
      mine: [{ notification: n, href: null }],
      org: [],
    };
    expect(centerItems(snapshot)[0]).toMatchObject({
      read: true,
      action: true,
    });
    expect(n.resolved_at).toBeNull();
  });
  it("rejects HTTP and malformed success responses", async () => {
    await expect(
      requestReadAll(
        vi.fn().mockResolvedValue(new Response("", { status: 500 })),
      ),
    ).rejects.toThrow("실패");
    await expect(
      requestReadAll(
        vi.fn().mockResolvedValue(Response.json({ data: { ok: false } })),
      ),
    ).rejects.toThrow("확인");
  });
  it("uses only read-all API and verifies its acknowledgement", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ data: { ok: true } }));
    await expect(requestReadAll(fetcher)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith("/api/notifications/read-all", {
      method: "POST",
    });
  });
});
