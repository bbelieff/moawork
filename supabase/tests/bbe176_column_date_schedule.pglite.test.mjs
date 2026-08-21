import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root=path.resolve(import.meta.dirname,"..","..");
const dependencyRoot=process.env.PGLITE_MODULE_ROOT??root;
const {PGlite}=await import(pathToFileURL(path.join(dependencyRoot,"node_modules","@electric-sql","pglite","dist","index.js")).href);
const migrationSource=await readFile(path.join(root,"supabase","migrations","115_bbe176_column_date_schedule.sql"),"utf8");
const migration=migrationSource.replace(/^-- moa-migration-guard:.*\r?\n\r?\nselect public\.begin_guarded_migration\([\s\S]*?\r?\n\);\r?\n/u,"");
const successorSource=await readFile(path.join(root,"supabase","migrations","118_bbe178_column_value_and_schedule_dispatch.sql"),"utf8");
const successor=successorSource.replace(/^-- moa-migration-guard:.*\r?\n\r?\nselect public\.begin_guarded_migration\([\s\S]*?\r?\n\);\r?\n/u,"");
const id=(n)=>`10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;

async function database(){
  const db=new PGlite();
  await db.exec(`
    create schema auth; create role anon nologin; create role authenticated nologin; create role service_role nologin; create role moawork_outbox_worker nologin;
    create function public.digest(p bytea,a text) returns bytea language sql immutable strict as $$select decode(md5(encode(p,'hex')||a)||md5(a||encode(p,'hex')),'hex')$$;
    create function public.digest(p text,a text) returns bytea language sql immutable strict as $$select public.digest(convert_to(p,'utf8'),a)$$;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create type member_role as enum('owner','admin','team_lead','member'); create type field_type as enum('text','date','datetime');
    create table orgs(id uuid primary key,status text not null); create table users(id uuid primary key);
    create table org_members(org_id uuid,user_id uuid,role member_role,scope text default 'all',status text,primary key(org_id,user_id));
    create function public.is_org_member(p uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from org_members where org_id=p and user_id=auth.uid() and status='active')$$;
    create function public.org_role(p uuid) returns member_role language sql stable security definer set search_path=public,pg_temp as $$select role from org_members where org_id=p and user_id=auth.uid() and status='active'$$;
    create table boards(id uuid primary key,org_id uuid references orgs(id));
    create table board_columns(id uuid primary key default gen_random_uuid(),org_id uuid references orgs(id),board_id uuid references boards(id),key text,label text,type field_type,archived_at timestamptz,is_required boolean not null default false,validation_jsonb jsonb not null default '{}',unique(board_id,key));
    create table board_groups(id uuid primary key,org_id uuid references orgs(id),board_id uuid references boards(id));
    create table items(id uuid primary key default gen_random_uuid(),org_id uuid references orgs(id),board_id uuid references boards(id),group_id uuid,title text,assigned_to uuid,sort_order integer default 0);
    create table item_values(org_id uuid,item_id uuid,column_key text,value_jsonb jsonb,primary key(item_id,column_key));
    create table board_column_command_receipts(org_id uuid,request_id uuid primary key,actor_id uuid,board_id uuid,operation text,payload_hash text,result_jsonb jsonb,created_at timestamptz default now());
    create table board_column_audit(id uuid primary key default gen_random_uuid(),org_id uuid,board_id uuid,column_id uuid,actor_id uuid,operation text,before_jsonb jsonb,after_jsonb jsonb,request_id uuid,changed_at timestamptz default now(),unique(org_id,request_id));
    insert into orgs values('${id(1)}','active'),('${id(2)}','active'); insert into users values('${id(10)}'),('${id(11)}'),('${id(12)}'),('${id(13)}');
    insert into org_members(org_id,user_id,role,status) values('${id(1)}','${id(10)}','owner','active'),('${id(1)}','${id(11)}','admin','active'),('${id(1)}','${id(12)}','member','active'),('${id(2)}','${id(13)}','owner','active');
    insert into boards values('${id(20)}','${id(1)}'),('${id(21)}','${id(2)}');
    insert into board_columns(id,org_id,board_id,key,label,type,archived_at) values('${id(30)}','${id(1)}','${id(20)}','due','Due','date',null),('${id(31)}','${id(1)}','${id(20)}','text','Text','text',null),('${id(32)}','${id(2)}','${id(21)}','due','Due','date',null);
    insert into items values('${id(40)}','${id(1)}','${id(20)}'),('${id(41)}','${id(2)}','${id(21)}');
    insert into item_values values('${id(1)}','${id(40)}','due','\"2026-08-30\"');
    create table notifications(id uuid primary key default gen_random_uuid(),org_id uuid,user_id uuid,type text,title text,body text,target_type text,target_id uuid,actor_id uuid,is_action boolean,read_at timestamptz,resolved_at timestamptz,created_at timestamptz default now(),dedupe_key text);
    create unique index notifications_recipient_dedupe_idx on notifications(org_id,user_id,dedupe_key) where dedupe_key is not null;
    create function public.effective_permission(uuid,text) returns boolean language sql stable as $$select true$$;
    create function public.execute_board_column_command(p_org_id uuid,p_board_id uuid,p_column_id uuid,p_operation text,p_request_id uuid,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
    declare v_role text; v_hash text:=encode(digest(p_operation||':'||coalesce(p_column_id::text,'')||':'||coalesce(p_payload,'{}')::text,'sha256'),'hex'); v_prior board_column_command_receipts; v_new uuid; v_key text; v_result jsonb; v_before jsonb;
    begin
      select role::text into v_role from org_members where org_id=p_org_id and user_id=auth.uid() and status='active'; if v_role not in ('owner','admin') then raise exception 'permission denied' using errcode='42501'; end if;
      select * into v_prior from board_column_command_receipts where request_id=p_request_id; if found then if v_prior.payload_hash<>v_hash then raise exception 'payload mismatch' using errcode='22023'; end if; return v_prior.result_jsonb||jsonb_build_object('replayed',true); end if;
      select to_jsonb(c) into strict v_before from board_columns c where id=p_column_id and org_id=p_org_id and board_id=p_board_id;
      if p_operation='settings' then
        select jsonb_build_object('accepted',true,'replayed',false,'columnId',p_column_id,'column',to_jsonb(c)) into v_result from board_columns c where id=p_column_id;
        insert into board_column_command_receipts values(p_org_id,p_request_id,auth.uid(),p_board_id,p_operation,v_hash,v_result,now());
        insert into board_column_audit(org_id,board_id,column_id,actor_id,operation,before_jsonb,after_jsonb,request_id) values(p_org_id,p_board_id,p_column_id,auth.uid(),p_operation,v_before,v_result->'column',p_request_id);
        return v_result;
      end if;
      if p_operation<>'duplicate' then raise exception 'fixture supports duplicate/settings only'; end if;
      select key into strict v_key from board_columns where id=p_column_id and org_id=p_org_id and board_id=p_board_id;
      insert into board_columns(org_id,board_id,key,label,type) select org_id,board_id,p_payload->>'key',label,type from board_columns where id=p_column_id returning id into v_new;
      insert into item_values select org_id,item_id,p_payload->>'key',value_jsonb from item_values where org_id=p_org_id and column_key=v_key;
      select jsonb_build_object('accepted',true,'replayed',false,'columnId',v_new,'column',to_jsonb(c)) into v_result from board_columns c where id=v_new;
      insert into board_column_command_receipts values(p_org_id,p_request_id,auth.uid(),p_board_id,p_operation,v_hash,v_result,now());
      insert into board_column_audit(org_id,board_id,column_id,actor_id,operation,before_jsonb,after_jsonb,request_id) values(p_org_id,p_board_id,v_new,auth.uid(),p_operation,v_before,v_result->'column',p_request_id);
      return v_result;
    end $$;
    grant usage on schema public,auth to authenticated; grant select on orgs,org_members,boards,board_columns,items to authenticated;
  `);
  await db.exec(migration); await db.exec(successor); return db;
}
async function auth(db,user){await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false)`)}
async function reset(db){await db.exec("reset role; select set_config('request.jwt.claim.sub','',false)")}

