import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dependencyRoot = process.env.PGLITE_MODULE_ROOT ?? root;
const { PGlite } = await import(pathToFileURL(path.join(dependencyRoot, "node_modules", "@electric-sql", "pglite", "dist", "index.js")).href);
const mainMigration041 = await readFile(path.join(root, "supabase", "migrations", "041_messaging.sql"), "utf8");
const transitionMigration069 = await readFile(path.join(root, "supabase", "migrations", "069_contact_pipeline_transitions.sql"), "utf8");
const dashboardMigration086 = await readFile(path.join(root, "supabase", "migrations", "086_dashboard_daily_read_model.sql"), "utf8");
const migration = await readFile(path.join(root, "supabase", "migrations", "087_new_lead_canonical.sql"), "utf8");
const detailLayoutMigration088 = await readFile(path.join(root, "supabase", "migrations", "088_bbe175_detail_layout_drift_repair.sql"), "utf8");

const A = "10000000-0000-4000-8000-000000000001";
const B = "10000000-0000-4000-8000-000000000002";
const USER = "10000000-0000-4000-8000-000000000010";
const OTHER = "10000000-0000-4000-8000-000000000011";
const OWNER = "10000000-0000-4000-8000-000000000012";
const ADMIN = "10000000-0000-4000-8000-000000000013";
const ALL = "10000000-0000-4000-8000-000000000014";
const INACTIVE = "10000000-0000-4000-8000-000000000015";
const BOARD = "10000000-0000-4000-8000-000000000020";
const GROUP = "10000000-0000-4000-8000-000000000021";

