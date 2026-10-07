import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONTACT_TAB, CONTACT_TAB_SOURCE, ensureDefaultTab } from "@/lib/default-tabs";
import { LocalBoardsRepo, toAsyncBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { resetDb } from "@/lib/repo/local/store";
import { getRepo } from "@/lib/repo";
import type { Ctx } from "@/lib/types";

// BBE-236 — newcust/entry.test.ts 와 같은 계약. SupabaseBoardsRepo 를 LocalBoardsRepo 로
// 프록시해 실제 리스 RPC 순서만 검증한다.
const { loadMemberOrgSummaryWithClient } = vi.hoisted(() => ({
  loadMemberOrgSummaryWithClient: vi.fn(),
}));
vi.mock("@/lib/auth/member-org-summary", () => ({ loadMemberOrgSummaryWithClient }));
vi.mock("@/lib/repo/supabase/boardsRepo", () => ({
  SupabaseBoardsRepo: class {
    constructor(client: { repo: Record<PropertyKey, unknown> }) {
      return new Proxy(this, { get: (_target, property) => client.repo[property] });
    }
  },
}));

import { repairContactBoardOnEntry, resolveExistingContactBoard } from "./entry";

const ctx = {
  org: { id: "org-contact-entry", name: "테스트 회사" },
  user: { id: "member-a", name: "계정 A", email: "a@example.test" },
  role: "owner",
  scope: "all",
} as unknown as Ctx;

beforeEach(() => {
  resetDb();
  getRepo().addMember(ctx.org.id, {
    id: ctx.user.id,
    name: ctx.user.name,
    email: ctx.user.email,
    avatar_url: null,
    created_at: "2026-08-14T00:00:00Z",
  }, "owner", "all");
  loadMemberOrgSummaryWithClient.mockReset().mockResolvedValue({
    kind: "ready",
    owner: { userId: ctx.user.id, displayName: ctx.user.name },
    admins: [],
    members: [],
  });
});

describe("resolveExistingContactBoard", () => {
  it("제품 source가 유일할 때만 연다", async () => {
    const local = new LocalBoardsRepo();
    const target = local.createBoard(ctx, { name: "이름은 바꿀 수 있음", source: CONTACT_TAB_SOURCE });
    expect(await resolveExistingContactBoard(ctx, toAsyncBoardsRepo(local))).toEqual({ kind: "ready", boardId: target.id });
  });

  it("이름만 같은 보드와 과거 구조 팩 보드는 제품 탭으로 오인하지 않는다", async () => {
    const local = new LocalBoardsRepo();
    local.createBoard(ctx, { name: CONTACT_TAB.name, source: null });
    local.createBoard(ctx, { name: CONTACT_TAB.name, source: "pack.seoul.policyfund1/contact" });
    expect(await resolveExistingContactBoard(ctx, toAsyncBoardsRepo(local))).toEqual({ kind: "missing" });
  });

  it("source 중복이면 임의 선택하지 않는다", async () => {
    const local = new LocalBoardsRepo();
    local.createBoard(ctx, { name: "A", source: CONTACT_TAB_SOURCE });
    local.createBoard(ctx, { name: "B", source: CONTACT_TAB_SOURCE });
    expect(await resolveExistingContactBoard(ctx, toAsyncBoardsRepo(local))).toEqual({ kind: "conflict" });
  });

  it("기본 탭 보장 직후 같은 board id로 진입한다", async () => {
    const local = new LocalBoardsRepo();
    const repo = toAsyncBoardsRepo(local);
    const result = await ensureDefaultTab(ctx, CONTACT_TAB, repo);
    expect(await resolveExistingContactBoard(ctx, repo)).toEqual({ kind: "ready", boardId: result.boardId });
  });

  it("조회 호출은 구조를 만들지 않는다", async () => {
    const local = new LocalBoardsRepo();
    const before = local.listBoards(ctx);
    expect(await resolveExistingContactBoard(ctx, toAsyncBoardsRepo(local))).toEqual({ kind: "missing" });
    expect(local.listBoards(ctx)).toEqual(before);
  });
});

// BBE-236 — 이 보드가 없는 기존 워크스페이스는 예전엔 「찾을 수 없습니다」 로 영원히 막혔다.
describe("repairContactBoardOnEntry", () => {
  function fakeClient(repo: ReturnType<typeof toAsyncBoardsRepo>) {
    let holder: string | null = null;
    return {
      repo,
      rpc: vi.fn(async (name: string, args: { p_holder: string }) => {
        if (name === "acquire_default_tab_repair_lease") {
          if (holder === null || holder === args.p_holder) { holder = args.p_holder; return { data: true, error: null }; }
          return { data: false, error: null };
        }
        if (name === "renew_default_tab_repair_lease") return { data: holder === args.p_holder, error: null };
        if (holder === args.p_holder) holder = null;
        return { data: true, error: null };
      }),
    };
  }

  it("member는 없는 보드를 못 고친다 — 권한으로 막힌다", async () => {
    const request = fakeClient(toAsyncBoardsRepo(new LocalBoardsRepo()));
    const result = await repairContactBoardOnEntry({ ...ctx, role: "member", scope: "assigned" }, request as never);
    expect(result).toEqual({ kind: "permission" });
    expect(request.rpc).not.toHaveBeenCalled();
  });

  it("owner 진입에서 없는 보드가 additive로 생긴다", async () => {
    const local = new LocalBoardsRepo();
    const request = fakeClient(toAsyncBoardsRepo(local));
    const result = await repairContactBoardOnEntry(ctx, request as never);
    expect(result.kind).toBe("ready");
    expect(local.listBoards(ctx).filter((b) => b.source === CONTACT_TAB_SOURCE)).toHaveLength(1);
  });

  it("동시 진입 2회에도 보드가 하나로 수렴한다", async () => {
    const local = new LocalBoardsRepo();
    const request = fakeClient(toAsyncBoardsRepo(local));
    const [first, second] = await Promise.all([
      repairContactBoardOnEntry(ctx, request as never),
      repairContactBoardOnEntry(ctx, request as never),
    ]);
    expect(first).toEqual(second);
    expect(local.listBoards(ctx).filter((b) => b.source === CONTACT_TAB_SOURCE)).toHaveLength(1);
  });

  it("여러 후보가 있으면 고치지 않고 거부한다", async () => {
    const local = new LocalBoardsRepo();
    local.createBoard(ctx, { name: "A", source: CONTACT_TAB_SOURCE });
    local.createBoard(ctx, { name: "B", source: CONTACT_TAB_SOURCE });
    const result = await repairContactBoardOnEntry(ctx, fakeClient(toAsyncBoardsRepo(local)) as never);
    expect(result).toEqual({ kind: "conflict" });
    expect(local.listBoards(ctx)).toHaveLength(2);
  });

  // #849 — 지운 기본 탭은 누구의 진입에서도 다시 만들지 않고, 진입 화면이 «지움» 을 안내한다.
  describe("지운 기본 탭", () => {
    async function trashedContact() {
      const local = new LocalBoardsRepo();
      const repo = toAsyncBoardsRepo(local);
      const { boardId } = await ensureDefaultTab(ctx, CONTACT_TAB, repo);
      local.trashBoard(ctx, boardId);
      return { local, repo };
    }

    it("조회는 «없음» 이 아니라 «지움» 이다", async () => {
      const { repo } = await trashedContact();
      expect(await resolveExistingContactBoard(ctx, repo)).toEqual({ kind: "dismissed" });
    });

    it.each(["owner", "member"] as const)("%s 진입은 리스 없이 «지움» 을 돌려주고 만들지 않는다", async (role) => {
      const { local, repo } = await trashedContact();
      const request = fakeClient(repo);
      const result = await repairContactBoardOnEntry({ ...ctx, role }, request as never);
      expect(result).toEqual({ kind: "dismissed" });
      expect(request.rpc).not.toHaveBeenCalled();
      expect(local.listBoards(ctx).some((b) => b.source === CONTACT_TAB_SOURCE)).toBe(false);
    });

    it("리스를 잡은 뒤 지운 경쟁에서도 만들지 않고 «지움» 이다", async () => {
      const { local, repo } = await trashedContact();
      // 지운 기록을 «아직 못 본» 읽기 — 만들기 단계에서야 지운 탭임을 알게 된다.
      const stale = new Proxy(repo, {
        get: (target, property, receiver) => property === "listDefaultTabDismissals"
          ? async () => []
          : Reflect.get(target, property, receiver),
      });
      const request = fakeClient(stale);
      const result = await repairContactBoardOnEntry(ctx, request as never);
      expect(result).toEqual({ kind: "dismissed" });
      expect(request.rpc.mock.calls.map(([name]) => name)).toContain("release_default_tab_repair_lease");
      expect(local.listBoards(ctx).some((b) => b.source === CONTACT_TAB_SOURCE)).toBe(false);
    });
  });
});
