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



function seedRows() {
  probe.tables.org_members = [{
    org_id: "org-1", user_id: "user-1", status: "active", role: "owner", scope: "all",
    created_at: "2026-01-01", users: { name: "m" },
    orgs: { id: "org-1", slug: "acme", status: "active", name: "c", plan_tier: "free", created_at: "2026-01-01" },
  }];
  probe.tables.boards = [];
  probe.tables.board_columns = [];
  probe.tables.board_groups = [];
  probe.tables.items = [];
  probe.tables.item_values = [];
  probe.tables.tab_views = [];
  probe.rpcs.app_admin_role = null;
  probe.rpcs.effective_permission = true;
}

async function measure(label: string, fn: () => Promise<unknown>) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.test";
  probe.reset();
  seedRows();
  try { await fn(); } catch { /* redirect */ }
  const trips = [...probe.trips];
  const stages = new Set(trips.map((t) => t.wave)).size;
  console.log(`
[MEASURE] ${label}  roundtrips ${trips.length} / serial ${stages}`);
  console.log("  waves: " + trips.map((t) => `${t.wave}:${t.label}`).join(" "));
  return { total: trips.length, stages };
}

import HomeTop from "./page";
import { CompanyStatusSection } from "@/components/dash/CompanyStatusSection";


/**
 * BBE-215 — 홈의 «직렬 DB 단계» 예산.
 *
 * ★ 왜 예산을 «세우는가»: 홈은 「전원이 매번, 로그인 직후」 보는 화면이다. 여기가 무거워지면
 *   모두가 매번 그 값을 문다. boards/[id] 가 BBE-214 에서 예산을 세운 뒤 첫 손님(이 카드)이
 *   옳은 모양으로 들어왔다 — 지금 세워두지 않으면 다음 손님이 또 늘린다.
 *
 * ★ 왜 «횟수» 가 아니라 «단계» 인가: BBE-214 가 세운 것 — 왕복 25가 그대로여도 직렬 20→12면
 *   사용자는 빨라진 것을 느낀다. 체감 지연은 임계 경로 길이다.
 *
 * ★ 한계: 홈 페이지 함수를 그대로 밀면 «중첩 async 서버 컴포넌트» 인 CompanyStatusSection 이
 *   실행되지 않는다(요소만 만들어진다). 그래서 두 층을 «따로» 잰다. 합이 곧 홈의 임계 경로다.
 */
describe("BBE-215 · 홈 직렬 단계 예산", () => {
  beforeEach(() => probe.reset());

  // 되돌리면 빨개진다: server.ts 에서 boards·notices 를 crm 뒤 물결로 되돌리기
  it("★ 회사 현황 절의 직렬 단계가 예산을 넘지 않는다", async () => {
    const ctx = { user: { id: "user-1" }, org: { id: "org-1" }, role: "owner", scope: "all", isPlatformAdmin: false } as never;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.test";
    probe.reset();
    seedRows();
    try {
      await CompanyStatusSection({ ctx, month: undefined, today: { kind: "unconfigured" } });
    } catch { /* redirect 없음 */ }
    const stages = new Set(probe.trips.map((t) => t.wave)).size;
    // 실측 2. 여유 1 만 둔다 — 병렬 하나만 풀려도 3 을 넘는다.
    expect(stages, "회사 현황의 직렬 DB 단계가 늘었다 — 어디서 await 이 줄 섰는지 확인해라")
      .toBeLessThanOrEqual(3);
  });

  it("★ 홈 위쪽(오늘)의 직렬 단계가 예산을 넘지 않는다", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.test";
    probe.reset();
    seedRows();
    try {
      await HomeTop({ searchParams: Promise.resolve({}) });
    } catch { /* redirect */ }
    const stages = new Set(probe.trips.map((t) => t.wave)).size;
    // 실측 4(세션 3 + read_today_dashboard 1). 여유 1.
    expect(stages, "홈 위쪽의 직렬 DB 단계가 늘었다").toBeLessThanOrEqual(5);
  });
});