test("owner/admin set and cancel replay-safely while preserving existing column metadata",async()=>{
  const db=await database(); const before=(await db.query("select id,type::text,archived_at from board_columns order by id")).rows;
  await auth(db,id(10));
  const when=new Date(Date.now()+3600000).toISOString();
  const first=(await db.query("select set_board_column_date_schedule($1,$2,$3,$4,$5,'reminder',$6,$7,$8) result",[id(1),id(20),id(30),id(40),id(12),when,id(100),{message:"due"}])).rows[0].result;
  const replay=(await db.query("select set_board_column_date_schedule($1,$2,$3,$4,$5,'reminder',$6,$7,$8) result",[id(1),id(20),id(30),id(40),id(12),when,id(100),{message:"due"}])).rows[0].result;
  assert.equal(first.replayed,false); assert.equal(replay.replayed,true);
  assert.equal((await db.query("select count(*)::int n from board_column_date_schedules")).rows[0].n,1);
  const later=new Date(Date.now()+7200000).toISOString();
  await db.query("select set_board_column_date_schedule($1,$2,$3,$4,$5,'reminder',$6,$7,$8)",[id(1),id(20),id(30),id(40),id(12),later,id(102),{message:"second"}]);
  assert.equal((await db.query("select count(*)::int n from board_column_date_schedules where kind='reminder'")).rows[0].n,2);
  assert.equal((await db.query("select before_jsonb from board_column_date_schedule_audit where request_id=$1",[id(102)])).rows[0].before_jsonb,null);
  await db.query("select set_board_column_date_schedule($1,$2,$3,$4,$5,'deadline',$6,$7,$8)",[id(1),id(20),id(30),id(40),id(12),when,id(103),{message:"old deadline"}]);
  await db.query("select set_board_column_date_schedule($1,$2,$3,$4,$5,'deadline',$6,$7,$8)",[id(1),id(20),id(30),id(40),id(12),later,id(104),{message:"new deadline"}]);
  const deadline=(await db.query("select count(*)::int n,max(scheduled_for)::text scheduled_for from board_column_date_schedules where kind='deadline'")).rows[0];
  assert.equal(deadline.n,1); assert.equal(new Date(deadline.scheduled_for).toISOString(),later);
  assert.equal(new Date((await db.query("select before_jsonb->>'scheduled_for' scheduled_for from board_column_date_schedule_audit where request_id=$1",[id(104)])).rows[0].scheduled_for).toISOString(),when);
  await reset(db); await auth(db,id(11));
  const cancelled=(await db.query("select cancel_board_column_date_schedule($1,$2,$3) result",[id(1),first.scheduleId,id(101)])).rows[0].result;
  assert.equal(cancelled.status,"cancelled");
  const cancelReplay=(await db.query("select cancel_board_column_date_schedule($1,$2,$3) result",[id(1),first.scheduleId,id(101)])).rows[0].result;
  assert.equal(cancelReplay.replayed,true);
  assert.equal((await db.query("select count(*)::int n from board_column_date_schedule_audit")).rows[0].n,5);
  assert.deepEqual((await db.query("select id,type::text,archived_at from board_columns order by id")).rows,before);
  await db.close();
});