async function setup(db) {
  await db.exec(`
    create schema auth; create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create type public.member_role as enum('owner','admin','team_lead','member');
    create type public.member_scope as enum('all','department','assigned');
    create type public.stage_kind as enum('marketing','meeting','work','done','lost');
    create type public.field_type as enum('text','number','date','status','people','money','calc');
    create type public.field_source as enum('auto','in','act','msg','lk','calc');
    create type public.message_channel as enum('sms','alimtalk');
    create type public.message_status as enum('queued','sent','failed','canceled');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.orgs(id uuid primary key,status text not null default 'active');
    create table public.users(id uuid primary key);
    create table public.org_members(org_id uuid,user_id uuid,role public.member_role,scope public.member_scope,status text,primary key(org_id,user_id));
    create function public.is_org_member(p uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.org_members m where m.org_id=p and m.user_id=auth.uid() and m.status='active')$$;
    create function public.org_role(p uuid) returns public.member_role language sql stable security definer set search_path='' as $$select role from public.org_members where org_id=p and user_id=auth.uid() and status='active'$$;
    create function public.org_scope(p uuid) returns public.member_scope language sql stable security definer set search_path='' as $$select scope from public.org_members where org_id=p and user_id=auth.uid() and status='active'$$;
    create function public.effective_permission(p uuid,k text) returns boolean language sql stable security definer set search_path='' as $$select public.is_org_member(p) and k='work.item_upsert' and coalesce(nullif(current_setting('request.test.permission',true),''),'on')='on'$$;
    create table public.pipelines(id uuid primary key default gen_random_uuid(),org_id uuid references public.orgs(id),created_at timestamptz default now());
    create table public.stages(id uuid primary key default gen_random_uuid(),pipeline_id uuid references public.pipelines(id),kind public.stage_kind,sort_order int default 0);
    create table public.deals(id uuid primary key default gen_random_uuid(),org_id uuid references public.orgs(id),company_id uuid,pipeline_id uuid references public.pipelines(id),stage_id uuid references public.stages(id),assigned_to uuid references public.users(id),title text,custom jsonb not null default '{}'::jsonb,created_at timestamptz default now(),updated_at timestamptz default now());
    create table public.boards(id uuid primary key default gen_random_uuid(),org_id uuid references public.orgs(id),source text);
    create table public.board_groups(id uuid primary key default gen_random_uuid(),org_id uuid references public.orgs(id),board_id uuid references public.boards(id),name text);
    create table public.board_columns(id uuid primary key default gen_random_uuid(),org_id uuid references public.orgs(id),board_id uuid references public.boards(id),key text,label text,type public.field_type,sort_order int default 0,width int,source public.field_source not null default 'in',is_readonly boolean default false,unique(board_id,key));
    create table public.items(id uuid primary key default gen_random_uuid(),org_id uuid references public.orgs(id),board_id uuid references public.boards(id),group_id uuid references public.board_groups(id),title text,assigned_to uuid references public.users(id),deleted_at timestamptz);
    create table public.item_values(org_id uuid references public.orgs(id),item_id uuid references public.items(id),column_key text,value_jsonb jsonb,primary key(item_id,column_key));
    create table public.activities(id uuid primary key default gen_random_uuid(),org_id uuid references public.orgs(id),deal_id uuid references public.deals(id),type text,content text,actor uuid references public.users(id),created_at timestamptz default now());
    create table public.work_item_versions(org_id uuid references public.orgs(id),item_id uuid references public.items(id),due_date date,workflow_status text);
    create table public.notifications(id uuid primary key default gen_random_uuid(),org_id uuid references public.orgs(id),user_id uuid references public.users(id),type text,title text,body text,target_type text,target_id uuid,is_action boolean,read_at timestamptz,created_at timestamptz default now(),resolved_at timestamptz);
    create table public.message_templates(
      id uuid primary key default gen_random_uuid(),org_id uuid references public.orgs(id),
      channel public.message_channel,code text,name text,body text,status text
    );
    create table public.messages(
      id uuid primary key default gen_random_uuid(),org_id uuid references public.orgs(id),
      template_id uuid references public.message_templates(id),to_addr text,
      status public.message_status,error text
    );
    insert into public.orgs(id) values('${A}'),('${B}');
    insert into public.users(id) values('${USER}'),('${OTHER}'),('${OWNER}'),('${ADMIN}'),('${ALL}'),('${INACTIVE}');
    insert into public.org_members values
      ('${A}','${USER}','member','assigned','active'),('${A}','${OTHER}','member','assigned','active'),
      ('${A}','${OWNER}','owner','all','active'),('${A}','${ADMIN}','admin','all','active'),
      ('${A}','${ALL}','member','all','active'),('${A}','${INACTIVE}','member','assigned','inactive');
    insert into public.pipelines(id,org_id) values('10000000-0000-4000-8000-000000000030','${A}');
    insert into public.stages(id,pipeline_id,kind,sort_order) values
      ('10000000-0000-4000-8000-000000000031','10000000-0000-4000-8000-000000000030','marketing',0),
      ('10000000-0000-4000-8000-000000000032','10000000-0000-4000-8000-000000000030','meeting',1);
    insert into public.boards(id,org_id,source) values('${BOARD}','${A}','core.default-tab/new-lead');
    insert into public.board_groups(id,org_id,board_id,name) values('${GROUP}','${A}','${BOARD}','incoming');
    insert into public.board_columns(org_id,board_id,key,label,type) values
      ('${A}','${BOARD}','rep_name','representative','text'),('${A}','${BOARD}','phone','phone','text'),('${A}','${BOARD}','email','email','text');
    select set_config('request.jwt.claim.sub','${USER}',false);
  `);
  await db.exec(mainMigration041);
  await db.exec(transitionMigration069);
  await db.exec(dashboardMigration086);
  await db.exec(migration);
  await db.exec(migration);
  const customerRowsBefore088 = {
    boards: (await db.query("select id,org_id,source from public.boards order by id")).rows,
    groups: (await db.query("select id,org_id,board_id,name from public.board_groups order by id")).rows,
    columns: (await db.query("select id,org_id,board_id,key,label,type::text,sort_order,width,source::text,is_readonly from public.board_columns order by id")).rows,
  };
  await db.exec(detailLayoutMigration088);
  await db.exec(detailLayoutMigration088);
  assert.deepEqual(
    {
      boards: (await db.query("select id,org_id,source from public.boards order by id")).rows,
      groups: (await db.query("select id,org_id,board_id,name from public.board_groups order by id")).rows,
      columns: (await db.query("select id,org_id,board_id,key,label,type::text,sort_order,width,source::text,is_readonly from public.board_columns order by id")).rows,
    },
    customerRowsBefore088,
  );
  await db.exec("grant usage on schema public to authenticated");
}

