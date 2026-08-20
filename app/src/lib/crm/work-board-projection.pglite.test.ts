import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * BBE-235 · 「업무관리 이동」이 계약업체 실무 보드에 «행» 을 만드는가.
 *
 * ★ 이 파일은 069 와 099 를 «둘 다» 실행한다. 099 만 돌리면 트리거가 붙을 테이블이 없다.
 *   그리고 069 의 contact_to_work 커밋 경로가 둘이라 «두 경로 모두» 를 재현한다 —
 *   한쪽만 재면 다른 쪽이 조용히 안 되는 형태를 못 잡는다.
 */
const transitions = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/069_contact_pipeline_transitions.sql"),
  "utf8",
);
const projection = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/100_bbe235_work_board_projection.sql"),
  "utf8",
);

const ids = {
  org: "00000000-0000-4000-8000-000000000001",
  user: "00000000-0000-4000-8000-000000000010",
  pipeline: "00000000-0000-4000-8000-000000000020",
  contact: "00000000-0000-4000-8000-000000000021",
  work: "00000000-0000-4000-8000-000000000022",
  contactBoard: "00000000-0000-4000-8000-000000000030",
  item: "00000000-0000-4000-8000-000000000031",
  workBoard: "00000000-0000-4000-8000-000000000040",
  workGroup: "00000000-0000-4000-8000-000000000041",
};

/** 069 테스트와 같은 최소 스키마 + 099 가 필요로 하는 컬럼(deleted_at·group_id·sort_order). */
const SCHEMA = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
  create table public.orgs(id uuid primary key);
  create table public.users(id uuid primary key);
  create table public.org_members(org_id uuid,user_id uuid,role text,scope text,primary key(org_id,user_id));
  create table public.pipelines(id uuid primary key,org_id uuid,created_at timestamptz default now());
  create table public.stages(id uuid primary key,pipeline_id uuid references pipelines,kind text);
  create table public.companies(id uuid primary key default gen_random_uuid(),org_id uuid);
  create table public.deals(id uuid primary key default gen_random_uuid(),org_id uuid references orgs,assigned_to uuid,pipeline_id uuid,stage_id uuid,company_id uuid,custom jsonb default '{}',title text,updated_at timestamptz default now());
  create table public.activities(id uuid primary key default gen_random_uuid(),org_id uuid,deal_id uuid,type text,content text,actor uuid);
  create table public.boards(id uuid primary key,org_id uuid,source text);
  create table public.board_groups(id uuid primary key,org_id uuid,board_id uuid,name text,sort_order int default 0);
  create table public.items(id uuid primary key default gen_random_uuid(),org_id uuid,board_id uuid,group_id uuid,assigned_to uuid,title text,deal_id uuid,deleted_at timestamptz);
  create table public.item_values(org_id uuid,item_id uuid,column_key text,value_jsonb jsonb,primary key(item_id,column_key));
  create unique index items_active_deal_projection_uq on public.items(org_id,deal_id) where deal_id is not null and deleted_at is null;
  -- 가드는 이 테스트의 대상이 아니다. 마이그레이션이 부르므로 자리만 만든다(098 테스트와 같은 방식).
  create function public.begin_guarded_migration(
    p_logical_key text, p_file_name text, p_file_digest text,
    p_expected_predecessor text, p_executor text, p_thread_id text, p_foundation boolean
  ) returns void language sql as $$ select $$;
  create function public.handoff_company_to_work(uuid,uuid,text,text,text,text,text,text,text,text,date,numeric,uuid,uuid)
  returns table(deal_id uuid,company_id uuid,mode text,duplicate_candidate_ids uuid[]) language plpgsql as $$
  declare c uuid:=gen_random_uuid(); d uuid:=coalesce($2,gen_random_uuid()); begin
    insert into public.companies values(c,$1);
    if $2 is null then insert into public.deals(id,org_id,assigned_to,title) values(d,$1,auth.uid(),$3); end if;
    update public.deals set company_id=c where id=d; return query select d,c,'created'::text,'{}'::uuid[]; end$$;
`;

const SEED = `
  insert into orgs values('${ids.org}'); insert into users values('${ids.user}');
  insert into org_members values('${ids.org}','${ids.user}','owner','all');
  insert into pipelines(id,org_id) values('${ids.pipeline}','${ids.org}');
  insert into stages values('${ids.contact}','${ids.pipeline}','meeting'),('${ids.work}','${ids.pipeline}','work');
  insert into boards values('${ids.contactBoard}','${ids.org}','core.default-tab/contact');
  insert into items(id,org_id,board_id,assigned_to,title) values('${ids.item}','${ids.org}','${ids.contactBoard}','${ids.user}','테스트 업체');
  insert into item_values values('${ids.org}','${ids.item}','work_move','"업무관리 이동"'),('${ids.org}','${ids.item}','seal_status','"완료"');
  select set_config('app.uid','${ids.user}',false);
`;

const WORK_BOARD = `
  insert into boards values('${ids.workBoard}','${ids.org}','core.default-tab/contract-work');
  insert into board_groups values('${ids.workGroup}','${ids.org}','${ids.workBoard}','진행중',0);