test("duplicate defaults to structure-only and copies values only with explicit confirmation",async()=>{
  const db=await database(); await auth(db,id(10));
  const dateSettings={deadline:true,reminderOffsetsMinutes:[60,1440]};
  await db.query("select execute_board_column_command($1,$2,$3,'settings',$4,$5)",[id(1),id(20),id(30),id(129),{dateSettings}]);
  const structure=(await db.query("select execute_board_column_command($1,$2,$3,'duplicate',$4,$5) result",[id(1),id(20),id(30),id(130),{key:'due_copy'}])).rows[0].result;
  assert.equal(structure.copiedValues,false);
  assert.deepEqual(structure.column.date_settings_jsonb,dateSettings);
  await reset(db);
  assert.equal((await db.query("select count(*)::int n from item_values where column_key='due_copy'")).rows[0].n,0);
  await auth(db,id(10));
  const replay=(await db.query("select execute_board_column_command($1,$2,$3,'duplicate',$4,$5) result",[id(1),id(20),id(30),id(130),{key:'due_copy'}])).rows[0].result;
  assert.equal(replay.replayed,true);
  await assert.rejects(db.query("select execute_board_column_command($1,$2,$3,'duplicate',$4,$5,true)",[id(1),id(20),id(30),id(130),{key:'due_copy'}]),e=>e?.code==='22023');
  await reset(db); await db.exec(`insert into item_values values('${id(1)}','${id(40)}','due_copy','\"user-entered\"')`); await auth(db,id(10));
  await db.query("select execute_board_column_command($1,$2,$3,'duplicate',$4,$5)",[id(1),id(20),id(30),id(130),{key:'due_copy'}]);
  await reset(db); assert.equal((await db.query("select count(*)::int n from item_values where column_key='due_copy'")).rows[0].n,1); assert.equal((await db.query("select count(*)::int n from board_columns where key='due_copy'")).rows[0].n,1); await auth(db,id(10));
  await assert.rejects(db.query("select execute_board_column_command($1,$2,$3,'duplicate',$4,$5,true)",[id(1),id(20),id(30),id(130),{key:'due_copy',copyValues:true}]),e=>e?.code==='22023');
  const copied=(await db.query("select execute_board_column_command($1,$2,$3,'duplicate',$4,$5,true) result",[id(1),id(20),id(30),id(131),{key:'due_copy_values'}])).rows[0].result;
  assert.equal(copied.copiedValues,true); assert.deepEqual(copied.column.date_settings_jsonb,dateSettings); await reset(db); assert.equal((await db.query("select count(*)::int n from item_values where column_key='due_copy_values'")).rows[0].n,1); await auth(db,id(10));
  await assert.rejects(db.query("select execute_board_column_command($1,$2,$3,'duplicate',$4,$5)",[id(1),id(20),id(30),id(131),{key:'due_copy_values'}]),e=>e?.code==='22023');
  await reset(db); await auth(db,id(12));
  await assert.rejects(db.query("select execute_board_column_command($1,$2,$3,'duplicate',$4,$5,true)",[id(1),id(20),id(30),id(132),{key:'member_copy'}]),e=>e?.code==='42501');
  await reset(db); await auth(db,id(13));
  await assert.rejects(db.query("select execute_board_column_command($1,$2,$3,'duplicate',$4,$5,true)",[id(1),id(20),id(30),id(133),{key:'cross_copy'}]),e=>e?.code==='42501');
  await reset(db); assert.equal((await db.query("select count(*)::int n from item_values where column_key in ('member_copy','cross_copy')")).rows[0].n,0);
  await db.close();
});

