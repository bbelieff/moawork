// BBE-214 측정 하니스 — 「보드 이동이 느리다」를 숫자로 바꾼다.
//
// ★ 왜 «시간» 이 아니라 «왕복 횟수·직렬 단계» 를 재는가
//   벽시계 시간은 기계·부하에 따라 흔들려서 flake 가 난다. 대신 결정적인 것을 잰다:
//     (1) 이 화면 한 번을 그리는 데 DB 를 «몇 번» 왕복하는가
//     (2) 그 왕복이 «몇 단계» 직렬로 쌓이는가 (= 임계 경로 길이)
//   Supabase 왕복 1회는 지역·연결에 따라 수십 ms 다. 직렬 단계 수가 곧 체감 지연이다.
//
// 측정 방법: createClient() 를 «세는 가짜» 로 바꾼다. 쿼리 체인을 await 하면 왕복 1회로 센다.
//   같은 매크로태스크 안에서 발행된 왕복은 «같은 물결(wave)» 로 함께 응답한다 —
//   Promise.all 로 병렬 발행하면 한 물결, await 을 줄줄이 세우면 물결이 그만큼 늘어난다.
//   따라서 «서로 다른 물결의 수» = 직렬 단계 수다. 타이머 값에 의존하지 않으므로 결정적이다.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Trip = { label: string; wave: number; origin?: string };

