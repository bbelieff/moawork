import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../supabase/migrations/128_issue542_new_lead_v6plus.sql"), "utf8");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("Issue #542 V6+ persistence and limits", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      create schema auth; create schema storage; create role anon; create role authenticated; create role service_role;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table orgs(id uuid primary key,status text); create table users(id uuid primary key);
      create table org_members(org_id uuid,user_id uuid,role text,scope text,status text,primary key(org_id,user_id));
      create table boards(id uuid primary key default gen_random_uuid(),org_id uuid,name text not null,description text,icon text,is_system boolean,source text,sort_order integer,created_by uuid,detail_layout_jsonb jsonb default '[]'::jsonb,updated_at timestamptz default now());
      alter table boards enable row level security; alter table boards force row level security;
      create table board_columns(id uuid primary key default gen_random_uuid(),org_id uuid,board_id uuid,key text,label text,type text,source text,right_pinned boolean,options_jsonb jsonb,sort_order integer,is_readonly boolean);
      create table items(id uuid primary key,org_id uuid,board_id uuid,assigned_to uuid,deleted_at timestamptz);
      create table board_item_detail_links(id uuid primary key default gen_random_uuid(),org_id uuid,board_id uuid,item_id uuid,created_by uuid,label text not null,url text not null,request_id uuid,created_at timestamptz default now(),unique(org_id,request_id));
      alter table board_item_detail_links add constraint board_item_detail_links_label_check check(length(btrim(label)) between 1 and 200);
      alter table board_item_detail_links add constraint board_item_detail_links_url_check check(url~'^https://');
      create table board_item_detail_files(id uuid primary key,org_id uuid,board_id uuid,item_id uuid,uploaded_by uuid,name text,mime_type text,size_bytes bigint,storage_path text unique,request_id uuid,created_at timestamptz default now(),unique(org_id,request_id));
      create table storage.buckets(id text primary key,file_size_limit bigint); insert into storage.buckets values('board-item-files',null);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      alter table storage.objects enable row level security; alter table storage.objects force row level security;
      create function public.is_org_member(p_org uuid) returns boolean language sql stable as $$select exists(select 1 from org_members where org_id=p_org and user_id=auth.uid() and status='active')$$;
      create function public.effective_permission(p_org uuid,p_permission text) returns boolean language sql stable as $$select exists(select 1 from org_members where org_id=p_org and user_id=auth.uid() and status='active' and auth.uid()<>'${id(13)}' and (p_permission in ('work.view_tabs','work.item_upsert') or (role in ('owner','admin') and p_permission='structure.tab_manage')))$$;
      create function public.begin_guarded_migration(p_logical_key text,p_file_name text,p_file_digest text,p_expected_predecessor text,p_executor text,p_thread_id text,p_foundation boolean) returns void language sql as $$select$$;
      insert into orgs values('${id(1)}','active'),('${id(2)}','active');
      insert into users values('${id(10)}'),('${id(11)}'),('${id(12)}'),('${id(13)}');
      insert into org_members values('${id(1)}','${id(10)}','owner','all','active'),('${id(1)}','${id(11)}','member','assigned','active'),('${id(1)}','${id(13)}','member','assigned','active'),('${id(2)}','${id(12)}','owner','all','active');
      insert into boards(id,org_id,name,is_system,source,sort_order,created_by) values
        ('${id(20)}','${id(1)}','신규리드',false,null,0,'${id(10)}'),
        ('${id(21)}','${id(1)}','계약업체',false,null,1,'${id(10)}'),
        ('${id(22)}','${id(1)}','시스템',true,null,9,'${id(10)}'),
        ('${id(23)}','${id(2)}','다른 회사',false,null,0,'${id(12)}'),
        ('${id(24)}','${id(1)}','내부 프리셋',false,'user.section-preset/demo',2,'${id(10)}');
      insert into items values('${id(30)}','${id(1)}','${id(20)}','${id(11)}',null),('${id(31)}','${id(1)}','${id(20)}','${id(10)}',null),('${id(32)}','${id(2)}','${id(23)}','${id(12)}',null);
      grant usage on schema public,auth,storage to authenticated;
      grant execute on function auth.uid(), public.is_org_member(uuid), public.effective_permission(uuid,text) to authenticated;
      grant select,insert,update,delete on boards to authenticated;
      grant select on org_members to authenticated;
      grant insert,update on storage.objects to authenticated;
    `);
    await db.exec(sql);
  });

  async function actor(userId: string) {
    await db.exec(`select set_config('request.jwt.claim.sub','${userId}',false)`);
  }

  it("persists onboarding per user, org and version without granting authority", async () => {
    await actor(id(10));
    expect((await db.query<{ state: string }>("select set_new_lead_onboarding_state($1,'v1','dismissed',$2) state",[id(1),id(100)])).rows[0].state).toBe("dismissed");
    expect((await db.query<{ state: string }>("select * from get_new_lead_onboarding_state($1,'v1')",[id(1)])).rows[0].state).toBe("dismissed");
    await actor(id(11));
    expect((await db.query("select * from get_new_lead_onboarding_state($1,'v1')",[id(1)])).rows).toHaveLength(0);
    await actor(id(13));
    await expect(db.query("select * from set_new_lead_onboarding_state($1,'v1','completed',$2)",[id(1),id(101)])).rejects.toThrow(/permission_denied/);
    await actor(id(10));
    await expect(db.query("select * from get_new_lead_onboarding_state($1,'v1')",[id(2)])).rejects.toThrow(/permission_denied/);
  });

  it("reorders the complete non-system set, replays, and rejects missing or cross-tenant ids", async () => {
    await actor(id(10));
    await db.query("select * from reorder_workspace_boards($1,$2,$3)",[id(1),[id(21),id(20)],id(110)]);
    const order = (await db.query<{ id: string }>("select id from boards where org_id=$1 and not is_system and coalesce(source,'') not like 'user.section-preset/%' order by sort_order",[id(1)])).rows.map((row) => row.id);
    expect(order).toEqual([id(21),id(20)]);
    await expect(db.query("select * from reorder_workspace_boards($1,$2,$3)",[id(1),[id(21)],id(111)])).rejects.toThrow(/board_order_invalid/);
    await expect(db.query("select * from reorder_workspace_boards($1,$2,$3)",[id(1),[id(21),id(23)],id(112)])).rejects.toThrow(/board_order_invalid/);
    await expect(db.query("select * from reorder_workspace_boards($1,$2,$3)",[id(1),[id(20),id(21)],id(110)])).rejects.toThrow(/request_replay_conflict/);
  });

  it("creates a board atomically, preserves source, and never duplicates defaults on replay", async () => {
    await actor(id(10));
    const plain = (await db.query<{ id: string; source: string | null }>(
      "select id,source from create_workspace_board($1,'새 탭','','','',$2)",
      [id(1),id(120)],
    )).rows[0];
    expect(plain.source).toBeNull();
    expect((await db.query<{ count: number }>("select count(*)::int count from board_columns where board_id=$1",[plain.id])).rows[0].count).toBe(3);
    const replay = (await db.query<{ id: string }>("select id from create_workspace_board($1,'새 탭','','','',$2)",[id(1),id(120)])).rows[0];
    expect(replay.id).toBe(plain.id);
    expect((await db.query<{ count: number }>("select count(*)::int count from board_columns where board_id=$1",[plain.id])).rows[0].count).toBe(3);

    const preset = (await db.query<{ id: string; source: string }>(
      "select id,source from create_workspace_board($1,'정의 탭','','','user.section-preset/safe',$2)",
      [id(1),id(121)],
    )).rows[0];
    expect(preset.source).toBe("user.section-preset/safe");
    expect((await db.query<{ count: number }>("select count(*)::int count from board_columns where board_id=$1",[preset.id])).rows[0].count).toBe(0);
  });

  it("keeps direct board writes behind RLS and separates structure from destructive authority", async () => {
    await actor(id(11));
    await db.exec("set role authenticated");
    await expect(db.query("insert into boards(id,org_id,name,is_system,sort_order) values($1,$2,'금지',false,99)",[id(130),id(1)])).rejects.toThrow();
    await db.exec("reset role");
    await actor(id(10));
    await db.exec("set role authenticated");
    await expect(db.query("insert into boards(id,org_id,name,is_system,sort_order) values($1,$2,'직접 생성 금지',false,99)",[id(131),id(1)])).rejects.toThrow();
    await expect(db.query("update boards set sort_order=99 where id=$1",[id(20)])).rejects.toThrow();
    await expect(db.query("update boards set name='허용된 메타데이터' where id=$1",[id(20)])).resolves.toBeTruthy();
    expect((await db.query("delete from boards where id=$1",[id(20)])).affectedRows).toBe(0);
    await db.exec("reset role");
    expect((await db.query<{ count: number }>("select count(*)::int count from boards where id=$1",[id(20)])).rows[0].count).toBe(1);
  });

  it("enforces 20 HTTPS links, 5 files, 10MB each and 30MB total after replay checks", async () => {
    await actor(id(10));
    for (let index=0; index<20; index+=1) {
      await db.query("select * from add_board_item_detail_link($1,$2,$3,$4,$5,$6)",[id(1),id(20),id(30),`자료 ${index}`,`https://example.com/${index}`,id(200+index)]);
    }
    await expect(db.query("select * from add_board_item_detail_link($1,$2,$3,'초과','https://example.com/x',$4)",[id(1),id(20),id(30),id(250)])).rejects.toThrow(/detail_link_limit/);
    await expect(db.query("select * from add_board_item_detail_link($1,$2,$3,'자료 0','https://example.com/0',$4)",[id(1),id(20),id(30),id(200)])).resolves.toBeTruthy();
    await expect(db.query("select * from add_board_item_detail_link($1,$2,$3,$4,$5,$6)",[id(1),id(20),id(31),"x".repeat(101),"http://bad",id(251)])).rejects.toThrow(/invalid_detail_link/);
    for (let index=0; index<5; index+=1) {
      const fileId=id(300+index);
      const path=`${id(1)}/${id(20)}/${id(31)}/${fileId}__file.pdf`;
      await db.query("select * from reserve_board_item_detail_file($1,$2,$3,$4,$5,'application/pdf',1048576,$6,$4)",[id(1),id(20),id(31),fileId,`file-${index}.pdf`,path]);
      await db.exec("set role authenticated");
      await expect(db.query("insert into storage.objects(bucket_id,name) values('board-item-files',$1)",[path])).resolves.toBeTruthy();
      await db.exec("reset role");
      await db.query("select * from register_board_item_detail_file($1,$2,$3,$4,$5,'application/pdf',1048576,$6,$4)",[id(1),id(20),id(31),fileId,`file-${index}.pdf`,`${id(1)}/${id(20)}/${id(31)}/${fileId}__file.pdf`]);
    }
    const sixth=id(306);
    await expect(db.query("select * from reserve_board_item_detail_file($1,$2,$3,$4,'six.pdf','application/pdf',1,$5,$4)",[id(1),id(20),id(31),sixth,`${id(1)}/${id(20)}/${id(31)}/${sixth}__six.pdf`])).rejects.toThrow(/detail_file_limit/);
    const unreserved=id(307);
    await db.exec("set role authenticated");
    await expect(db.query("insert into storage.objects(bucket_id,name) values('board-item-files',$1)",[`${id(1)}/${id(20)}/${id(31)}/${unreserved}__direct.pdf`])).rejects.toThrow();
    await db.exec("reset role");
    await expect(db.query("select * from register_board_item_detail_file($1,$2,$3,$4,'direct.pdf','application/pdf',1,$5,$4)",[id(1),id(20),id(31),unreserved,`${id(1)}/${id(20)}/${id(31)}/${unreserved}__direct.pdf`])).rejects.toThrow(/file_reservation_required/);
  });

  it("is replay-safe on a second migration run and keeps least-privilege ACLs", async () => {
    await expect(db.exec(sql)).resolves.toBeDefined();
    expect(sql).toMatch(/security definer set search_path=public,pg_temp/g);
    expect(sql).toMatch(/revoke all on public\.new_lead_onboarding_state, public\.new_lead_onboarding_requests from public,anon,authenticated,service_role/);
    expect(sql).not.toMatch(/\b(insert|update|delete)\s+(?:into\s+|from\s+)?public\.(?:companies|org_members|deals)\b/i);
  });
});