test("settings persists validated date metadata through the command receipt and audit path",async()=>{
  const db=await database(); await auth(db,id(10));
  const settings={includeTime:true,displayFormat:"yyyy-MM-dd",notificationOffsetMinutes:30,deadline:true,reminderOffsetsMinutes:[60,1440]};
  const first=(await db.query("select execute_board_column_command($1,$2,$3,'settings',$4,$5) result",[id(1),id(20),id(30),id(140),{dateSettings:settings}])).rows[0].result;
  assert.deepEqual(first.column.date_settings_jsonb,settings);
  const replay=(await db.query("select execute_board_column_command($1,$2,$3,'settings',$4,$5) result",[id(1),id(20),id(30),id(140),{dateSettings:settings}])).rows[0].result;
  assert.equal(replay.replayed,true);
  await reset(db);
  assert.deepEqual((await db.query("select date_settings_jsonb settings from board_columns where id=$1",[id(30)])).rows[0].settings,settings);
  assert.deepEqual((await db.query("select after_jsonb->'date_settings_jsonb' settings from board_column_audit where request_id=$1",[id(140)])).rows[0].settings,settings);
  await auth(db,id(10));
  await assert.rejects(db.query("select execute_board_column_command($1,$2,$3,'settings',$4,$5)",[id(1),id(20),id(31),id(141),{dateSettings:settings}]),e=>e?.code==='22023');
  await db.close();
});