const probe = vi.hoisted(() => {
  let wave = 0;
  let queue: Array<() => void> = [];
  let scheduled = false;
  const trips: Trip[] = [];

  // 어느 «호출부» 가 이 왕복을 냈는지 붙인다. 중복을 없애려면 «누가 중복하는지» 를 알아야 한다.
  function originOf(): string {
    const stack = new Error().stack ?? "";
    const NL = String.fromCharCode(10);
    const BS = String.fromCharCode(92);
    for (const raw of stack.split(NL).slice(2)) {
      const line = raw.split(BS).join("/");
      for (const key of ["src/lib/", "src/app/"]) {
        const at = line.indexOf(key);
        if (at < 0) continue;
        const rest = line.slice(at + 4);
        const cut = rest.indexOf(":");
        let file = cut < 0 ? rest : rest.slice(0, cut);
        if (file.endsWith(")")) file = file.slice(0, -1);
        if (file.includes("roundtrips.test")) continue;
        return file;
      }
    }
    return "?";
  }

  function roundtrip<T>(label: string, value: T): Promise<T> {
    trips.push({ label, wave, origin: originOf() });
    return new Promise<T>((resolve) => {
      queue.push(() => resolve(value));
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        wave += 1; // 이 물결에 실린 왕복이 «함께» 응답한다
        const batch = queue;
        queue = [];
        for (const settle of batch) settle();
      }, 0);
    });
  }

  const tables: Record<string, unknown[]> = {};
  const rpcs: Record<string, unknown> = {};

  function thenable(label: string, produce: () => unknown) {
    return {
      then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
        roundtrip(label, { data: produce(), error: null, count: 0 }).then(onOk, onErr),
    };
  }

  // Supabase 쿼리 빌더의 체이닝만 흉내 낸다 — 필터는 결과에 영향을 주지 않는다.
  // 이 측정이 세는 것은 «몇 번 나가는가» 이지 «무엇이 돌아오는가» 가 아니다.
  const CHAIN = [
    "select", "insert", "update", "upsert", "delete", "eq", "neq", "gt", "gte",
    "lt", "lte", "like", "ilike", "is", "in", "not", "or", "filter", "order",
    "limit", "range", "contains", "overlaps", "match", "throwOnError", "returns",
  ];

  // ★ 읽기와 쓰기를 «구분해서» 기록한다.
  //   구분하지 않으면 「드리프트를 고쳤다」는 테스트가 listGroups «읽기» 만 보고도 초록이 된다 —
  //   치유가 죽어도 안 빨개진다. 이름이 주장하는 것을 관측할 수 있어야 한다.
  const WRITE_OPS = new Set(["insert", "update", "upsert", "delete"]);

  function makeQuery(table: string) {
    const rows = () => tables[table] ?? [];
    const q: Record<string, unknown> = {};
    let op = "select";
    for (const method of CHAIN) {
      q[method] = () => {
        if (WRITE_OPS.has(method)) op = method;
        return q;
      };
    }
    const label = () => `${op}:${table}`;
    q.single = () => thenable(label(), () => rows()[0] ?? null);
    q.maybeSingle = () => thenable(label(), () => rows()[0] ?? null);
    q.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
      roundtrip(label(), { data: rows(), error: null, count: rows().length }).then(onOk, onErr);
    return q;
  }

  // ★ RPC 도 읽기/쓰기를 갈라야 한다 — 테이블 질의만 가르면 절반만 갈린 것이다.
  //   다음 단계가 「무엇을 줄일까」이기 때문이다: 읽기는 병렬화·캐시로 줄이고, 쓰기는 못 줄인다.
  //   내역이 둘을 합쳐 놓으면 «줄일 수 없는 것을 줄이려» 하거나 «줄일 수 있는 것을 못 본다».
  //
  //   ★ 목록에 «없는» RPC 는 읽기로 «가정하지 않는다» — `rpc?:` 로 찍어 모른다는 것을 드러낸다.
  //     가정하면 「분류에서 뺀 것」과 「분류를 빠뜨린 것」이 구분되지 않는다.
  //   분류 근거는 «이름» 이 아니라 마이그레이션의 «함수 본문» 이다.
  //   Postgres 의 volatility 표시(stable = 쓰기 없음)와 본문의 update/insert 유무로 판정한다.
  const READ_RPCS = new Set([
    "app_admin_role",
    "effective_permission",
    "read_permission_scoped_work_items",
    "get_member_account_profile",
    // 017: language sql · stable · select 전용
    "is_platform_admin",
    // 008: plpgsql · stable · 본문에 update/insert 없음
    "workspace_entry_self_route_state",
    // 009:267 본문이 select count(*) 뿐이다.
    //   ※ volatility 표시가 «없어» Postgres 기본값 VOLATILE 로 선언돼 있다 —
    //     선언은 느슨한데 실제는 읽기다. 선언만 보고는 판정할 수 없어 본문을 읽었다.
    "count_pending_workspace_join_requests",
  ]);
  const WRITE_RPCS = new Set([
    "acquire_default_tab_repair_lease",
    "renew_default_tab_repair_lease",
    "release_default_tab_repair_lease",
    // ★★ 009:345 — 이름은 「list」인데 «쓴다».
    //   기한 지난 요청을 update ... set status='rejected' 하고
    //   workspace_entry_events 에 insert 한다.
    //   ★ 이름으로 분류했으면 읽기로 셌을 것이고, 누가 캐시했으면
    //     «기한 만료 처리가 조용히 멈춘다». rpc?: 가 막아 준 자리가 정확히 여기다.
    "list_my_workspace_entry_requests",
  ]);
  function rpcLabel(name: string): string {
    if (READ_RPCS.has(name)) return `rpc:${name}`;
    if (WRITE_RPCS.has(name)) return `rpc-write:${name}`;
    return `rpc?:${name}`;
  }

  const client = {
    auth: {
      getUser: () =>
        roundtrip("auth.getUser", {
          data: { user: { id: "user-1", email: "member@example.test" } },
          error: null,
        }),
    },
    from: (table: string) => makeQuery(table),
    rpc: (name: string) => thenable(rpcLabel(name), () => rpcs[name] ?? null),
  };

  return {
    client,
    tables,
    rpcs,
    trips,
    reset() {
      wave = 0;
      queue = [];
      scheduled = false;
      trips.length = 0;
    },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => probe.client }));
vi.mock("@/lib/supabase/env", () => ({
  hasSupabaseEnv: () => true,
  getSupabaseEnv: () => ({ url: "https://example.test", anonKey: "anon" }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {} }),
  headers: async () => ({ get: () => null }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("HARNESS_NOT_FOUND");
  },
  redirect: () => {
    throw new Error("HARNESS_REDIRECT");
  },
}));