`;

async function boot(withWorkBoard: boolean) {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(transitions);
  await db.exec(projection);
  await db.exec(SEED);
  if (withWorkBoard) await db.exec(WORK_BOARD);
  return db;
}

const countItems = async (db: PGlite) =>
  (await db.query<{ n: number }>(`select count(*)::int n from items where board_id='${ids.workBoard}'`)).rows[0].n;

describe("BBE-235 · 업무관리 이동 → 계약업체 실무 보드 투영", () => {
  const opened: PGlite[] = [];
  afterEach(async () => { await Promise.all(opened.splice(0).map((db) => db.close())); });

  it("컨택 보드 항목에서 이동하면 실무 보드에 그 딜의 행이 생기고, 두 번 해도 하나다", async () => {
    const db = await boot(true); opened.push(db);
    const request = "00000000-0000-4000-8000-000000000099";

    expect(await countItems(db)).toBe(0);

    const first = await db.query<{ status: string; deal_id: string }>(
      `select status,deal_id from execute_contact_pipeline_transition('${ids.org}',null,'${ids.item}','${request}','contact_to_work',null,'테스트 업체')`,
    );
    expect(first.rows[0].status).toBe("committed");

    // ① 행이 생겼다
    expect(await countItems(db)).toBe(1);

    // ② 그 행이 deal 과 연결돼 있다 — 연결이 없으면 수금 값이 어느 딜 것인지 모른다
    const row = await db.query<{ deal_id: string; group_id: string; title: string }>(
      `select deal_id,group_id,title from items where board_id='${ids.workBoard}'`,
    );
    expect(row.rows[0].deal_id).toBe(first.rows[0].deal_id);
    expect(row.rows[0].group_id).toBe(ids.workGroup);
    expect(row.rows[0].title).toBe("테스트 업체");

    // ③ 같은 요청을 다시 보내도 행이 하나다 (멱등)
    await db.query(
      `select * from execute_contact_pipeline_transition('${ids.org}',null,'${ids.item}','${request}','contact_to_work',null,'테스트 업체')`,
    );
    expect(await countItems(db)).toBe(1);
  });

  it("직인이 대기면 blocked 이고, 그때는 행을 만들지 않는다", async () => {
    const db = await boot(true); opened.push(db);
    await db.exec(`update item_values set value_jsonb='"대기"' where item_id='${ids.item}' and column_key='seal_status'`);
    const blocked = await db.query<{ status: string }>(
      `select status from execute_contact_pipeline_transition('${ids.org}',null,'${ids.item}',gen_random_uuid(),'contact_to_work',null,'테스트 업체')`,
    );
    expect(blocked.rows[0].status).toBe("blocked");
    // 막힌 전이가 행을 만들면 «승인 안 난 건» 이 수금 보드에 뜬다
    expect(await countItems(db)).toBe(0);
  });

  it("실무 보드가 없는 조직에서도 이동 자체는 성공한다 — 투영만 건너뛴다", async () => {
    const db = await boot(false); opened.push(db);
    const committed = await db.query<{ status: string }>(
      `select status from execute_contact_pipeline_transition('${ids.org}',null,'${ids.item}',gen_random_uuid(),'contact_to_work',null,'테스트 업체')`,
    );
    // 투영이 전이를 실패시키면 계약업체 실무 탭이 없는 조직은 업무관리 이동을 아예 못 하게 된다
    expect(committed.rows[0].status).toBe("committed");
    expect((await db.query<{ n: number }>("select count(*)::int n from items where deal_id is not null")).rows[0].n).toBe(0);
  });

  it("이미 살아 있는 투영이 있으면 두 번째 딜 이동이 그것을 건드리지 않는다", async () => {
    const db = await boot(true); opened.push(db);
    const first = await db.query<{ deal_id: string }>(
      `select deal_id from execute_contact_pipeline_transition('${ids.org}',null,'${ids.item}',gen_random_uuid(),'contact_to_work',null,'테스트 업체')`,
    );
    expect(await countItems(db)).toBe(1);
    // 소프트 삭제된 투영은 «없는 것» 으로 본다 — 유니크 인덱스와 같은 조건
    await db.exec(`update items set deleted_at=now() where deal_id='${first.rows[0].deal_id}'`);
    await db.exec(`
      insert into items(id,org_id,board_id,assigned_to,title) values(gen_random_uuid(),'${ids.org}','${ids.contactBoard}','${ids.user}','두번째 업체');
    `);
    const second = await db.query<{ id: string }>(`select id from items where title='두번째 업체'`);
    await db.exec(`
      insert into item_values values('${ids.org}','${second.rows[0].id}','work_move','"업무관리 이동"'),('${ids.org}','${second.rows[0].id}','seal_status','"완료"');
    `);
    await db.query(
      `select * from execute_contact_pipeline_transition('${ids.org}',null,'${second.rows[0].id}',gen_random_uuid(),'contact_to_work',null,'두번째 업체')`,
    );
    // 살아 있는 투영 1 + 삭제된 투영 1
    expect((await db.query<{ n: number }>(`select count(*)::int n from items where board_id='${ids.workBoard}' and deleted_at is null`)).rows[0].n).toBe(1);
  });
});
