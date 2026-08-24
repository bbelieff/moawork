import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "../supabase/migrations/124_issue524_company_detail_feed.sql",
  ),
  "utf8",
);
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("Issue 524 item detail feed", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      create schema auth; create schema storage; create role anon; create role authenticated; create role service_role;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table orgs(id uuid primary key); create table users(id uuid primary key);
      create table org_members(org_id uuid,user_id uuid,role text,scope text,status text,primary key(org_id,user_id));
      create table boards(id uuid primary key,org_id uuid);
      create table items(id uuid primary key,org_id uuid,board_id uuid,assigned_to uuid,deleted_at timestamptz);
      create table item_values(org_id uuid,item_id uuid,column_key text,value_jsonb jsonb,primary key(item_id,column_key));
      create table notifications(id uuid primary key default gen_random_uuid(),org_id uuid,user_id uuid,type text,title text,body text,target_type text,target_id uuid,actor_id uuid,is_action boolean,dedupe_key text);
      create table storage.buckets(id text primary key,name text,public boolean);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      alter table storage.objects enable row level security; alter table storage.objects force row level security;
      create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;
      create unique index notifications_recipient_dedupe_idx on notifications(org_id,user_id,dedupe_key) where dedupe_key is not null;
      create function public.is_org_member(p_org uuid) returns boolean language sql stable as $$select exists(select 1 from org_members where org_id=p_org and user_id=auth.uid() and status='active')$$;
      create function public.effective_permission(p_org uuid,p_permission text) returns boolean language sql stable as $$select auth.uid() is not null and auth.uid()<>'${id(13)}' and p_permission='work.item_upsert'$$;
      create function public.begin_guarded_migration(p_logical_key text,p_file_name text,p_file_digest text,p_expected_predecessor text,p_executor text,p_thread_id text,p_foundation boolean) returns void language sql as $$select$$;
      grant usage on schema auth,storage to authenticated; grant execute on function auth.uid() to authenticated; grant select on items,org_members to authenticated; grant select,insert,delete on storage.objects to authenticated;
      insert into orgs values('${id(1)}'),('${id(2)}'); insert into users values('${id(10)}'),('${id(11)}'),('${id(12)}'),('${id(13)}');
      insert into org_members values('${id(1)}','${id(10)}','owner','all','active'),('${id(1)}','${id(11)}','member','assigned','active'),('${id(1)}','${id(13)}','member','assigned','active'),('${id(2)}','${id(12)}','owner','all','active');
      insert into boards values('${id(20)}','${id(1)}'),('${id(21)}','${id(2)}');
      insert into items values('${id(30)}','${id(1)}','${id(20)}','${id(11)}',null),('${id(31)}','${id(1)}','${id(20)}','${id(10)}',null),('${id(32)}','${id(2)}','${id(21)}','${id(12)}',null),('${id(33)}','${id(1)}','${id(20)}','${id(13)}',null);
    `);
    await db.exec(sql.replace(/do \$\$ begin[\s\S]*?end \$\$;/, ""));
    await db.query("insert into storage.objects(bucket_id,name) values('board-item-files',$1),('board-item-files',$2)",[
      `${id(1)}/${id(20)}/${id(30)}/${id(200)}__mine.pdf`,
      `${id(1)}/${id(20)}/${id(31)}/${id(201)}__other.pdf`,
    ]);
  });

  async function actor(user: string) {
    await db.exec(`select set_config('request.jwt.claim.sub','${user}',false)`);
  }

  it("persists memo/call/link, replays once, and records automatic field changes", async () => {
    await actor(id(10));
    const request = id(100);
    await db.query(
      "select * from add_board_item_detail_event($1,$2,$3,'memo','인수인계 메모',$4)",
      [id(1), id(20), id(30), request],
    );
    await db.query(
      "select * from add_board_item_detail_event($1,$2,$3,'memo','인수인계 메모',$4)",
      [id(1), id(20), id(30), request],
    );
    await db.query(
      "select * from add_board_item_detail_link($1,$2,$3,'자료','https://example.com/file',$4)",
      [id(1), id(20), id(30), id(101)],
    );
    await db.query(
      "select * from register_board_item_detail_file($1,$2,$3,$4,'사업자등록증.pdf','application/pdf',1024,$5,$4)",
      [
        id(1),
        id(20),
        id(30),
        id(102),
        `${id(1)}/${id(20)}/${id(30)}/${id(102)}__file.pdf`,
      ],
    );
    await db.query(
      "insert into item_values values($1,$2,'status','\"상담\"')",
      [id(1), id(30)],
    );
    const counts = (
      await db.query<{ events: number; links: number; files: number }>(
        "select (select count(*)::int from board_item_detail_events) events,(select count(*)::int from board_item_detail_links) links,(select count(*)::int from board_item_detail_files) files",
      )
    ).rows[0];
    expect(counts).toEqual({ events: 2, links: 1, files: 1 });
    expect(
      (
        await db.query<{ count: number }>(
          "select count(*)::int count from notifications where user_id=$1 and type='board_item_changed'",
          [id(11)],
        )
      ).rows[0].count,
    ).toBe(1);
    expect(
      (
        await db.query<{ kind: string }>(
          "select kind from board_item_detail_events order by created_at desc limit 1",
        )
      ).rows[0].kind,
    ).toBe("field_change");
  });

  it("allows assigned member but denies another item, cross-org tuples, inactive/deleted targets and replay mutation", async () => {
    await actor(id(11));
    await expect(
      db.query(
        "select * from add_board_item_detail_event($1,$2,$3,'call','통화',$4)",
        [id(1), id(20), id(30), id(110)],
      ),
    ).resolves.toBeTruthy();
    await expect(
      db.query(
        "select * from add_board_item_detail_event($1,$2,$3,'memo','거부',$4)",
        [id(1), id(20), id(31), id(111)],
      ),
    ).rejects.toThrow(/permission_denied/);
    await actor(id(13));
    await expect(
      db.query(
        "select * from add_board_item_detail_event($1,$2,$3,'memo','쓰기 권한 없음',$4)",
        [id(1), id(20), id(33), id(115)],
      ),
    ).rejects.toThrow(/permission_denied/);
    await expect(
      db.query(
        "select * from add_board_item_detail_event($1,$2,$3,'memo','거부',$4)",
        [id(2), id(21), id(32), id(112)],
      ),
    ).rejects.toThrow(/permission_denied/);
    await actor(id(10));
    await db.query(
      "select * from add_board_item_detail_event($1,$2,$3,'memo','원문',$4)",
      [id(1), id(20), id(30), id(113)],
    );
    await expect(
      db.query(
        "select * from add_board_item_detail_event($1,$2,$3,'memo','변조',$4)",
        [id(1), id(20), id(30), id(113)],
      ),
    ).rejects.toThrow(/request_replay_conflict/);
    await db.query(
      "select * from add_board_item_detail_event($1,$2,$3,'memo','@담당자 확인',$4,$5)",
      [id(1), id(20), id(30), id(114), [id(11)]],
    );
    expect(
      (
        await db.query<{ count: number }>(
          "select count(*)::int count from notifications where user_id=$1 and type='mention'",
          [id(11)],
        )
      ).rows[0].count,
    ).toBe(1);
    await expect(
      db.query(
        "select * from add_board_item_detail_event($1,$2,$3,'memo','@담당자 확인',$4,$5)",
        [id(1), id(20), id(30), id(114), [id(12)]],
      ),
    ).rejects.toThrow(/request_replay_conflict/);

    await actor(id(11));
    await db.exec("set role authenticated");
    expect(
      (
        await db.query<{ count: number }>(
          "select count(*)::int count from board_item_detail_events where item_id=$1",
          [id(31)],
        )
      ).rows[0].count,
    ).toBe(0);
    expect(
      (
        await db.query<{ count: number }>(
          "select count(*)::int count from board_item_detail_events where item_id=$1",
          [id(30)],
        )
      ).rows[0].count,
    ).toBeGreaterThan(0);
    expect(
      (
        await db.query<{ count: number }>(
          "select count(*)::int count from storage.objects where name like $1",
          [`%/${id(31)}/%`],
        )
      ).rows[0].count,
    ).toBe(0);
    await expect(
      db.query(
        "insert into storage.objects(bucket_id,name) values('board-item-files',$1)",
        [`${id(1)}/${id(20)}/${id(31)}/${id(202)}__denied.pdf`],
      ),
    ).rejects.toThrow(/row-level security/);
    await db.exec("reset role");
  });

  it("keeps the ledger append-only, least-privilege, fixed-search-path, and customer-DML free", () => {
    expect(sql).toContain("force row level security");
    expect(sql).toMatch(/security definer set search_path=public,pg_temp/g);
    expect(sql).toMatch(
      /revoke all on public\.board_item_detail_events, public\.board_item_detail_links, public\.board_item_detail_files from public,anon,authenticated,service_role/,
    );
    expect(sql).not.toMatch(
      /\b(update|delete)\s+(?:from\s+)?public\.(?:items|item_values|companies|deals)\b/i,
    );
    expect(sql).not.toMatch(
      /delete_board_item_detail|update_board_item_detail/i,
    );
  });
});