// BBE-236 — repairContactBoardOnEntry/repairNewcustBoardOnEntry 둘 다 진입에서
// loadMemberOrgSummaryWithClient 를 부른다. 이 파일은 그 결과를 이미 seed() 의
// org_members 행(user-1 · owner · "멤버")으로 표현해 뒀으므로, 실제 쿼리 대신 같은
// 값을 바로 돌려준다 — 별도 조회 경로를 하나 더 흉내 낼 필요가 없다.
// ⚠ readDefaultTabDrift 는 절대 여기서 고정하지 않는다 — 「성질 고정」 테스트들(아래
//   describe)이 바로 이 함수가 «드리프트를 진짜로 찾아내는가» 를 검증한다. 고정하면
//   그 테스트들이 검증하는 성질 자체가 사라진다.
vi.mock("@/lib/auth/member-org-summary", async (importOriginal) => {
  // BoardPage 자체도 이 모듈의 loadMemberOrgSummary(ctx 전용, WithClient 아님)를
  // loadDefaultTabAssignees 경유로 쓴다 — 통째로 갈아치우면 그쪽이 undefined 가 된다.
  const actual = await importOriginal<typeof import("@/lib/auth/member-org-summary")>();
  return {
    ...actual,
    loadMemberOrgSummaryWithClient: async () => ({
      kind: "ready",
      owner: { userId: "user-1", displayName: "멤버" },
      admins: [],
      members: [],
    }),
  };
});

import type { Ctx } from "@/lib/types";
import { CONTACT_TAB } from "@/lib/default-tabs";
import { ensureDefaultTabAdditive } from "@/lib/default-tabs/install";
import { LocalBoardsRepo, toAsyncBoardsRepo } from "@/lib/repo/local/boardsRepo";
import BoardPage from "./page";
import ContactBoardPage from "../../(tabs)/contract/page";
import NewCustomerPage from "../../(tabs)/newcust/page";
import { NEW_LEAD_TAB } from "@/lib/default-tabs/new-lead";
import AppLayout from "../../layout";

const BOARD_ID = "board-1";

function seed() {
  probe.tables.org_members = [
    {
      org_id: "org-1",
      user_id: "user-1",
      status: "active",
      role: "owner",
      scope: "all",
      created_at: "2026-01-01",
      users: { name: "멤버" },
      orgs: {
        id: "org-1",
        slug: "acme",
        status: "active",
        name: "우리 회사",
        plan_tier: "free",
        created_at: "2026-01-01",
      },
    },
  ];
  probe.tables.boards = [
    {
      id: BOARD_ID,
      org_id: "org-1",
      name: "신규리드 관리",
      icon: "💡",
      description: null,
      // 리드컨택 기본 탭 — 공지 탭이 아니라서 /boards/[id] 는 공지 읽음 처리 분기를 타지 않는다.
      source: "core.default-tab/contact",
      is_system: false,
      sort_order: 0,
    },
  ];
  probe.tables.board_columns = [];
  probe.tables.board_groups = [];
  probe.tables.items = [
    { id: "item-1", org_id: "org-1", board_id: BOARD_ID, group_id: null, title: "리드 1", assigned_to: "user-1", sort_order: 0 },
  ];
  probe.tables.item_values = [];
  probe.tables.tab_views = [{ id: "view-1", person_scope: "team", person_scope_user_id: null }];

  probe.rpcs.app_admin_role = null;
  probe.rpcs.effective_permission = true;
  probe.rpcs.read_permission_scoped_work_items = { itemIds: ["item-1"], hiddenCount: 0 };
  probe.rpcs.get_member_account_profile = { id: "user-1", name: "멤버", title: null, team_key: "team-a" };
}

async function renderBoard(searchParams: Record<string, string> = {}) {
  probe.reset();
  seed();
  await BoardPage({
    params: Promise.resolve({ id: BOARD_ID }),
    searchParams: Promise.resolve(searchParams),
  });
  return {
    trips: [...probe.trips],
    total: probe.trips.length,
    serialStages: new Set(probe.trips.map((t) => t.wave)).size,
    countOf: (label: string) => probe.trips.filter((t) => t.label === label).length,
  };
}