test("pre-successor duplicate receipts replay only with their historical value-copy semantics",async()=>{
  const db=await database();
  await db.exec(`select set_config('request.jwt.claim.sub','${id(10)}',false)`);
  await db.query("select execute_board_column_command_legacy_bbe176($1,$2,$3,'duplicate',$4,$5)",[id(1),id(20),id(30),id(150),{key:'legacy_copy_true'}]);
  await db.query("select execute_board_column_command_legacy_bbe176($1,$2,$3,'duplicate',$4,$5)",[id(1),id(20),id(30),id(151),{key:'legacy_copy_false'}]);
  await auth(db,id(10));
  const replay=(await db.query("select execute_board_column_command($1,$2,$3,'duplicate',$4,$5,true) result",[id(1),id(20),id(30),id(150),{key:'legacy_copy_true'}])).rows[0].result;
  assert.equal(replay.replayed,true); assert.equal(replay.copiedValues,true);
  await assert.rejects(db.query("select execute_board_column_command($1,$2,$3,'duplicate',$4,$5,false)",[id(1),id(20),id(30),id(151),{key:'legacy_copy_false'}]),e=>e?.code==='22023');
  await db.close();
});

test("member, anon, and cross-org attempts fail with no partial schedule or audit",async()=>{
  const db=await database(); const when=new Date(Date.now()+3600000).toISOString();
  await auth(db,id(12));
  await assert.rejects(db.query("select set_board_column_date_schedule($1,$2,$3,$4,$5,'deadline',$6,$7,'{}')",[id(1),id(20),id(30),id(40),id(12),when,id(110)]),e=>e?.code==='42501');
  await reset(db); await auth(db,id(13));
  await assert.rejects(db.query("select set_board_column_date_schedule($1,$2,$3,$4,$5,'deadline',$6,$7,'{}')",[id(1),id(20),id(30),id(40),id(12),when,id(111)]),e=>e?.code==='42501');
  await reset(db); await db.exec("set role anon");
  await assert.rejects(db.query("select set_board_column_date_schedule($1,$2,$3,$4,$5,'deadline',$6,$7,'{}')",[id(1),id(20),id(30),id(40),id(12),when,id(112)]),/permission denied/);
  await db.exec("reset role");
  assert.equal((await db.query("select count(*)::int n from board_column_date_schedules")).rows[0].n,0);
  assert.equal((await db.query("select count(*)::int n from board_column_date_schedule_audit")).rows[0].n,0);
  await db.close();
});

test("validation rejects wrong column, past time, foreign target, and malformed date settings",async()=>{
  const db=await database(); await auth(db,id(10)); const future=new Date(Date.now()+3600000).toISOString(); const past=new Date(Date.now()-3600000).toISOString();
  for(const args of [
    [id(1),id(20),id(31),id(40),id(12),'notification',future,id(120)],
    [id(1),id(20),id(30),id(40),id(12),'notification',past,id(121)],
    [id(1),id(20),id(30),id(40),id(13),'notification',future,id(122)],
  ]) await assert.rejects(db.query("select set_board_column_date_schedule($1,$2,$3,$4,$5,$6,$7,$8,'{}')",args));
  await reset(db);
  await assert.rejects(db.exec("update board_columns set date_settings_jsonb='{\"unknown\":true}' where id='"+id(30)+"'"),/board_columns_date_settings_valid/);
  assert.equal((await db.query("select count(*)::int n from board_column_date_schedules")).rows[0].n,0);
  await db.close();
});

