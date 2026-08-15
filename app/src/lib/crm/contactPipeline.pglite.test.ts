import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "../supabase/migrations/069_contact_pipeline_transitions.sql"), "utf8");
const ids = {
  org:"00000000-0000-4000-8000-000000000001", other:"00000000-0000-4000-8000-000000000002",
  user:"00000000-0000-4000-8000-000000000010", otherUser:"00000000-0000-4000-8000-000000000011", pipeline:"00000000-0000-4000-8000-000000000020",
  contact:"00000000-0000-4000-8000-000000000021", work:"00000000-0000-4000-8000-000000000022",
  board:"00000000-0000-4000-8000-000000000030", item:"00000000-0000-4000-8000-000000000031",
};

describe("BBE-152 PostgreSQL gate", () => {
  const opened: PGlite[]=[]; afterEach(async()=>{await Promise.all(opened.splice(0).map(db=>db.close()));});
  it("keeps a blocked board item immutable, then commits once and rejects another tenant", async () => {
    const db=new PGlite(); opened.push(db);
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
      create table public.orgs(id uuid primary key); create table public.users(id uuid primary key);
      create table public.org_members(org_id uuid,user_id uuid,role text,scope text,primary key(org_id,user_id));
      create table public.pipelines(id uuid primary key,org_id uuid,created_at timestamptz default now());
      create table public.stages(id uuid primary key,pipeline_id uuid references pipelines,kind text);
      create table public.companies(id uuid primary key default gen_random_uuid(),org_id uuid);
      create table public.deals(id uuid primary key default gen_random_uuid(),org_id uuid references orgs,assigned_to uuid,pipeline_id uuid,stage_id uuid,company_id uuid,custom jsonb default '{}',title text,updated_at timestamptz default now());
      create table public.activities(id uuid primary key default gen_random_uuid(),org_id uuid,deal_id uuid,type text,content text,actor uuid);
      create table public.boards(id uuid primary key,org_id uuid,source text);
      create table public.items(id uuid primary key,org_id uuid,board_id uuid,assigned_to uuid,title text);
      create table public.item_values(org_id uuid,item_id uuid,column_key text,value_jsonb jsonb,primary key(item_id,column_key));
      create function public.handoff_company_to_work(uuid,uuid,text,text,text,text,text,text,text,text,date,numeric,uuid,uuid)
      returns table(deal_id uuid,company_id uuid,mode text,duplicate_candidate_ids uuid[]) language plpgsql as $$
      declare c uuid:=gen_random_uuid(); d uuid:=coalesce($2,gen_random_uuid()); begin
        insert into public.companies values(c,$1); if $2 is null then insert into public.deals(id,org_id,assigned_to,title) values(d,$1,auth.uid(),$3); end if;
        update public.deals set company_id=c where id=d; return query select d,c,'created'::text,'{}'::uuid[]; end$$;
    `);
    await db.exec(migration);
    await db.exec(`
      insert into orgs values('${ids.org}'),('${ids.other}'); insert into users values('${ids.user}'),('${ids.otherUser}');
      insert into org_members values('${ids.org}','${ids.user}','member','assigned'),('${ids.org}','${ids.otherUser}','member','assigned');
      insert into pipelines(id,org_id) values('${ids.pipeline}','${ids.org}');
      insert into stages values('${ids.contact}','${ids.pipeline}','meeting'),('${ids.work}','${ids.pipeline}','work');
      insert into boards values('${ids.board}','${ids.org}','core.default-tab/contact');
      insert into items values('${ids.item}','${ids.org}','${ids.board}','${ids.user}','테스트 회사');
      insert into item_values values('${ids.org}','${ids.item}','work_move','"업무관리 이동"'),('${ids.org}','${ids.item}','seal_status','"대기"');
      select set_config('app.uid','${ids.user}',false);
    `);
    const request="00000000-0000-4000-8000-000000000099";
    const blocked=await db.query<{status:string;reason:string}>(`select status,reason from execute_contact_pipeline_transition('${ids.org}',null,'${ids.item}','${request}','contact_to_work',null,'테스트 회사')`);
    expect(blocked.rows[0]).toMatchObject({status:"blocked",reason:"대표 직인 승인이 필요합니다. 현재 직인 완료 = 대기"});
    expect((await db.query<{n:number}>("select count(*)::int n from deals")).rows[0].n).toBe(0);
    await db.exec(`update item_values set value_jsonb='"완료"' where item_id='${ids.item}' and column_key='seal_status'`);
    const committed=await db.query<{status:string;deal_id:string}>(`select status,deal_id from execute_contact_pipeline_transition('${ids.org}',null,'${ids.item}','${request}','contact_to_work',null,'테스트 회사')`);
    expect(committed.rows[0].status).toBe("committed");
    expect((await db.query<{kind:string}>(`select s.kind from deals d join stages s on s.id=d.stage_id where d.id='${committed.rows[0].deal_id}'`)).rows[0].kind).toBe("work");
    expect((await db.query<{n:number}>(`select count(*)::int n from contact_pipeline_transitions where request_id='${request}'`)).rows[0].n).toBe(1);
    await db.exec(`select set_config('app.uid','${ids.otherUser}',false)`);
    await expect(db.query(`select * from execute_contact_pipeline_transition('${ids.org}',null,'${ids.item}','${request}','contact_to_work',null,'테스트 회사')`)).rejects.toThrow(/transition unavailable/);
    await db.exec(`select set_config('app.uid','${ids.user}',false)`);
    await expect(db.query(`select * from execute_contact_pipeline_transition('${ids.other}','${committed.rows[0].deal_id}',null,gen_random_uuid(),'lead_to_contact')`)).rejects.toThrow(/transition unavailable/);
  });
});