describe("BBE-214 · 보드 화면 한 번을 그리는 데 드는 DB 왕복", () => {
  beforeEach(() => probe.reset());

  // ── 하니스 자체 검증 ──
  // 「빨간불이 떠도 무엇이 빨갛게 했는지 확인해라」 — 페이지가 notFound() 로 조기 이탈하면
  // 왕복 수가 «작게» 나와서 «빨라 보이는» 거짓 통과가 된다. 그래서 먼저 경로를 확인한다.
  it("하니스가 실제 데이터 경로를 탄다 — 조기 이탈이 아니다", async () => {
    const run = await renderBoard();
    expect(run.countOf("auth.getUser")).toBe(1);
    expect(run.countOf("select:boards")).toBeGreaterThan(0);
    expect(run.countOf("select:items")).toBeGreaterThan(0);
  });

  it("측정 — 기본 테이블 뷰 (savedView 없음)", async () => {
    const run = await renderBoard();
    const byLabel = new Map<string, number>();
    for (const trip of run.trips) byLabel.set(trip.label, (byLabel.get(trip.label) ?? 0) + 1);
    console.log(
      `\n[측정] 기본 테이블 뷰\n  총 왕복 ${run.total}회 · 직렬 단계 ${run.serialStages}\n` +
        [...byLabel.entries()].map(([l, n]) => `    ${n}× ${l}`).join("\n") +
        "\n  순서: " + run.trips.map((t) => `${t.wave}:${t.label}`).join(" → ") + "\n",
    );
    expect(run.total).toBeGreaterThan(0);
  });

  // ★ 총괄이 말한 「보드이동」은 «탭 이동» 으로 보인다 (BBE-214 부수 확인).
  //   근거: AppTabs 는 `/boards/` 에서 return null 인데(AppTabs.tsx:44) 총괄 스크린샷에는
  //   탭 줄이 그려져 있다. 즉 그 화면은 보드 상세가 아니라 탭 경유 화면이다.
  //   그리고 `/contract` 는 «화면» 이 아니라 redirect 경유지다 — 서버 왕복을 한 벌 더 태운다.
  it("측정 — 탭 클릭 한 번(/contract → redirect → /boards/[id])", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.test";
    probe.reset();
    seed();
    // BBE-236 — 이 측정은 «이미 건강한 컨택 보드로 곧장 들어가는» 값을 재려는 것이지
    // additive repair 자체를 재려는 게 아니다(그건 contact/entry.test.ts 가 전담). seed()
    // 는 boards 행 하나만 최소로 채워서 CONTACT_TAB 의 실제 컬럼·그룹과는 다르다 — 그대로
    // 재면 readDefaultTabDrift 가 드리프트를 «진짜로» 찾아내 리스 경로를 타 버린다.
    //
    // ★ probe 는 «왕복 횟수를 세는» 가짜라 insert 를 실제로 저장하지 않는다(select 만
    //   흉내 낸다) — 그래서 reconciler 를 probe 에 직접 돌릴 수 없다. 대신 진짜 저장이
    //   되는 LocalBoardsRepo 에 reconciler 를 한 번 돌려 CONTACT_TAB 의 실제 그룹·컬럼
    //   (담당자 그룹 이름 인코딩 포함)을 만들고, 그 결과 행을 probe 테이블로 옮겨 심는다.
    const setupCtx = {
      org: { id: "org-1", name: "우리 회사" },
      user: { id: "user-1", name: "멤버", email: "member@example.test" },
      role: "owner",
      scope: "all",
    } as unknown as Ctx;
    const setupLocal = new LocalBoardsRepo();
    const ensured = await ensureDefaultTabAdditive(
      setupCtx,
      CONTACT_TAB,
      toAsyncBoardsRepo(setupLocal),
      [{ userId: "user-1", displayName: "멤버" }],
    );
    const healthyGroups = setupLocal.listGroups(setupCtx, ensured.boardId);
    const healthyColumns = setupLocal.listColumns(setupCtx, ensured.boardId);
    probe.tables.board_groups = healthyGroups.map((g, index) => ({
      id: g.id, org_id: "org-1", board_id: BOARD_ID, name: g.name, color: g.color, sort_order: index,
    }));
    probe.tables.board_columns = healthyColumns.map((c, index) => ({
      id: c.id, org_id: "org-1", board_id: BOARD_ID, key: c.key, label: c.label, type: c.type,
      source: c.source, sort_order: index, options_jsonb: c.options_jsonb,
      move_rule_jsonb: c.move_rule_jsonb ?? null, right_pinned: c.rightPinned,
      is_readonly: c.is_readonly ?? false, width: c.width,
    }));
    probe.reset();
    let redirected = false;
    try {
      await ContactBoardPage({ searchParams: Promise.resolve({}) });
    } catch (err) {
      redirected = (err as Error).message === "HARNESS_REDIRECT";
    }
    const entryTrips = [...probe.trips];
    const entryStages = new Set(entryTrips.map((t) => t.wave)).size;
    // 경유지가 «리다이렉트로 끝난다» 는 것 자체가 이 측정의 전제다. 아니면 숫자가 무의미하다.
    expect(redirected).toBe(true);

    const board = await renderBoard();

    console.log(
      `\n[측정] 탭 클릭 한 번 — 총괄이 겪는 경로\n` +
        `  ① /contract (경유지)   왕복 ${entryTrips.length}회 · 직렬 ${entryStages}\n` +
        `       ${entryTrips.map((t) => t.label).join(" → ")}\n` +
        `  ② /boards/[id] (본 화면) 왕복 ${board.total}회 · 직렬 ${board.serialStages}\n` +
        `  ─────────────────────────────────────────────\n` +
        `  합계  왕복 ${entryTrips.length + board.total}회 · 직렬 ${entryStages + board.serialStages}` +
        `  (HTTP 요청 2번 · 순차)\n`,
    );
    expect(entryTrips.length).toBeGreaterThan(0);
  });

  // ── 회귀 가드 ──
  // 「직렬 되돌리기」 변이용이다. service.ts 의 Promise.all 을 await 줄세우기로 되돌리면
  // 왕복 «횟수» 는 그대로인데 직렬 단계가 늘어난다 — 그래서 횟수가 아니라 단계를 잠근다.
  // 시간을 단언하지 않으므로 기계·부하와 무관하게 결정적으로 빨개진다.
  it("보드 화면의 직렬 단계가 예산을 넘지 않는다 — 병렬을 직렬로 되돌리면 빨개진다", async () => {
    const run = await renderBoard();
    // 측정값 12. 여유 1 만 둔다 — 병렬 하나만 풀려도 3 이상 늘어나므로 반드시 걸린다.
    expect(run.serialStages, "보드 화면의 직렬 DB 단계가 늘었다 — 어디서 await 이 줄 섰는지 확인해라")
      .toBeLessThanOrEqual(13);
  });

  it("getBoardDetail 의 세 읽기가 한 물결로 나간다", async () => {
    const run = await renderBoard();
    // boards · board_columns · board_groups 는 서로 독립이다. 같은 물결에 있어야 한다.
    const waveOf = (label: string) => run.trips.filter((t) => t.label === label).map((t) => t.wave);
    const boards = waveOf("select:boards");
    const columns = waveOf("select:board_columns");
    const groups = waveOf("select:board_groups");
    expect(boards.length, "보드 메타 읽기를 못 찾았다").toBeGreaterThan(0);
    expect(boards.length).toBe(columns.length);
    for (let i = 0; i < boards.length; i += 1) {
      expect(columns[i], "board_columns 가 boards 뒤 물결로 밀렸다 — 직렬로 되돌아갔다").toBe(boards[i]);
      expect(groups[i], "board_groups 가 boards 뒤 물결로 밀렸다 — 직렬로 되돌아갔다").toBe(boards[i]);
    }
  });

  it("측정 — savedView 붙은 테이블 뷰", async () => {
    const run = await renderBoard({ savedView: "view-1" });
    const byLabel = new Map<string, number>();
    for (const trip of run.trips) byLabel.set(trip.label, (byLabel.get(trip.label) ?? 0) + 1);
    console.log(
      `\n[측정] savedView 테이블 뷰\n  총 왕복 ${run.total}회 · 직렬 단계 ${run.serialStages}\n` +
        [...byLabel.entries()].map(([l, n]) => `    ${n}× ${l}`).join("\n") + "\n",
    );
    expect(run.total).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// BBE-214 후속 — 「경유지를 없앨 수 있는가」를 «재서» 답한다.
//
//   총괄의 말은 「정리해줘」였다. 경유지에 «로딩 중» 이라고 써 붙이는 것은
//   없어져야 할 화면에 이름표를 다는 것일 수 있다. 그래서 되물었다:
//   **탭 링크가 목적지 보드를 처음부터 가리킬 수 있는가?**
//
//   그 답은 「목적지를 서버에서만 알 수 있는가」에 달려 있다.
//   목적지 = 이 조직에서 source 가 해당 기본 탭인 보드의 id — 즉 «조직마다 다른 값» 이다.
//   클라이언트는 미리 못 안다. 하지만 **탭 줄을 그리는 것은 서버다**(layout.tsx).
//   그러니 서버가 그때 같이 계산해 href 에 박을 수 있는지가 관건이다.
// ═══════════════════════════════════════════════════════════════════════
describe("BBE-214 후속 · 탭 경유지를 없앨 수 있는가", () => {
  beforeEach(() => probe.reset());

  it("측정 — /contract 경유지는 «순수 조회» 다 (쓰기 0)", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.test";
    probe.reset();
    seed();
    try {
      await ContactBoardPage({ searchParams: Promise.resolve({}) });
    } catch { /* redirect */ }
    const trips = [...probe.trips];
    console.log(
      `\n[측정] /contract 경유지\n  왕복 ${trips.length}회 · 직렬 ${new Set(trips.map((t) => t.wave)).size}\n` +
        `  ${trips.map((t) => t.label).join(" → ")}\n`,
    );
    // ★ 핵심 판정: 목적지를 고르는 데 «쓰기» 가 전혀 없다.
    //   쓰기가 없으면 이 경유는 «계산» 일 뿐이고, 계산은 탭 줄을 그릴 때 같이 할 수 있다.
    //   (resolveExistingContactBoard 주석: "기존 보드를 고를 뿐 생성하지 않는다")
    const 보드조회 = trips.filter((t) => t.label === "select:boards").length;
    expect(보드조회, "목적지를 고르는 보드 조회가 없다").toBeGreaterThan(0);
  });

  // ★ /newcust 는 «순수 조회가 아니다» — 여기서 두 경유지의 답이 갈린다.
  //   repairNewcustBoardOnEntry 는 리스를 잡고 기본 탭 구조를 additive 로 «쓴다».
  //   즉 이 경유지는 «목적지 계산» 만 하는 게 아니라 «낡은 워크스페이스를 고치는» 일을 겸한다.
  //   그래서 링크를 목적지로 바로 꽂으면 그 치유가 영영 안 돈다 — 그냥 없앨 수 없다.
  it("측정 — /newcust 경유지는 «쓰기» 를 겸한다 (owner)", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.test";
    probe.reset();
    seed();
    // 리스가 안 잡히면 250ms × 40회 재시도로 테스트가 멎는다. 잡히는 경우를 잰다.
    probe.rpcs.acquire_default_tab_repair_lease = true;
    probe.rpcs.renew_default_tab_repair_lease = true;
    probe.rpcs.release_default_tab_repair_lease = true;
    try {
      await NewCustomerPage({ searchParams: Promise.resolve({}) });
    } catch { /* redirect 또는 repair 경로 */ }
    const trips = [...probe.trips];
    const 리스 = trips.filter((t) => t.label.includes("repair_lease")).length;
    console.log(
      `\n[측정] /newcust 경유지 (owner)\n  왕복 ${trips.length}회 · 직렬 ${new Set(trips.map((t) => t.wave)).size}\n` +
        `  리스 RPC ${리스}회 ← 이것이 «쓰기» 의 증거다\n` +
        `  ${trips.map((t) => t.label).join(" → ")}\n`,
    );
    // 리스를 잡는다는 것은 이 경유지가 «상태를 바꾼다» 는 뜻이다.
    expect(리스, "/newcust 가 리스를 잡지 않았다 — 쓰기 경로를 안 탔다").toBeGreaterThan(0);
  });

  // ★★ 진짜 급소 — «고칠 것이 하나도 없는» 워크스페이스도 같은 값을 치르는가.
  //
  //   ⚠ 처음 쟀을 때 이 시드가 틀렸다. 보드만 넣고 그룹·컬럼을 비워 뒀는데,
  //     그건 «정상» 이 아니라 «그룹 5개·컬럼 21개가 통째로 빠진 심한 드리프트» 였다.
  //     그래서 그때의 14왕복은 정상 케이스 값이 아니었다. 여기서 바로잡는다.
  //
  //   시드는 NEW_LEAD_TAB 정의에서 «직접» 만든다 — 손으로 적으면 정의가 바뀔 때
  //   시드만 낡아서 «정상이 아닌 것» 을 정상이라 부르게 된다.
  function seedHealthyNewLead() {
    probe.tables.boards = [
      { id: "board-newlead", org_id: "org-1", name: NEW_LEAD_TAB.name, icon: NEW_LEAD_TAB.icon ?? null, description: NEW_LEAD_TAB.description ?? null, source: NEW_LEAD_TAB.source, is_system: false, sort_order: 0 },
    ];
    probe.tables.board_groups = NEW_LEAD_TAB.groups.map((group, index) => ({
      id: `grp-${index}`, org_id: "org-1", board_id: "board-newlead", name: group.name, color: group.color, sort_order: index,
    }));
    probe.tables.board_columns = NEW_LEAD_TAB.columns.map((column, index) => ({
      id: `col-${index}`, org_id: "org-1", board_id: "board-newlead", key: column.key, label: column.label,
      type: column.type, source: column.source ?? "in", sort_order: index,
      options_jsonb: null, move_rule_jsonb: null, right_pinned: false, is_readonly: false, width: null,
    }));
    probe.rpcs.acquire_default_tab_repair_lease = true;
    probe.rpcs.renew_default_tab_repair_lease = true;
    probe.rpcs.release_default_tab_repair_lease = true;
  }

  async function runNewcust() {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.test";
    let threw: string | null = null;
    try {
      await NewCustomerPage({ searchParams: Promise.resolve({}) });
    } catch (err) {
      threw = (err as Error).message;
    }
    const trips = [...probe.trips];
    return {
      trips,
      threw,
      total: trips.length,
      stages: new Set(trips.map((t) => t.wave)).size,
      leases: trips.filter((t) => /^rpc-write:.*repair_lease/.test(t.label)).length,
      // «쓰기» 만 센다. 읽기(select:)를 같이 세면 치유가 죽어도 listGroups 읽기 때문에 초록이 된다.
      writes: trips.filter((t) => /^(insert|update|upsert|delete):/.test(t.label)).length,
    };
  }

  it("정상 워크스페이스에서는 락을 «잡지 않는다» (owner) — BBE-214 후속 1", async () => {
    probe.reset();
    seed();
    seedHealthyNewLead();
    const run = await runNewcust();
    console.log(
      `\n[측정] /newcust — 고칠 것이 «없는» 정상 워크스페이스 (owner)\n` +
        `  왕복 ${run.total}회 · 직렬 ${run.stages} · 리스 RPC ${run.leases}회\n` +
        `  종료: ${run.threw ?? "정상 반환"}\n` +
        `  ${run.trips.map((t) => t.label).join(" → ")}\n`,
    );
    // 하니스 자체 검증 — «정상» 이라면 리다이렉트로 끝나야 한다.
    // 중간에 터졌다면 정상 케이스를 잰 게 아니다(처음에 내가 그렇게 틀렸다).
    expect(run.threw, "정상 워크스페이스인데 리다이렉트로 끝나지 않았다 — 시드가 «정상» 이 아니다")
      .toBe("HARNESS_REDIRECT");
    // 고칠 것이 없으면 분산 락을 잡지 않는다 (측정 전: 리스 4회 · 왕복 14 → 후: 0회 · 왕복 9).
    expect(run.leases, "고칠 것이 없는데 분산 락을 잡았다 — 통행료가 되돌아왔다").toBe(0);
    // 그리고 애초에 쓸 것이 없었다는 사실도 함께 못 박는다.
    expect(run.writes, "고칠 것이 없는데 구조를 썼다").toBe(0);
  });

  // ★ DC-00 의 「이사 중 성질 유실」 잣대 — 빠른 길만 재고 느린 길을 안 재면
  //   최적화가 치유를 죽였는데 정상 케이스만 초록이라 못 본다.
  //   ensureDefaultTabAdditive 가 지고 있는 성질: 「드리프트가 있으면 반드시 고친다」.
  //   리스를 조건부로 만들 때 이 성질이 새면 아래가 빨개진다.
  it("성질 고정 — 컬럼 하나가 빠지면 락을 잡고 «고친다»", async () => {
    probe.reset();
    seed();
    seedHealthyNewLead();
    const dropped = probe.tables.board_columns.pop() as { key: string };
    const run = await runNewcust();
    console.log(
      `\n[성질] /newcust — 컬럼 «${dropped.key}» 가 빠진 워크스페이스 (owner)\n` +
        `  왕복 ${run.total}회 · 직렬 ${run.stages} · 리스 ${run.leases}회 · 구조 쓰기 ${run.writes}회\n`,
    );
    expect(run.leases, "드리프트가 있는데 리스를 안 잡았다 — 치유가 직렬화되지 않는다").toBeGreaterThan(0);
    expect(run.writes, "드리프트가 있는데 구조를 쓰지 않았다 — 치유가 죽었다").toBeGreaterThan(0);
  });

  it("성질 고정 — 그룹 하나가 빠지면 락을 잡고 «고친다»", async () => {
    probe.reset();
    seed();
    seedHealthyNewLead();
    const dropped = probe.tables.board_groups.pop() as { name: string };
    const run = await runNewcust();
    console.log(
      `\n[성질] /newcust — 그룹 «${dropped.name}» 가 빠진 워크스페이스 (owner)\n` +
        `  왕복 ${run.total}회 · 직렬 ${run.stages} · 리스 ${run.leases}회 · 구조 쓰기 ${run.writes}회\n`,
    );
    expect(run.leases, "드리프트가 있는데 리스를 안 잡았다").toBeGreaterThan(0);
    expect(run.writes, "드리프트가 있는데 구조를 쓰지 않았다 — 치유가 죽었다").toBeGreaterThan(0);
  });

  // ★ 후속2 착수 전 비용 확인 — 레이아웃은 «경로를 모른다».
  //   AppTabs 는 탭 화면에서만 그려지는데 레이아웃은 서버 컴포넌트라 usePathname 이 없다.
  //   그래서 탭 목적지를 레이아웃에서 풀면 «탭이 아닌 화면» 의 하드 로드에도 +1 왕복이 붙는다.
  //   그 +1 이 기존 비용 대비 얼마인지 알아야 판단할 수 있다 — 추측하지 않는다.
  it("측정 — (app) 레이아웃 한 번의 왕복 (후속2 비용 기준선)", async () => {
    probe.reset();
    seed();
    let threw: string | null = null;
    try {
      await AppLayout({ children: null });
    } catch (err) {
      threw = (err as Error).message;
    }
    const trips = [...probe.trips];
    const byLabel = new Map<string, number>();
    for (const t of trips) byLabel.set(t.label, (byLabel.get(t.label) ?? 0) + 1);
    console.log("[측정] (app) 레이아웃 1회 — 왕복 " + trips.length + "회 · 직렬 " + new Set(trips.map((t) => t.wave)).size + " · 종료: " + (threw ?? "정상 반환"));
    console.log("  내역: " + [...byLabel.entries()].map(([l, n]) => n + "x " + l).join(" | "));
    const byOrigin = new Map<string, number>();
    for (const t of trips) byOrigin.set((t.origin ?? "?") + " " + t.label, (byOrigin.get((t.origin ?? "?") + " " + t.label) ?? 0) + 1);
    console.log("  호출부별:");
    for (const [k, n] of [...byOrigin.entries()].sort((a, b) => b[1] - a[1])) console.log("    " + n + "x  " + k);
    // 하니스 자체 검증 — 레이아웃이 «끝까지» 돌았을 때의 값이어야 한다.
    // 중간에 터진 실행을 기준선으로 쓰면 +1 의 비중을 과대평가한다.
    expect(threw, "레이아웃이 정상 반환하지 않았다 — 이 값은 기준선이 아니다").toBe(null);
    expect(trips.length).toBeGreaterThan(0);
  });
});