test("successor atomically creates required values and rejects invalid direct writes",async()=>{
  const db=await database(); await reset(db);
  await db.exec(`update board_columns set is_required=true,validation_jsonb='{"minLength":3,"pattern":"^[A-Z]+$"}' where id='${id(31)}'`);
  await assert.rejects(db.exec(`begin; insert into items(id,org_id,board_id,title,assigned_to) values('${id(42)}','${id(1)}','${id(20)}','bypass','${id(10)}'); commit`),e=>e?.code==='23514');
  await db.exec("rollback");
  await auth(db,id(10));
  await assert.rejects(db.query("select create_board_item_with_values($1,$2,null,'missing',$3,'{}',$4)",[id(1),id(20),id(10),id(160)]),e=>e?.code==='23514');
  await assert.rejects(db.query("select create_board_item_with_values($1,$2,null,'invalid',$3,$4,$5)",[id(1),id(20),id(10),{text:'ab'},id(161)]),e=>e?.code==='23514');
  const first=(await db.query("select create_board_item_with_values($1,$2,null,'valid',$3,$4,$5) result",[id(1),id(20),id(10),{text:'ABC'},id(162)])).rows[0].result;
  const replay=(await db.query("select create_board_item_with_values($1,$2,null,'valid',$3,$4,$5) result",[id(1),id(20),id(10),{text:'ABC'},id(162)])).rows[0].result;
  assert.equal(first.replayed,false); assert.equal(replay.replayed,true);
  await reset(db);
  assert.equal((await db.query("select count(*)::int n from items where title in ('missing','invalid','valid')")).rows[0].n,1);
  assert.equal((await db.query("select value_jsonb#>>'{}' value from item_values where item_id=$1 and column_key='text'",[first.itemId])).rows[0].value,'ABC');
  await assert.rejects(db.query("update item_values set value_jsonb='\"no\"' where item_id=$1 and column_key='text'",[first.itemId]),e=>e?.code==='23514');
  await db.close();
});

test("successor dispatches one persistent recipient notification and cancels inactive recipients",async()=>{
  const db=await database(); await auth(db,id(10)); const past=new Date(Date.now()+60000).toISOString();
  const active=(await db.query("select set_board_column_date_schedule($1,$2,$3,$4,$5,'deadline',$6,$7,'{}') result",[id(1),id(20),id(30),id(40),id(12),past,id(170)])).rows[0].result;
  await reset(db); await db.exec("update board_column_date_schedules set scheduled_for=now()-interval '1 minute' where id='"+active.scheduleId+"'");
  await db.exec("set role moawork_outbox_worker"); await assert.rejects(db.query("select * from dispatch_due_board_column_date_schedules(50)"),e=>e?.code==='42501'); await db.exec("reset role");
  await db.exec("set role moawork_date_schedule_worker");
  const first=await db.query("select * from dispatch_due_board_column_date_schedules(50)");
  const replay=await db.query("select * from dispatch_due_board_column_date_schedules(50)");
  assert.equal(first.rows.length,1); assert.equal(first.rows[0].inserted,true); assert.equal(replay.rows.length,0);
  await db.exec("reset role");
  assert.equal((await db.query("select count(*)::int n from notifications where user_id=$1 and dedupe_key=$2",[id(12),'board-date-schedule:'+active.scheduleId])).rows[0].n,1);
  await auth(db,id(10));
  const inactive=(await db.query("select set_board_column_date_schedule($1,$2,$3,$4,$5,'reminder',$6,$7,'{}') result",[id(1),id(20),id(30),id(40),id(12),new Date(Date.now()+60000).toISOString(),id(171)])).rows[0].result;
  await reset(db); await db.exec("update org_members set status='inactive' where org_id='"+id(1)+"' and user_id='"+id(12)+"'; update board_column_date_schedules set scheduled_for=now()-interval '1 minute' where id='"+inactive.scheduleId+"'; set role moawork_date_schedule_worker");
  const stopped=await db.query("select * from dispatch_due_board_column_date_schedules(50)"); assert.equal(stopped.rows[0].inserted,false);
  await db.exec("reset role"); assert.equal((await db.query("select status from board_column_date_schedules where id=$1",[inactive.scheduleId])).rows[0].status,'cancelled');
  await db.close();
});
