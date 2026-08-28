import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateCell } from "./cells";

const ids={org:"00000000-0000-4000-8000-000000000001",other:"00000000-0000-4000-8000-000000000002",actor:"00000000-0000-4000-8000-000000000010",outsider:"00000000-0000-4000-8000-000000000011",board:"00000000-0000-4000-8000-000000000020",otherBoard:"00000000-0000-4000-8000-000000000021",g1:"00000000-0000-4000-8000-000000000030",g2:"00000000-0000-4000-8000-000000000031",a:"00000000-0000-4000-8000-000000000040",b:"00000000-0000-4000-8000-000000000041",c:"00000000-0000-4000-8000-000000000042",col1:"00000000-0000-4000-8000-000000000050",col2:"00000000-0000-4000-8000-000000000051"};
const request=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
let db:PGlite;

async function move(args:{item:string;group:string|null;before?:string|null;version:number;request:number}){
  return db.query<{item_id:string;target_group_id:string|null;before_item_id:string|null;version:number;replayed:boolean}>(
    "select * from public.move_board_row_atomic($1,$2,$3,$4,$5,$6,$7)",
    [ids.org,ids.board,args.item,args.group,args.before??null,args.version,request(args.request)],
  );
}
async function setValuesMove(args:{item:string;group:string|null;values:Record<string,unknown>;version:number;request:number}){
  return db.query<{item_id:string;version:number;replayed:boolean}>(
    "select * from public.set_board_item_values_with_atomic_move($1,$2,$3,$4,$5,$6,$7,$8)",
    [ids.org,ids.board,args.item,JSON.stringify(args.values),args.group,null,args.version,request(args.request)],
  );
}

beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.actor',true),'')::uuid$$;
    create type public.member_role as enum('owner','admin','member');
    create type public.member_scope as enum('all','assigned');
    create type public.field_type as enum('text','longtext','number','date','datetime','select','multiselect','phone','email','file','person','url','checkbox','status','people','money','calc','other_info');
    create table public.orgs(id uuid primary key,status text not null default 'active');
    create table public.users(id uuid primary key);
    create table public.org_members(org_id uuid,user_id uuid,status text,role text,scope text,primary key(org_id,user_id));
    create table public.boards(id uuid primary key,org_id uuid not null references public.orgs(id),source text,is_system boolean not null default false,updated_at timestamptz default now());
    create table public.board_groups(id uuid primary key,org_id uuid not null,board_id uuid not null references public.boards(id),name text default 'group',color text,sort_order integer not null default 0);
    create table public.board_columns(id uuid primary key default gen_random_uuid(),org_id uuid not null,board_id uuid not null,key text not null,label text not null default 'column',type public.field_type not null default 'text',source text not null default 'in',options_jsonb jsonb,sort_order integer not null default 0,width integer,right_pinned boolean not null default false,move_rule_jsonb jsonb,is_readonly boolean not null default false,is_required boolean not null default false,validation_jsonb jsonb not null default '{}',edit_policy_jsonb jsonb not null default '{}',archived_at timestamptz);
    create table public.items(id uuid primary key,org_id uuid not null,board_id uuid not null references public.boards(id),group_id uuid,title text not null,assigned_to uuid,deal_id uuid,sort_order integer not null,deleted_at timestamptz,updated_at timestamptz default now());
    create table public.item_values(org_id uuid not null,item_id uuid not null references public.items(id),column_key text not null,value_jsonb jsonb,primary key(item_id,column_key));
    create table public.board_automation_execution_requests(execution_key text primary key,org_id uuid,item_id uuid,rule_id uuid,from_group_id uuid,source_column_key text,source_label_id text,visited_rule_ids jsonb,state text,outcome jsonb,terminal_at timestamptz);
    create table public.board_automation_rules(id uuid primary key,org_id uuid,board_id uuid,to_group_id uuid,enabled boolean,status_column_key text,trigger_label_id text,conditions jsonb);
    create table public.work_command_receipts(org_id uuid,request_id uuid,result_jsonb jsonb,actor uuid,board_id uuid,operation text,primary key(org_id,request_id));
    create table public.work_item_versions(org_id uuid,item_id uuid primary key,version integer default 0,due_date date,workflow_status text,updated_at timestamptz default now());
    create table public.work_item_updates(org_id uuid,item_id uuid,body text,actor uuid);
    create table public.work_command_outbox(org_id uuid,request_id uuid,board_id uuid,item_id uuid,event_type text,payload jsonb,actor uuid);
    create table public.board_views(org_id uuid,board_id uuid,user_id uuid,name text,kind text,filters_jsonb jsonb,shared boolean);
    create table public.audit_logs(org_id uuid,actor uuid,action text,target_type text,target_id uuid,meta jsonb);
    create table public.contact_pipeline_transitions(org_id uuid,request_id uuid,kind text,deal_id uuid,source_item_id uuid,status text,primary key(org_id,request_id));
    create table public.deals(id uuid primary key,org_id uuid,company_id uuid);
    create function public.automation_condition_matches(jsonb,jsonb) returns boolean language sql immutable as $$select true$$;
    create function public.execute_trusted_board_automation(text) returns table(status text,error_code text,visited_rule_ids jsonb) language sql as $$select 'stub',null::text,'[]'::jsonb$$;
    create function public.execute_work_management_command(uuid,uuid,uuid,text,integer,uuid,jsonb) returns jsonb language sql as $$select '{}'::jsonb$$;
    create function public.bbe151_ensure_notice_tab(uuid) returns table(board_id uuid,created boolean) language sql as $$select null::uuid,false$$;
    create function public.advance_new_lead_to_contact(uuid,uuid) returns table(status text,deal_id uuid,company_id uuid,reason text) language sql as $$select 'stub',null::uuid,null::uuid,null::text$$;
    create function public.advance_new_lead_to_contact(p_org uuid,p_deal uuid,p_request uuid) returns table(status text,deal_id uuid,company_id uuid,reason text) language sql as $$select 'committed',p_deal,null::uuid,null::text$$;
    grant select on public.items to anon,authenticated,service_role;
    create function public.is_org_member(p_org uuid) returns boolean language sql stable as $$select exists(select 1 from public.org_members where org_id=p_org and user_id=auth.uid() and status='active')$$;
    create function public.effective_permission(p_org uuid,p_key text) returns boolean language sql stable as $$select p_key in ('work.item_upsert','structure.column_manage') and public.is_org_member(p_org)$$;
    create function public.board_column_value_editable(p_org uuid,p_item uuid,p_key text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from public.items i join public.board_columns c on c.org_id=i.org_id and c.board_id=i.board_id and c.key=p_key and c.archived_at is null join public.org_members m on m.org_id=i.org_id and m.user_id=auth.uid() and m.status='active' where i.org_id=p_org and i.id=p_item and not c.is_readonly and (m.role in ('owner','admin') or m.scope='all' or i.assigned_to=auth.uid()))$$;
    create function public.board_column_value_is_valid(uuid,uuid,text,jsonb) returns boolean language sql stable security definer set search_path=public,pg_temp as $$select true$$;
    revoke all on function public.board_column_value_is_valid(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
    create function public.begin_guarded_migration(p_logical_key text,p_file_name text,p_file_digest text,p_expected_predecessor text,p_executor text,p_thread_id text,p_foundation boolean) returns void language sql as $$select$$;
    insert into public.orgs(id) values('${ids.org}'),('${ids.other}');
    insert into public.users(id) values('${ids.actor}'),('${ids.outsider}');
    insert into public.org_members values('${ids.org}','${ids.actor}','active','member','assigned');
    insert into public.boards(id,org_id,source) values('${ids.board}','${ids.org}','core.default-tab/test'),('${ids.otherBoard}','${ids.other}','user');
    insert into public.board_groups values('${ids.g1}','${ids.org}','${ids.board}'),('${ids.g2}','${ids.org}','${ids.board}');
    insert into public.board_columns(id,org_id,board_id,key,sort_order) values('${ids.col1}','${ids.org}','${ids.board}','status',0),('${ids.col2}','${ids.org}','${ids.board}','priority',1);
    insert into public.items(id,org_id,board_id,group_id,title,assigned_to,sort_order) values
      ('${ids.a}','${ids.org}','${ids.board}','${ids.g1}','A','${ids.actor}',0),
      ('${ids.b}','${ids.org}','${ids.board}','${ids.g1}','B','${ids.actor}',1),
      ('${ids.c}','${ids.org}','${ids.board}','${ids.g2}','C','${ids.actor}',0);
    set app.actor='${ids.actor}';
  `);
  const sql=readFileSync(resolve(process.cwd(),"../supabase/migrations/139_issue602_atomic_board_row_move.sql"),"utf8");
  await db.exec(sql);
});
afterAll(async()=>db.close());
beforeEach(async()=>{
  await db.exec(`
    drop trigger if exists fail_c on public.items; drop function if exists public.fail_c_update();
    truncate public.board_row_move_requests;
    truncate public.item_values,public.work_command_receipts,public.work_item_versions,public.work_item_updates,public.work_command_outbox,public.audit_logs,public.contact_pipeline_transitions;
    delete from public.items;
    delete from public.board_groups where id not in ('${ids.g1}','${ids.g2}');
    delete from public.boards where id not in ('${ids.board}','${ids.otherBoard}');
    delete from public.deals;
    delete from public.board_columns where id not in ('${ids.col1}','${ids.col2}');
    insert into public.board_groups values('${ids.g1}','${ids.org}','${ids.board}'),('${ids.g2}','${ids.org}','${ids.board}') on conflict do nothing;
    insert into public.board_columns(id,org_id,board_id,key,sort_order) values
      ('${ids.col1}','${ids.org}','${ids.board}','status',0),('${ids.col2}','${ids.org}','${ids.board}','priority',1)
      on conflict(id) do update set sort_order=excluded.sort_order,archived_at=null;
    update public.org_members set role='member',scope='all' where org_id='${ids.org}' and user_id='${ids.actor}';
    update public.boards set source='core.default-tab/test' where id='${ids.board}';
    set role moawork_row_order_writer;
    update public.boards set row_order_version=0 where id='${ids.board}';
    reset role;
    insert into public.items(id,org_id,board_id,group_id,title,assigned_to,sort_order) values
      ('${ids.a}','${ids.org}','${ids.board}','${ids.g1}','A','${ids.actor}',0),
      ('${ids.b}','${ids.org}','${ids.board}','${ids.g1}','B','${ids.actor}',1),
      ('${ids.c}','${ids.org}','${ids.board}','${ids.g2}','C','${ids.actor}',0);
  `);
});

describe("migration 139 atomic row move",()=>{
  it("moves across groups, normalizes both groups and replays exactly",async()=>{
    const first=await move({item:ids.b,group:ids.g2,before:ids.c,version:0,request:1});
    expect(first.rows[0]).toMatchObject({version:1,replayed:false,target_group_id:ids.g2,before_item_id:ids.c});
    const rows=await db.query<{id:string;group_id:string;sort_order:number}>("select id,group_id,sort_order from items order by group_id,sort_order");
    expect(rows.rows).toEqual([
      {id:ids.a,group_id:ids.g1,sort_order:0},
      {id:ids.b,group_id:ids.g2,sort_order:0},
      {id:ids.c,group_id:ids.g2,sort_order:1},
    ]);
    expect((await move({item:ids.b,group:ids.g2,before:ids.c,version:0,request:1})).rows[0].replayed).toBe(true);
    await expect(move({item:ids.b,group:ids.g1,version:1,request:1})).rejects.toThrow(/replay conflict/);
  });

  it("authenticates an exact receipt before mutable target lookup",async()=>{
    await move({item:ids.b,group:ids.g2,before:ids.c,version:0,request:11});
    await db.exec(`delete from public.items where group_id='${ids.g2}'; delete from public.board_groups where id='${ids.g2}';`);
    expect((await move({item:ids.b,group:ids.g2,before:ids.c,version:0,request:11})).rows[0]).toMatchObject({replayed:true,version:1});
  });

  it("returns an already-canonical position without write, version or receipt",async()=>{
    const result=await move({item:ids.a,group:ids.g1,before:ids.b,version:0,request:12});
    expect(result.rows[0]).toMatchObject({replayed:false,version:0});
    expect((await db.query<{row_order_version:number}>("select row_order_version from boards where id=$1",[ids.board])).rows[0].row_order_version).toBe(0);
    expect((await db.query<{count:number}>("select count(*)::int count from board_row_move_requests",[])).rows[0].count).toBe(0);
  });

  it("moves within one group and into an empty group using exact anchors",async()=>{
    await move({item:ids.b,group:ids.g1,before:ids.a,version:0,request:7});
    expect((await db.query<{id:string}>("select id from items where group_id=$1 order by sort_order",[ids.g1])).rows.map((row)=>row.id)).toEqual([ids.b,ids.a]);
    const empty="00000000-0000-4000-8000-000000000032";
    await db.query("insert into board_groups values($1,$2,$3)",[empty,ids.org,ids.board]);
    await move({item:ids.b,group:empty,version:1,request:8});
    expect((await db.query<{id:string;sort_order:number}>("select id,sort_order from items where group_id=$1",[empty])).rows).toEqual([{id:ids.b,sort_order:0}]);
  });

  it("rejects stale, self, cross-org and assigned-scope whole-group reorder",async()=>{
    await expect(move({item:ids.a,group:ids.g1,version:9,request:2})).rejects.toThrow(/stale version/);
    await expect(move({item:ids.a,group:ids.g1,before:ids.a,version:0,request:3})).rejects.toThrow(/self target/);
    await expect(db.query("select * from public.move_board_row_atomic($1,$2,$3,$4,$5,$6,$7)",[ids.other,ids.board,ids.a,ids.g1,null,0,request(4)])).rejects.toThrow();
    await db.exec(`update org_members set scope='assigned' where org_id='${ids.org}' and user_id='${ids.actor}'; update items set assigned_to='${ids.actor}' where id='${ids.a}'; update items set assigned_to='${ids.outsider}' where id='${ids.b}';`);
    await expect(move({item:ids.a,group:ids.g2,before:ids.c,version:0,request:5})).rejects.toThrow(/permission denied/);
    expect((await db.query<{id:string;group_id:string;sort_order:number}>("select id,group_id,sort_order from items order by id",[])).rows).toEqual([
      {id:ids.a,group_id:ids.g1,sort_order:0},{id:ids.b,group_id:ids.g1,sort_order:1},{id:ids.c,group_id:ids.g2,sort_order:0},
    ]);
  });

  it.each(["authenticated","anon","service_role"])("blocks %s direct board/group/order writes while preserving ordinary fields",async(role)=>{
    const privileges=await db.query<{board_update:boolean;group_update:boolean;sort_update:boolean;title_update:boolean;assigned_update:boolean}>(
      "select has_column_privilege($1,'public.items','board_id','UPDATE') board_update,has_column_privilege($1,'public.items','group_id','UPDATE') group_update,has_column_privilege($1,'public.items','sort_order','UPDATE') sort_update,has_column_privilege($1,'public.items','title','UPDATE') title_update,has_column_privilege($1,'public.items','assigned_to','UPDATE') assigned_update",
      [role],
    );
    expect(privileges.rows[0]).toEqual({board_update:false,group_update:false,sort_update:false,title_update:true,assigned_update:true});
    await db.exec(`set role ${role}`);
    try{
      await expect(db.exec(`update public.items set group_id='${ids.g2}' where id='${ids.a}'`)).rejects.toThrow();
      await expect(db.exec(`update public.items set sort_order=9 where id='${ids.a}'`)).rejects.toThrow();
      await expect(db.exec(`update public.items set board_id='${ids.otherBoard}' where id='${ids.a}'`)).rejects.toThrow();
      await db.exec(`update public.items set title='ordinary field' where id='${ids.a}'`);
      await db.exec(`update public.items set assigned_to='${ids.outsider}' where id='${ids.a}'`);
    }finally{
      await db.exec("reset role");
    }
  });

  it("rejects an unrelated postgres-owned SECURITY DEFINER position writer",async()=>{
    await db.exec(`
      create or replace function public.legacy_position_writer(p_item uuid,p_group uuid)
      returns void language sql security definer set search_path='' as
      $$update public.items set group_id=p_group where id=p_item$$;
      grant execute on function public.legacy_position_writer(uuid,uuid) to authenticated;
      set role authenticated;
    `);
    try{
      await expect(db.query("select public.legacy_position_writer($1,$2)",[ids.a,ids.g2])).rejects.toThrow(/RPC-only/);
    }finally{
      await db.exec("reset role; drop function public.legacy_position_writer(uuid,uuid)");
    }
    expect((await db.query<{group_id:string}>("select group_id from items where id=$1",[ids.a])).rows[0].group_id).toBe(ids.g1);
  });

  it("allows a validated trusted wrapper only through the private ordering helper",async()=>{
    await db.exec(`
      create or replace function public.test_trusted_reconcile(p_item uuid,p_source uuid,p_target uuid)
      returns bigint language plpgsql security definer set search_path='' as $$
      begin
        if auth.uid() is null then raise exception 'trusted actor required' using errcode='42501'; end if;
        return public.issue602_move_board_item_private('${ids.org}',p_item,'${ids.board}',p_source,'${ids.board}',p_target,null);
      end$$;
      grant execute on function public.test_trusted_reconcile(uuid,uuid,uuid) to authenticated;
      set role authenticated;
    `);
    try{
      expect((await db.query<{test_trusted_reconcile:number}>("select public.test_trusted_reconcile($1,$2,$3)",[ids.b,ids.g1,ids.g2])).rows[0].test_trusted_reconcile).toBe(1);
    }finally{
      await db.exec("reset role; drop function public.test_trusted_reconcile(uuid,uuid,uuid)");
    }
    expect((await db.query<{id:string}>("select id from items where group_id=$1 order by sort_order,id",[ids.g2])).rows.map((row)=>row.id)).toEqual([ids.c,ids.b]);
  });

  it("reconciles definition boards through a dedicated idempotent contract",async()=>{
    await db.exec("set role authenticated");
    try{
      expect((await db.query<{reconcile_board_definition_item_group:number}>("select public.reconcile_board_definition_item_group($1,$2,$3,$4,$5)",[ids.org,ids.board,ids.b,ids.g1,ids.g2])).rows[0].reconcile_board_definition_item_group).toBe(1);
      expect((await db.query<{reconcile_board_definition_item_group:number}>("select public.reconcile_board_definition_item_group($1,$2,$3,$4,$5)",[ids.org,ids.board,ids.b,ids.g2,ids.g2])).rows[0].reconcile_board_definition_item_group).toBe(1);
    }finally{await db.exec("reset role");}
    expect((await db.query<{count:number}>("select count(*)::int count from board_row_move_requests",[])).rows[0].count).toBe(0);
  });

  it("keeps the private writer NOLOGIN/ungranted and permits authenticated only through the exact RPC",async()=>{
    const role=await db.query<{rolcanlogin:boolean;rolinherit:boolean;rolbypassrls:boolean;members:number}>("select r.rolcanlogin,r.rolinherit,r.rolbypassrls,(select count(*)::int from pg_auth_members m where m.roleid=r.oid) members from pg_roles r where r.rolname='moawork_row_order_writer'");
    expect(role.rows[0]).toEqual({rolcanlogin:false,rolinherit:false,rolbypassrls:true,members:0});
    await db.exec("set role authenticated");
    try{expect((await move({item:ids.a,group:ids.g2,version:0,request:15})).rows[0]).toMatchObject({version:1});}
    finally{await db.exec("reset role");}
  });

  it("makes bootstrap-style append reconciliation idempotent",async()=>{
    expect((await move({item:ids.b,group:ids.g2,version:0,request:16})).rows[0].version).toBe(1);
    expect((await move({item:ids.b,group:ids.g2,version:1,request:17})).rows[0]).toMatchObject({version:1,replayed:false});
    expect((await db.query<{count:number}>("select count(*)::int count from board_row_move_requests",[])).rows[0].count).toBe(1);
  });

  it("reorders physical kanban columns atomically through the canonical command",async()=>{
    await db.exec("set role authenticated");
    try{const result=await db.query<{id:string;sort_order:number}>("select id,sort_order from public.reorder_board_columns_atomic($1,$2,$3) order by sort_order",[ids.org,ids.board,[ids.col2,ids.col1]]);expect(result.rows).toEqual([{id:ids.col2,sort_order:0},{id:ids.col1,sort_order:1}]);}
    finally{await db.exec("reset role");}
  });

  it("commits values and move together and rolls both back on a row failure",async()=>{
    const success=await setValuesMove({item:ids.a,group:ids.g2,values:{status:"done"},version:0,request:13});
    expect(success.rows[0]).toMatchObject({version:1,replayed:false});
    await db.query("delete from board_columns where id=$1",[ids.col1]);
    expect((await setValuesMove({item:ids.a,group:ids.g2,values:{status:"done"},version:0,request:13})).rows[0]).toMatchObject({version:1,replayed:true});
    await expect(setValuesMove({item:ids.a,group:ids.g2,values:{status:"different"},version:0,request:13})).rejects.toThrow(/replay conflict/);
    expect((await db.query<{value_jsonb:string}>("select value_jsonb #>> '{}' value_jsonb from item_values where item_id=$1 and column_key='status'",[ids.a])).rows[0].value_jsonb).toBe("done");
    await db.query("insert into board_columns(id,org_id,board_id,key,sort_order) values($1,$2,$3,'status',0)",[ids.col1,ids.org,ids.board]);
    await db.exec(`delete from item_values; set role moawork_row_order_writer; update items set group_id='${ids.g1}',sort_order=case id when '${ids.a}' then 0 else sort_order end; update boards set row_order_version=0 where id='${ids.board}'; reset role; truncate board_row_move_requests; create or replace function public.fail_value_move() returns trigger language plpgsql as $$begin if new.id='${ids.c}' then raise exception 'atomic value failure'; end if; return new; end$$; create trigger fail_c before update on items for each row execute function public.fail_value_move();`);
    await expect(setValuesMove({item:ids.a,group:ids.g2,values:{status:"failed"},version:0,request:14})).rejects.toThrow(/atomic value failure/);
    expect((await db.query<{count:number}>("select count(*)::int count from item_values",[])).rows[0].count).toBe(0);
    expect((await db.query<{group_id:string}>("select group_id from items where id=$1",[ids.a])).rows[0].group_id).toBe(ids.g1);
  });

  it("validates every authenticated value before value, order, version or receipt writes",async()=>{
    const calc="00000000-0000-4000-8000-000000000052";
    const readonly="00000000-0000-4000-8000-000000000053";
    const amount="00000000-0000-4000-8000-000000000054";
    await db.query(
      "insert into board_columns(id,org_id,board_id,key,label,type,source,sort_order,is_readonly) values($1,$2,$3,'calculated','Calc','calc','calc',2,true),($4,$2,$3,'locked','Locked','text','in',3,true),($5,$2,$3,'amount','Amount','number','in',4,false)",
      [calc,ids.org,ids.board,readonly,amount],
    );
    const assertPristine=async()=>{
      await db.exec("reset role");
      expect((await db.query<{count:number}>("select count(*)::int count from item_values",[])).rows[0].count).toBe(0);
      expect((await db.query<{group_id:string;sort_order:number}>("select group_id,sort_order from items where id=$1",[ids.a])).rows[0]).toEqual({group_id:ids.g1,sort_order:0});
      expect((await db.query<{row_order_version:number}>("select row_order_version from boards where id=$1",[ids.board])).rows[0].row_order_version).toBe(0);
      expect((await db.query<{count:number}>("select count(*)::int count from board_row_move_requests",[])).rows[0].count).toBe(0);
      await db.exec("set role authenticated");
    };
    await db.exec("set role authenticated");
    try{
      await expect(setValuesMove({item:ids.a,group:ids.g2,values:{calculated:1},version:0,request:20})).rejects.toThrow(/not editable or valid/);
      await assertPristine();
      await expect(setValuesMove({item:ids.a,group:ids.g2,values:{locked:"changed"},version:0,request:21})).rejects.toThrow(/not editable or valid/);
      await assertPristine();
      await expect(setValuesMove({item:ids.a,group:ids.g2,values:{amount:"not-a-number"},version:0,request:22})).rejects.toThrow(/not editable or valid/);
      await assertPristine();
      await expect(db.query("select * from public.set_board_item_values_with_atomic_move($1,$2,$3,$4,$5,$6,$7,$8)",[ids.other,ids.board,ids.a,JSON.stringify({amount:12}),ids.g2,null,0,request(23)])).rejects.toThrow(/not editable or valid/);
      await assertPristine();
      expect((await setValuesMove({item:ids.a,group:ids.g2,values:{amount:12},version:0,request:24})).rows[0]).toMatchObject({version:1,replayed:false});
    }finally{await db.exec("reset role");}
    expect((await db.query<{value_jsonb:number}>("select value_jsonb #>> '{}' value_jsonb from item_values where item_id=$1 and column_key='amount'",[ids.a])).rows[0].value_jsonb).toBe("12");
    expect((await db.query<{group_id:string}>("select group_id from items where id=$1",[ids.a])).rows[0].group_id).toBe(ids.g2);
  });

  it("keeps canonical value validation private to the NOLOGIN writer",async()=>{
    const privilege=await db.query<{anon:boolean;authenticated:boolean;service:boolean;writer:boolean}>(
      "select has_function_privilege('anon','public.board_column_value_is_valid(uuid,uuid,text,jsonb)','EXECUTE') anon,has_function_privilege('authenticated','public.board_column_value_is_valid(uuid,uuid,text,jsonb)','EXECUTE') authenticated,has_function_privilege('service_role','public.board_column_value_is_valid(uuid,uuid,text,jsonb)','EXECUTE') service,has_function_privilege('moawork_row_order_writer','public.board_column_value_is_valid(uuid,uuid,text,jsonb)','EXECUTE') writer",
    );
    expect(privilege.rows[0]).toEqual({anon:false,authenticated:false,service:false,writer:true});
  });

  it("accepts only the exact persisted bytes produced by the app field registry",async()=>{
    await db.exec(`
      insert into board_columns(id,org_id,board_id,key,label,type,source,sort_order,options_jsonb) values
        ('00000000-0000-4000-8000-000000000055','${ids.org}','${ids.board}','phone','Phone','phone','in',5,null),
        ('00000000-0000-4000-8000-000000000056','${ids.org}','${ids.board}','email','Email','email','in',6,null),
        ('00000000-0000-4000-8000-000000000057','${ids.org}','${ids.board}','moment','Moment','datetime','in',7,null),
        ('00000000-0000-4000-8000-000000000058','${ids.org}','${ids.board}','day','Day','date','in',8,null),
        ('00000000-0000-4000-8000-000000000059','${ids.org}','${ids.board}','tags','Tags','multiselect','in',9,'{"options":[{"id":"a","label":"A"},{"id":"b","label":"B"},{"id":"old","label":"Old","archived":true}]}'),
        ('00000000-0000-4000-8000-000000000060','${ids.org}','${ids.board}','people','People','people','in',10,null),
        ('00000000-0000-4000-8000-000000000061','${ids.org}','${ids.board}','person','Person','person','in',11,null),
        ('00000000-0000-4000-8000-000000000062','${ids.org}','${ids.board}','files','Files','file','in',12,null),
        ('00000000-0000-4000-8000-000000000063','${ids.org}','${ids.board}','choice','Choice','select','in',13,'{"options":[{"id":"a","label":"A"},{"id":"old","label":"Old","archived":true}]}'),
        ('00000000-0000-4000-8000-000000000064','${ids.org}','${ids.board}','checked','Checked','checkbox','in',14,null),
        ('00000000-0000-4000-8000-000000000065','${ids.org}','${ids.board}','note','Note','text','in',15,null),
        ('00000000-0000-4000-8000-000000000066','${ids.org}','${ids.board}','integer','Integer','number','in',16,null),
        ('00000000-0000-4000-8000-000000000067','${ids.org}','${ids.board}','decimal','Decimal','number','in',17,null),
        ('00000000-0000-4000-8000-000000000068','${ids.org}','${ids.board}','zero','Zero','number','in',18,null),
        ('00000000-0000-4000-8000-000000000069','${ids.org}','${ids.board}','money_negative','Money negative','money','in',19,null),
        ('00000000-0000-4000-8000-000000000070','${ids.org}','${ids.board}','money_decimal','Money decimal','money','in',20,null),
        ('00000000-0000-4000-8000-000000000071','${ids.org}','${ids.board}','money_zero','Money zero','money','in',21,null),
        ('00000000-0000-4000-8000-000000000072','${ids.org}','${ids.board}','negative_zero','Negative zero','number','in',22,null);
    `);
    const canonical=(type:Parameters<typeof validateCell>[0],raw:unknown,options?:Array<{id:string;label:string;archived?:boolean}>)=>{
      const result=validateCell(type,raw,options);
      expect(result.ok).toBe(true);
      return result.value;
    };
    const values=JSON.parse(JSON.stringify({
      phone:canonical("phone","010-1234-5678"),
      email:canonical("email","USER@EXAMPLE.COM"),
      moment:canonical("datetime","2026-08-28 12:34:56+09:00"),
      day:canonical("date","2026-08-28T10:00:00Z"),
      tags:canonical("multiselect",["a","b","a"],[{id:"a",label:"A"},{id:"b",label:"B"}]),
      people:canonical("people",[ids.actor,"",ids.outsider,ids.actor]),
      person:canonical("person",["",ids.actor]),
      files:canonical("file",[{path:"docs/a.pdf"}]),
      choice:canonical("select","a",[{id:"a",label:"A"}]),
      checked:canonical("checkbox","true"),
      note:canonical("text","  hello  "),
      integer:canonical("number","1,200"),
      decimal:canonical("number","1,234.5"),
      zero:canonical("number",0),
      money_negative:canonical("money","-2,000"),
      money_decimal:canonical("money","-12.5"),
      money_zero:canonical("money",0),
      negative_zero:canonical("number",-0),
    })) as Record<string,unknown>;
    expect(values).toEqual({
      phone:"01012345678",email:"user@example.com",moment:"2026-08-28T03:34:56.000Z",day:"2026-08-28",
      tags:["a","b"],people:[ids.actor,ids.outsider],person:[ids.actor],
      files:[{path:"docs/a.pdf",name:"docs/a.pdf",size:0,mime:"application/octet-stream"}],
      choice:"a",checked:true,note:"hello",integer:1200,decimal:1234.5,zero:0,
      money_negative:-2000,money_decimal:-12.5,money_zero:0,negative_zero:0,
    });
    const noncanonical:Record<string,unknown>[]=[
      {phone:"010-1234-5678"},{email:"USER@EXAMPLE.COM"},{moment:"2026-08-28 12:34:56+09:00"},
      {day:"2026-08-28T10:00:00Z"},{tags:["a","a"]},{tags:[]},{people:[ids.actor,ids.actor]},
      {people:[]},{person:["",ids.actor]},{files:[{path:"docs/a.pdf"}]},{files:[]},{choice:"old"},
      {checked:"true"},{note:"  hello  "},
    ];
    const assertPristine=async()=>{
      await db.exec("reset role");
      expect((await db.query<{count:number}>("select count(*)::int count from item_values",[])).rows[0].count).toBe(0);
      expect((await db.query<{group_id:string;sort_order:number}>("select group_id,sort_order from items where id=$1",[ids.a])).rows[0]).toEqual({group_id:ids.g1,sort_order:0});
      expect((await db.query<{row_order_version:number}>("select row_order_version from boards where id=$1",[ids.board])).rows[0].row_order_version).toBe(0);
      expect((await db.query<{count:number}>("select count(*)::int count from board_row_move_requests",[])).rows[0].count).toBe(0);
      await db.exec("set role authenticated");
    };
    await db.exec("set role authenticated");
    try{
      for(let index=0;index<noncanonical.length;index+=1){
        await expect(setValuesMove({item:ids.a,group:ids.g2,values:noncanonical[index],version:0,request:50+index})).rejects.toThrow(/not editable or valid/);
        await assertPristine();
      }
      const rawMove=(rawValues:string,n:number)=>db.query(
        "select * from public.set_board_item_values_with_atomic_move($1,$2,$3,$4::jsonb,$5,$6,$7,$8)",
        [ids.org,ids.board,ids.a,rawValues,ids.g2,null,0,request(n)],
      );
      await expect(rawMove('{"integer":1e1000}',68)).rejects.toThrow(/not editable or valid/);
      await assertPristine();
      await expect(rawMove('{"integer":9007199254740993}',69)).rejects.toThrow(/not editable or valid/);
      await assertPristine();
      await expect(rawMove('{"money_negative":1e1000}',71)).rejects.toThrow(/not editable or valid/);
      await assertPristine();
      await expect(rawMove('{"money_negative":9007199254740993}',72)).rejects.toThrow(/not editable or valid/);
      await assertPristine();
      expect((await setValuesMove({item:ids.a,group:ids.g2,values,version:0,request:75})).rows[0]).toMatchObject({version:1,replayed:false});
    }finally{await db.exec("reset role");}
    expect((await db.query<{values:Record<string,unknown>}>("select jsonb_object_agg(column_key,value_jsonb) values from item_values",[])).rows[0].values).toEqual(values);
  });

  it("preserves assigned-own work moves and exact first, middle, end positions",async()=>{
    await db.exec(`update boards set source='core.default-tab/contract-work' where id='${ids.board}'; update org_members set scope='assigned' where org_id='${ids.org}' and user_id='${ids.actor}';`);
    const command=async(item:string,expected:number,n:number,group:string,position:number)=>db.query<{execute_work_management_command:{accepted:boolean;replayed:boolean;version:number}}>(
      "select public.execute_work_management_command($1,$2,$3,'move_item',$4,$5,$6::jsonb)",
      [ids.org,ids.board,item,expected,request(n),JSON.stringify({group_id:group,position})],
    );
    await db.exec("set role authenticated");
    try{
      expect((await command(ids.b,0,30,ids.g2,0)).rows[0].execute_work_management_command).toMatchObject({accepted:true,replayed:false,version:1});
      expect((await db.query<{id:string}>("select id from items where group_id=$1 order by sort_order,id",[ids.g2])).rows.map(row=>row.id)).toEqual([ids.b,ids.c]);
      expect((await command(ids.b,1,31,ids.g2,1)).rows[0].execute_work_management_command.version).toBe(2);
      expect((await db.query<{id:string}>("select id from items where group_id=$1 order by sort_order,id",[ids.g2])).rows.map(row=>row.id)).toEqual([ids.c,ids.b]);
      expect((await command(ids.a,0,32,ids.g2,99)).rows[0].execute_work_management_command.version).toBe(1);
      expect((await db.query<{id:string}>("select id from items where group_id=$1 order by sort_order,id",[ids.g2])).rows.map(row=>row.id)).toEqual([ids.c,ids.b,ids.a]);
      expect((await command(ids.a,0,32,ids.g2,99)).rows[0].execute_work_management_command.replayed).toBe(true);
      await expect(command(ids.a,0,33,ids.g1,0)).rejects.toThrow(/stale work item version/);
      await db.exec(`reset role; update items set assigned_to='${ids.outsider}' where id='${ids.c}'; set role authenticated;`);
      await expect(command(ids.c,0,34,ids.g1,0)).rejects.toThrow(/work item permission denied/);
    }finally{await db.exec("reset role");}
  });

  it("preserves assigned-own new-lead advance while denying another assignee",async()=>{
    const nl="00000000-0000-4000-8000-000000000060";
    const contact="00000000-0000-4000-8000-000000000061";
    const ng="00000000-0000-4000-8000-000000000062";
    const cg="00000000-0000-4000-8000-000000000063";
    const own="00000000-0000-4000-8000-000000000064";
    const foreign="00000000-0000-4000-8000-000000000065";
    const ownDeal="00000000-0000-4000-8000-000000000066";
    const foreignDeal="00000000-0000-4000-8000-000000000067";
    await db.exec(`
      insert into boards(id,org_id,source) values('${nl}','${ids.org}','core.default-tab/new-lead'),('${contact}','${ids.org}','core.default-tab/contact');
      insert into board_groups(id,org_id,board_id,sort_order) values('${ng}','${ids.org}','${nl}',0),('${cg}','${ids.org}','${contact}',0);
      insert into deals(id,org_id) values('${ownDeal}','${ids.org}'),('${foreignDeal}','${ids.org}');
      insert into items(id,org_id,board_id,group_id,title,assigned_to,deal_id,sort_order) values
        ('${own}','${ids.org}','${nl}','${ng}','own','${ids.actor}','${ownDeal}',0),
        ('${foreign}','${ids.org}','${nl}','${ng}','foreign','${ids.outsider}','${foreignDeal}',1);
      update org_members set scope='assigned' where org_id='${ids.org}' and user_id='${ids.actor}';
      set role authenticated;
    `);
    try{
      expect((await db.query<{status:string}>("select status from public.advance_new_lead_to_contact($1,$2)",[own,request(40)])).rows[0].status).toBe("committed");
      expect((await db.query<{board_id:string;group_id:string}>("select board_id,group_id from items where id=$1",[own])).rows[0]).toEqual({board_id:contact,group_id:cg});
      await expect(db.query("select * from public.advance_new_lead_to_contact($1,$2)",[foreign,request(41)])).rejects.toThrow(/new lead advance denied/);
    }finally{await db.exec("reset role");}
    expect((await db.query<{board_id:string}>("select board_id from items where id=$1",[foreign])).rows[0].board_id).toBe(nl);
  });

  it("rolls every intended update back when any row update fails",async()=>{
    const before=await db.query("select id,group_id,sort_order from items order by id");
    await db.exec(`create function public.fail_c_update() returns trigger language plpgsql as $$begin if new.id='${ids.c}' then raise exception 'injected row failure'; end if; return new; end$$; create trigger fail_c before update on items for each row execute function public.fail_c_update();`);
    await expect(move({item:ids.a,group:ids.g2,version:0,request:6})).rejects.toThrow(/injected row failure/);
    const after=await db.query("select id,group_id,sort_order from items order by id");
    expect(after.rows).toEqual(before.rows);
    expect((await db.query<{row_order_version:number}>("select row_order_version from boards where id=$1",[ids.board])).rows[0].row_order_version).toBe(0);
    expect((await db.query<{count:number}>("select count(*)::int count from board_row_move_requests where request_id=$1",[request(6)])).rows[0].count).toBe(0);
  });
});
