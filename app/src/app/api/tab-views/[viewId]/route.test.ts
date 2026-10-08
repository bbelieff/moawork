/**
 * #845 6단계 — 저장된 뷰를 «덮어쓰거나 지우는» 것은 만든 사람과 워크스페이스 소유자·관리자만.
 * 화면이 「이 뷰에 저장」 을 감추는 것만으로는 막히지 않으므로 서버가 거절하는지를 잰다.
 * (RLS 072 tabviews_update/delete 도 같은 규칙이다 — 여기는 그 앞의 앱 경계.)
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  ctx: null as null | { user: { id: string }; org: { id: string }; role: string; scope: string },
  ownerId: "creator" as string | null,
  updates: [] as Record<string, unknown>[],
  deletes: 0,
  selections: 0,
}));

vi.mock("@/lib/auth/session", () => ({ getSessionOrNull: async () => state.ctx }));
vi.mock("@/lib/supabase/local-fallback", () => ({ canUseLocalSeedFallback: () => false }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async () => ({ error: null }),
    from(table: string) {
      const row = {
        id: "view-1", name: "팀 뷰", visibility: "shared", owner_id: state.ownerId, board_id: "board-1",
        person_scope: "none", person_scope_user_id: null, config_jsonb: { kind: "grouped" }, is_default: false, last_used_at: null,
      };
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: table === "tab_views" && state.ownerId !== "__missing__" ? row : null, error: null }),
        single: async () => ({ data: row, error: null }),
        update(patch: Record<string, unknown>) {
          state.updates.push(patch);
          return chain;
        },
        delete() {
          state.deletes += 1;
          return { eq: () => ({ eq: async () => ({ error: null }) }) };
        },
        upsert: async () => {
          state.selections += 1;
          return { error: null };
        },
      };
      return chain;
    },
  }),
}));

import { DELETE, PATCH } from "./route";

const params = { params: Promise.resolve({ viewId: "view-1" }) };
const patch = (body: unknown) => PATCH(new Request("https://app.test/api/tab-views/view-1", {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
}), params);
const as = (userId: string, role: string) => {
  state.ctx = { user: { id: userId }, org: { id: "org-1" }, role, scope: "all" };
};

afterEach(() => {
  state.ctx = null;
  state.ownerId = "creator";
  state.updates = [];
  state.deletes = 0;
  state.selections = 0;
});

describe("PATCH /api/tab-views/[viewId] — 덮어쓰기", () => {
  it("만든 사람도 관리자도 아닌 구성원이 조건을 덮어쓰면 403 이고 아무것도 고치지 않는다", async () => {
    as("member-1", "member");
    const response = await patch({ config: { kind: "grouped", filters: { q: "" } } });
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("이 뷰는 만든 사람과 관리자만 바꿀 수 있어요.");
    expect(state.updates).toEqual([]);
  });

  it("이름·공개 범위를 바꾸는 것도 같은 규칙으로 막는다(팀장도 남의 뷰는 못 바꾼다)", async () => {
    as("lead-1", "team_lead");
    expect((await patch({ name: "새 이름" })).status).toBe(403);
    expect((await patch({ visibility: "private" })).status).toBe(403);
    expect(state.updates).toEqual([]);
  });

  it("만든 사람은 덮어쓴다 — 저장되는 kind 열은 표(grouped)를 'board' 로 둔다", async () => {
    as("creator", "member");
    const response = await patch({ config: { kind: "grouped", filters: { q: "", byColumn: { status: ["new"] } } } });
    expect(response.status).toBe(200);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toMatchObject({ kind: "board", filters_jsonb: { status: ["new"] } });
    expect((state.updates[0].config_jsonb as { kind: string }).kind).toBe("grouped");
  });

  it.each(["owner", "admin"])("워크스페이스 %s 는 남의 팀 뷰를 덮어쓴다", async (role) => {
    as("boss", role);
    expect((await patch({ config: { kind: "board" } })).status).toBe(200);
    expect(state.updates).toHaveLength(1);
  });

  it("고르기(selected)는 누구나 — 내 선택만 기억하고 뷰는 고치지 않는다", async () => {
    as("member-1", "member");
    expect((await patch({ selected: true })).status).toBe(200);
    expect(state.selections).toBe(1);
    expect(state.updates).toEqual([]);
  });

  it("읽을 수 없는 뷰(남의 나만 뷰·다른 회사)는 «없음» 이다", async () => {
    as("member-1", "member");
    state.ownerId = "__missing__";
    expect((await patch({ config: {} })).status).toBe(404);
    expect(state.updates).toEqual([]);
  });
});

describe("DELETE /api/tab-views/[viewId] — 지우기", () => {
  it("만든 사람도 관리자도 아니면 403 이고 지우지 않는다", async () => {
    as("member-1", "member");
    const response = await DELETE(new Request("https://app.test/api/tab-views/view-1", { method: "DELETE" }), params);
    expect(response.status).toBe(403);
    expect(state.deletes).toBe(0);
  });

  it("만든 사람은 지운다", async () => {
    as("creator", "member");
    const response = await DELETE(new Request("https://app.test/api/tab-views/view-1", { method: "DELETE" }), params);
    expect(response.status).toBe(200);
    expect(state.deletes).toBe(1);
  });
});
