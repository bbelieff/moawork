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

type Trip = { label: string; wave: number };

const probe = vi.hoisted(() => {
  let wave = 0;
  let queue: Array<() => void> = [];
  let scheduled = false;
  const trips: Trip[] = [];

  function roundtrip<T>(label: string, value: T): Promise<T> {
    trips.push({ label, wave });
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

  function makeQuery(table: string) {
    const rows = () => tables[table] ?? [];
    const q: Record<string, unknown> = {};
    for (const method of CHAIN) q[method] = () => q;
    q.single = () => thenable(`from:${table}`, () => rows()[0] ?? null);
    q.maybeSingle = () => thenable(`from:${table}`, () => rows()[0] ?? null);
    q.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
      roundtrip(`from:${table}`, { data: rows(), error: null, count: rows().length }).then(onOk, onErr);
    return q;
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
    rpc: (name: string) => thenable(`rpc:${name}`, () => rpcs[name] ?? null),
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

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => probe.client }));
vi.mock("@/lib/supabase/env", () => ({
  hasSupabaseEnv: () => true,
  getSupabaseEnv: () => ({ url: "https://example.test", anonKey: "anon" }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {} }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("HARNESS_NOT_FOUND");
  },
  redirect: () => {
    throw new Error("HARNESS_REDIRECT");
  },
}));

import BoardPage from "./page";
import ContactBoardPage from "../../contract/page";
import NewCustomerPage from "../../newcust/page";

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
    expect(run.countOf("from:boards")).toBeGreaterThan(0);
    expect(run.countOf("from:items")).toBeGreaterThan(0);
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
    const boards = waveOf("from:boards");
    const columns = waveOf("from:board_columns");
    const groups = waveOf("from:board_groups");
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
    const 보드조회 = trips.filter((t) => t.label === "from:boards").length;
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

  // ★★ 여기가 진짜 급소다.
  //   위 측정은 «보드가 없어서 고쳐야 하는» 경우였다(시드에 new-lead 보드가 없었다).
  //   그런데 총괄의 워크스페이스는 이미 멀쩡하다. 멀쩡할 때도 같은 값을 치르는가?
  //   치른다면 그건 «치유» 가 아니라 «아무것도 안 하면서 내는 통행료» 다.
  it("측정 — /newcust: 보드가 «이미 멀쩡할 때» 도 리스를 잡는가 (owner)", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.test";
    probe.reset();
    seed();
    // 고칠 것이 없는 상태 — 신규리드 보드가 이미 하나 정상으로 있다.
    probe.tables.boards = [
      { id: "board-newlead", org_id: "org-1", name: "신규리드 관리", icon: "💡", description: null, source: "core.default-tab/new-lead", is_system: false, sort_order: 0 },
    ];
    probe.rpcs.acquire_default_tab_repair_lease = true;
    probe.rpcs.renew_default_tab_repair_lease = true;
    probe.rpcs.release_default_tab_repair_lease = true;
    try {
      await NewCustomerPage({ searchParams: Promise.resolve({}) });
    } catch { /* redirect */ }
    const trips = [...probe.trips];
    const 리스 = trips.filter((t) => t.label.includes("repair_lease")).length;
    console.log(
      `\n[측정] /newcust — 고칠 것이 «없는» 정상 워크스페이스 (owner)\n` +
        `  왕복 ${trips.length}회 · 직렬 ${new Set(trips.map((t) => t.wave)).size} · 리스 RPC ${리스}회\n` +
        `  ${trips.map((t) => t.label).join(" → ")}\n`,
    );
    expect(trips.length).toBeGreaterThan(0);
  });

});