async function createLead(db, request, title = "Lead") {
  await db.exec("set role authenticated");
  try {
    return await db.query("select * from public.create_new_lead($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [A,BOARD,GROUP,request,title,"Representative","010-1234-5678","Lead@Example.COM","corporate","manufacturing"]);
  } finally { await db.exec("reset role"); }
}

test("BBE-173 creates one company-less deal and one linked projection, then replays exactly", async () => {
  const db = new PGlite();
  try {
    await setup(db);
    const request = "10000000-0000-4000-8000-000000000101";
    const first = await createLead(db,request);
    const replay = await createLead(db,request);
    assert.equal(first.rows[0].replayed,false); assert.equal(replay.rows[0].replayed,true);
    assert.equal(first.rows[0].deal_id,replay.rows[0].deal_id); assert.equal(first.rows[0].item_id,replay.rows[0].item_id);
    const state = await db.query("select d.company_id,d.stage_id,i.deal_id,x.industry,x.phone_normalized,x.email_normalized from public.deals d join public.items i on i.deal_id=d.id join public.deal_intake x on x.deal_id=d.id");
    assert.deepEqual(state.rows[0],{company_id:null,stage_id:"10000000-0000-4000-8000-000000000031",deal_id:first.rows[0].deal_id,industry:"manufacturing",phone_normalized:"01012345678",email_normalized:"lead@example.com"});
    assert.equal(Number((await db.query("select count(*) from public.deals")).rows[0].count),1);
    assert.deepEqual(
      (await db.query("select label,type::text,is_readonly from public.board_columns where board_id=$1 and key='industry'",[BOARD])).rows,
      [{label:"업종",type:"text",is_readonly:false}],
    );
    assert.deepEqual(
      (await db.query("select source::text from public.board_columns where board_id=$1 and key='industry'",[BOARD])).rows,
      [{source:"in"}],
    );
    assert.deepEqual(
      (await db.query("select detail_layout_jsonb from public.boards where id=$1",[BOARD])).rows,
      [{detail_layout_jsonb:[]}],
    );
    assert.deepEqual(
      (await db.query("select detail_layout_jsonb from public.board_groups where id=$1",[GROUP])).rows,
      [{detail_layout_jsonb:null}],
    );
    await assert.rejects(
      db.query("update public.item_values set value_jsonb='\"shadow\"'::jsonb where item_id=$1 and column_key='industry'",[first.rows[0].item_id]),
      /canonical new lead fields require update_new_lead_fields/,
    );
    assert.equal((await db.query("select industry from public.deal_intake where deal_id=$1",[first.rows[0].deal_id])).rows[0].industry,"manufacturing");
  } finally { await db.close(); }
});

test("BBE-173 update is field-audited, replay-safe, and automation cannot overwrite a manual correction", async () => {
  const db = new PGlite();
  try {
    await setup(db);
    const created = await createLead(db,"10000000-0000-4000-8000-000000000111");
    const deal=created.rows[0].deal_id, request="10000000-0000-4000-8000-000000000112";
    await db.exec("set role authenticated");
    const normalizedPatch={industry:"  logistics  ",phone:" 010-9999-8888 ",email:"  LEAD+EDIT@EXAMPLE.COM "};
    const first=await db.query("select * from public.update_new_lead_fields($1,$2,$3,$4::jsonb,'manual')",[A,deal,request,JSON.stringify(normalizedPatch)]);
    const replay=await db.query("select * from public.update_new_lead_fields($1,$2,$3,$4::jsonb,'manual')",[A,deal,request,JSON.stringify({industry:"logistics",phone:"010-9999-8888",email:"lead+edit@example.com"})]);
    assert.equal(first.rows[0].replayed,false); assert.equal(replay.rows[0].replayed,true);
    await assert.rejects(db.query("select * from public.update_new_lead_fields($1,$2,$3,$4::jsonb,'automation')",[A,deal,"10000000-0000-4000-8000-000000000113",JSON.stringify({industry:"retail"})]),/manual correction conflict/);
    await db.exec("reset role");
    assert.deepEqual(
      (await db.query("select field_key,new_value from public.deal_intake_field_audit where deal_id=$1 order by field_key",[deal])).rows,
      [
        {field_key:"email",new_value:"lead+edit@example.com"},
        {field_key:"industry",new_value:"logistics"},
        {field_key:"phone",new_value:"010-9999-8888"},
      ],
    );
    assert.deepEqual(
      (await db.query("select industry,phone_display,phone_normalized,email_normalized from public.deal_intake where deal_id=$1",[deal])).rows[0],
      {industry:"logistics",phone_display:"010-9999-8888",phone_normalized:"01099998888",email_normalized:"lead+edit@example.com"},
    );
    assert.deepEqual(
      (await db.query("select column_key,value_jsonb from public.item_values where item_id=$1 and column_key in ('industry','phone','email') order by column_key",[created.rows[0].item_id])).rows,
      [
        {column_key:"email",value_jsonb:"lead+edit@example.com"},
        {column_key:"industry",value_jsonb:"logistics"},
        {column_key:"phone",value_jsonb:"010-9999-8888"},
      ],
    );
  } finally { await db.close(); }
});

test("BBE-173 rejects cross-tenant targets, rolls back failed creates, and exposes only authenticated RPCs", async () => {
  const db = new PGlite();
  try {
    await setup(db);
    const before=Number((await db.query("select count(*) from public.deals")).rows[0].count);
    await assert.rejects(createLead(db,"10000000-0000-4000-8000-000000000121",""),/new lead input required/);
    assert.equal(Number((await db.query("select count(*) from public.deals")).rows[0].count),before);
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select * from public.create_new_lead($1,$2,$3,$4,$5)",[B,BOARD,GROUP,"10000000-0000-4000-8000-000000000122","Cross"]),/permission denied/);
    await db.exec("reset role");
    const signatures = [
      "public.create_new_lead(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,uuid)",
      "public.update_new_lead_fields(uuid,uuid,uuid,jsonb,text)",
      "public.advance_new_lead_to_contact(uuid,uuid,uuid)",
      "public.execute_contact_pipeline_transition(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,text,text,text,date,numeric)",
    ];
    for (const signature of signatures) {
      const p=await db.query(`select
        has_function_privilege('public',$1,'execute') public_exec,
        has_function_privilege('anon',$1,'execute') anon_exec,
        has_function_privilege('service_role',$1,'execute') service_exec,
        has_function_privilege('authenticated',$1,'execute') auth_exec`,[signature]);
      assert.deepEqual(p.rows[0],{public_exec:false,anon_exec:false,service_exec:false,auth_exec:true});
    }
    const legacyAcl=await db.query(`select
      has_function_privilege('public','public.execute_contact_pipeline_transition_legacy_069(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,text,text,text,date,numeric)','execute') public_exec,
      has_function_privilege('anon','public.execute_contact_pipeline_transition_legacy_069(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,text,text,text,date,numeric)','execute') anon_exec,
      has_function_privilege('service_role','public.execute_contact_pipeline_transition_legacy_069(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,text,text,text,date,numeric)','execute') service_exec,
      has_function_privilege('authenticated','public.execute_contact_pipeline_transition_legacy_069(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,text,text,text,date,numeric)','execute') auth_exec`);
    assert.deepEqual(legacyAcl.rows[0],{public_exec:false,anon_exec:false,service_exec:false,auth_exec:false});
    assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.deal_intake'::regclass")).rows[0].relrowsecurity,true);
  } finally { await db.close(); }
});

test("BBE-173 advance enforces active membership, permission, tenant, role, and scope before delegation", async () => {
  const db = new PGlite();
  try {
    await setup(db);
    const created=await createLead(db,"10000000-0000-4000-8000-000000000131"), deal=created.rows[0].deal_id;
    await db.exec("set role authenticated");
    const marketing="10000000-0000-4000-8000-000000000031";
    const advance=async(actor,request)=>{
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
      return db.query("select * from public.advance_new_lead_to_contact($1,$2,$3)",[A,deal,request]);
    };
    const reset=async(assigned=OTHER)=>{
      await db.exec("reset role");
      await db.query("update public.deals set stage_id=$1,assigned_to=$2 where id=$3",[marketing,assigned,deal]);
      await db.exec("set role authenticated");
    };

    await reset(USER);
    const firstRequest="10000000-0000-4000-8000-000000000132";
    assert.equal((await advance(USER,firstRequest)).rows[0].status,"committed","assigned member may advance");
    assert.equal((await advance(USER,firstRequest)).rows[0].status,"committed","same request replays the committed transition");
    await db.exec("reset role");
    assert.equal(Number((await db.query("select count(*) from public.contact_pipeline_transitions where org_id=$1 and request_id=$2",[A,firstRequest])).rows[0].count),1);
    assert.equal(Number((await db.query("select count(*) from public.activities where org_id=$1 and deal_id=$2 and actor=$3",[A,deal,USER])).rows[0].count),1);
    await db.exec("set role authenticated");
    await reset(OTHER);
    await assert.rejects(advance(USER,"10000000-0000-4000-8000-000000000133"),/new lead advance denied/);

    for (const [actor,request,label] of [
      [ALL,"10000000-0000-4000-8000-000000000134","all-scope member"],
      [OWNER,"10000000-0000-4000-8000-000000000135","owner"],
      [ADMIN,"10000000-0000-4000-8000-000000000136","admin"],
    ]) {
      await reset(OTHER);
      assert.equal((await advance(actor,request)).rows[0].status,"committed",`${label} may advance another assignee`);
    }

    await reset(INACTIVE);
    await assert.rejects(advance(INACTIVE,"10000000-0000-4000-8000-000000000137"),/new lead advance denied/);
    await assert.rejects(db.query("select * from public.execute_contact_pipeline_transition($1,$2,null,$3,'lead_to_contact')",[A,deal,"10000000-0000-4000-8000-000000000142"]),/transition unavailable/);
    await reset(OTHER);
    await db.exec("reset role");
    await db.exec(`delete from public.org_members where org_id='${A}' and user_id='${OTHER}'`);
    await db.exec("set role authenticated");
    await assert.rejects(advance(OTHER,"10000000-0000-4000-8000-000000000141"),/new lead advance denied/);
    await reset(USER);
    await db.exec("select set_config('request.test.permission','off',false)");
    await assert.rejects(advance(USER,"10000000-0000-4000-8000-000000000138"),/new lead advance denied/);
    await assert.rejects(db.query("select * from public.execute_contact_pipeline_transition($1,$2,null,$3,'lead_to_contact')",[A,deal,"10000000-0000-4000-8000-000000000143"]),/transition unavailable/);
    await db.exec("select set_config('request.test.permission','on',false)");
    await assert.rejects(db.query("select * from public.advance_new_lead_to_contact($1,$2,$3)",[B,deal,"10000000-0000-4000-8000-000000000139"]),/new lead advance denied/);
    await db.exec("reset role");
    await db.exec(`update public.orgs set status='inactive' where id='${A}'`);
    await db.exec("set role authenticated");
    await assert.rejects(advance(USER,"10000000-0000-4000-8000-000000000140"),/new lead advance denied/);
    await db.exec("reset role");
    await db.exec(`update public.orgs set status='active' where id='${A}'`);
    await assert.rejects(db.query("insert into public.items(org_id,board_id,group_id,title,deal_id) values($1,$2,$3,'drift',$4)",[B,BOARD,GROUP,deal]),/foreign key/);
  } finally { await db.close(); }
});
