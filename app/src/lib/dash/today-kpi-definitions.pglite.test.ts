import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

// BBE-215 — 098 이 «실제로 돌고, 실제로 총괄 확정대로 센다» 를 잰다.
//
// ★ 왜 SQL 을 «실행» 해서 재는가
//   이 마이그레이션의 실패 모양은 「쿼리가 깨진다」가 아니라 **「쿼리는 성공하고 숫자만 0」** 이다.
//   문자열이 한 글자만 달라도(「상담 전」 vs 「상담전」) 조건이 안 맞고, 그건 **초록으로** 실패한다.
//   그래서 파일을 읽어 문자열을 대조하는 검사로는 부족하고, 실제로 심어서 세야 한다.
//
// ★ 이 파일이 지키는 것 넷
//   ① 세 KPI 가 상담 상황의 «서로 다른 값» 을 센다 — 그리고 «겹치지 않는다»
//   ② 계약 대기가 «계약서가 오가는 중» 만 센다 (취소·보류가 안 들어온다)
//   ③ 「0」과 「미입력」이 갈린다
//   ④ 금액 둘은 086 정의 그대로다 (바꾸지 않았다는 것도 지킨다)

const base = readFileSync(
  new URL("../../../../supabase/migrations/086_dashboard_daily_read_model.sql", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../../../../supabase/migrations/099_bbe215_today_kpi_definitions.sql", import.meta.url),
  "utf8",
);
const id = (value: number): string => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const ORG = id(1);
const OWNER = id(10);

describe("BBE-215 · 홈 KPI 정의 (098)", () => {
  const opened: PGlite[] = [];
  afterEach(async () => Promise.all(opened.splice(0).map((db) => db.close())));

  async function setup(): Promise<PGlite> {
    const db = new PGlite();
    opened.push(db);
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
      create table orgs(id uuid primary key, status text not null);
      create table users(id uuid primary key);
      create table org_members(org_id uuid, user_id uuid, role text, scope text, status text, primary key(org_id,user_id));
      create table boards(id uuid primary key, org_id uuid, source text);
      create table items(id uuid primary key, org_id uuid, board_id uuid, title text, assigned_to uuid);
      create table item_values(org_id uuid, item_id uuid, column_key text, value_jsonb jsonb, primary key(item_id,column_key));
      create table work_item_versions(org_id uuid, item_id uuid primary key, due_date date, workflow_status text);
      create table notifications(id uuid primary key, org_id uuid, user_id uuid, type text, title text, body text,
        target_type text, target_id uuid, is_action boolean, read_at timestamptz, resolved_at timestamptz, created_at timestamptz);
      create table onboarding_quest_defs(quest_key text primary key, sort_order int default 0);
      create table onboarding_quest_progress(org_id uuid, quest_key text, completed_at timestamptz default now(), primary key(org_id, quest_key));
      create function effective_permission(p_org uuid, p_key text) returns boolean language sql stable as $$
        select p_key='work.view_tabs' and exists(select 1 from org_members where org_id=p_org and user_id=auth.uid() and status='active') $$;
      -- 가드는 이 테스트의 대상이 아니다. 마이그레이션이 부르므로 자리만 만든다.
      create function begin_guarded_migration(
        p_logical_key text, p_file_name text, p_file_digest text,
        p_expected_predecessor text, p_executor text, p_thread_id text, p_foundation boolean
      ) returns void language sql as $$ select $$;
      grant usage on schema public to authenticated;
      insert into orgs values ('${ORG}','active');
      insert into users values ('${OWNER}');
      insert into org_members values ('${ORG}','${OWNER}','owner','all','active');
      insert into boards values
        ('${id(24)}','${ORG}','core.default-tab/new-lead'),
        ('${id(20)}','${ORG}','core.default-tab/contact'),
        ('${id(21)}','${ORG}','core.default-tab/contract-work');
    `);
    await db.exec(base);
    await db.exec(migration);
    await db.exec(`set app.uid = '${OWNER}'`);
    return db;
  }

  async function read(db: PGlite): Promise<Record<string, never>> {
    const result = await db.query<{ read_today_dashboard: unknown }>(
      `select read_today_dashboard('${ORG}'::uuid, '2026-08-18T04:00:00Z'::timestamptz)`,
    );
    return (result.rows[0] as { read_today_dashboard: Record<string, never> }).read_today_dashboard;
  }

  /** 신규리드 항목 하나를 주어진 상담 상황으로 심는다. */
  async function lead(db: PGlite, itemId: number, consult: string | null): Promise<void> {
    await db.exec(`insert into items values ('${id(itemId)}','${ORG}','${id(24)}','lead','${OWNER}')`);
    if (consult !== null) {
      await db.exec(
        `insert into item_values values ('${ORG}','${id(itemId)}','consult_status','"${consult}"')`,
      );
    }
  }

  it("★ ① 세 KPI 가 상담 상황의 «서로 다른 값» 을 센다 — 겹치지 않는다", async () => {
    const db = await setup();
    await lead(db, 100, "상담 전");
    await lead(db, 101, "상담 전");
    await lead(db, 102, "1차 부재");
    await lead(db, 103, "2차 상담예약");
    // 아래 셋은 «오늘 할 행동이 없는» 상태 — 어느 칸에도 들면 안 된다.
    await lead(db, 104, "2차 상담완료");
    await lead(db, 105, "보류");
    await lead(db, 106, "거절");

    const snapshot = await read(db);
    const kpis = snapshot.kpis as unknown as Record<string, number>;

    expect(kpis.calls, "전화예정 = 「상담 전」").toBe(2);
    expect(kpis.callbacks, "재통화 대기 = 「1차 부재」").toBe(1);
    expect(kpis.meetings, "미팅예정 = 「2차 상담예약」").toBe(1);

    // ★ 겹침이 «구조적으로» 불가능하다는 주장을 숫자로 확인한다.
    //   항목 7개 중 셋에 든 것은 4개뿐이고, 합이 항목 수를 넘지 않는다.
    expect(kpis.calls + kpis.callbacks + kpis.meetings).toBe(4);
  });

  it("★ ② 계약 대기는 «계약서가 오가는 중» 만 센다 — 취소·보류는 안 든다", async () => {
    const db = await setup();
    const contact = async (itemId: number, status: string): Promise<void> => {
      await db.exec(`insert into items values ('${id(itemId)}','${ORG}','${id(20)}','c','${OWNER}')`);
      await db.exec(`insert into item_values values ('${ORG}','${id(itemId)}','contract_status','"${status}"')`);
    };
    await contact(200, "계약서 요청");
    await contact(201, "계약서 작성완료");
    // ↓ 종전 정의(「계약상황이 있기만 하면」)에서는 이 넷이 전부 «대기» 로 세어졌다.
    await contact(202, "계약취소");
    await contact(203, "연결안됨");
    await contact(204, "미팅취소");
    await contact(205, "계약 전");

    const kpis = (await read(db)).kpis as unknown as Record<string, number>;
    expect(kpis.contractsWaiting, "계약서 요청 + 계약서 작성완료 만").toBe(2);
  });

  it("★ ③ 「0」과 「미입력」이 갈린다 — 컬럼 이름까지 말한다", async () => {
    const db = await setup();
    // 항목은 «있는데» 상담 상황을 아무도 안 채웠다.
    await lead(db, 300, null);
    await lead(db, 301, null);

    const snapshot = await read(db);
    const kpis = snapshot.kpis as unknown as Record<string, number>;

    expect(kpis.calls, "값이 없으니 숫자는 0 이다").toBe(0);
    // ★ 그런데 그 0 은 「없음」이 아니라 「미입력」이다. 상태가 그걸 말해야 한다.
    expect(snapshot.status, "미입력을 empty 로 접으면 안 된다").toBe("unfilled");
    expect(snapshot.unfilledColumns as unknown as string[], "어느 컬럼인지 말해야 한다")
      .toContain("consult_status");
  });

  it("★ ③-2 값이 «채워져 있는데» 조건에 안 맞으면 그건 진짜 0 이다", async () => {
    const db = await setup();
    await lead(db, 310, "거절");

    const snapshot = await read(db);
    expect((snapshot.kpis as unknown as Record<string, number>).calls).toBe(0);
    // 채워져 있으므로 unfilled 가 아니다 — 「없음」과 「미입력」이 실제로 갈린다.
    expect(snapshot.unfilledColumns as unknown as string[]).not.toContain("consult_status");
    expect(snapshot.status).not.toBe("unfilled");
  });

  it("④ 금액 둘은 086 정의 그대로다 — 수납일 기준(바꾸지 않았다)", async () => {
    const db = await setup();
    await db.exec(`
      insert into items values ('${id(400)}','${ORG}','${id(21)}','w','${OWNER}');
      insert into item_values values
        ('${ORG}','${id(400)}','contract_deposit','1000'),
        ('${ORG}','${id(400)}','contract_deposit_paid_on','"2026-08-05"'),
        ('${ORG}','${id(400)}','fee_amount','200'),
        ('${ORG}','${id(400)}','fee_paid_on','"2026-07-31"');
    `);

    const kpis = (await read(db)).kpis as unknown as Record<string, number>;
    expect(Number(kpis.contractDeposits), "이번 달 수납분만").toBe(1000);
    expect(Number(kpis.fees), "지난 달 수납분은 안 든다").toBe(0);
  });

  it("⑤ 온보딩 진행률 — 정의가 있으면 세고, 없으면 null 이다", async () => {
    const db = await setup();
    await db.exec(`
      insert into onboarding_quest_defs values ('a',1),('b',2),('c',3),('d',4),
        ('e',5),('f',6),('g',7),('h',8);
      insert into onboarding_quest_progress(org_id, quest_key) values
        ('${ORG}','a'),('${ORG}','b'),('${ORG}','c');
    `);

    const onboarding = (await read(db)).onboarding as unknown as { completed: number; total: number };
    expect(onboarding, "목업의 (3/8)").toEqual({ completed: 3, total: 8 });
  });

  it("⑤-2 온보딩 정의가 하나도 없으면 «(0/0)» 이 아니라 null 이다", async () => {
    const db = await setup();
    // 없는 숫자를 지어내지 않는다 — 화면이 「(0/0)」을 그리면 그것도 거짓이다.
    expect((await read(db)).onboarding).toBeNull();
  });

  // ★ BBE-215 / 회사 현황 통합(A안) — 「이번 달 수납 0」이 두 가지 뜻이 되는 것을 막는다.
  //   회사 현황 위젯이 이 RPC 값을 «그대로» 받아 쓰기로 했으므로(출처 하나),
  //   0 이 「이번 달에 없다」인지 「아무도 입금일을 안 채웠다」인지 소비자가 갈라야 한다.
  //   ★ 새 필드를 만들지 않고 unfilledColumns 를 재사용한다 — 같은 것을 두 방법으로 말하면
  //     둘 다 맞게 유지하는 일이 영원히 남는다.
  it("★ 입금일이 통째로 비면 unfilledColumns 가 그 컬럼을 말한다", async () => {
    const db = await setup();
    // 계약업체 실무 항목은 있는데 입금일이 하나도 없다.
    await db.exec(`
      insert into items values ('${id(500)}','${ORG}','${id(21)}','w','${OWNER}');
      insert into item_values values
        ('${ORG}','${id(500)}','contract_deposit','1000'),
        ('${ORG}','${id(500)}','fee_amount','200');
    `);

    const snapshot = await read(db);
    const kpis = snapshot.kpis as unknown as Record<string, number>;
    const unfilled = snapshot.unfilledColumns as unknown as string[];

    expect(Number(kpis.contractDeposits), "금액은 0 이다").toBe(0);
    expect(Number(kpis.fees)).toBe(0);
    // ★ 그 0 은 「없다」가 아니라 「미입력」이다.
    expect(unfilled).toContain("contract_deposit_paid_on");
    expect(unfilled).toContain("fee_paid_on");
  });

  it("★ 입금일이 «채워져» 있으면 이번 달이 아니어도 미입력이 아니다 — 그건 진짜 0 이다", async () => {
    const db = await setup();
    await db.exec(`
      insert into items values ('${id(510)}','${ORG}','${id(21)}','w','${OWNER}');
      insert into item_values values
        ('${ORG}','${id(510)}','contract_deposit','1000'),
        ('${ORG}','${id(510)}','contract_deposit_paid_on','"2026-07-05"'),
        ('${ORG}','${id(510)}','fee_amount','200'),
        ('${ORG}','${id(510)}','fee_paid_on','"2026-07-31"');
    `);

    const snapshot = await read(db);
    const unfilled = snapshot.unfilledColumns as unknown as string[];

    // 지난 달 수납이라 이번 달 숫자는 0 이지만, 입력은 돼 있다.
    expect(Number((snapshot.kpis as unknown as Record<string, number>).fees)).toBe(0);
    expect(unfilled).not.toContain("fee_paid_on");
    expect(unfilled).not.toContain("contract_deposit_paid_on");
  });
});
