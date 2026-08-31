import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

const migration = (file: string) =>
  readFileSync(resolve(process.cwd(), `../supabase/migrations/${file}`), "utf8");

const sql = migration("124_issue524_company_detail_feed.sql");
/*
 * #662 — 143 은 성격을 넷으로 «넓히는» 마이그레이션이다.
 *
 * ★ 124 만 올리면 이 파일의 시험은 «지금 운영에 있는 것» 이 아니라 «옛 판» 을 잰다.
 *   운영에는 143 까지 올라가 있으므로 여기서도 둘을 같이 올린다 —
 *   그래야 143 이 124 의 권한·멱등·멘션 계약을 깨지 않았다는 것도 같이 증명된다.
 */
const sql143 = migration("143_issue662_detail_event_kinds.sql");
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
    await db.exec(sql143);
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

  /*
   * #662 — 「히스토리의 성격이 메모 통화 행정 미팅 이렇게 나눠지면 좋겠다」.
   *
   * 화면만 고치면 «고를 수는 있는데 저장이 안 되는» 상태가 된다. 막는 자리가 DB 에 둘 있다 —
   * 테이블의 CHECK 와 RPC 안의 가드. 둘 다 넓혔는지 여기서 잰다.
   */
  it("#662 행정·미팅을 새로 받고, 옛 값은 그대로 두고, 자동은 여전히 사람이 못 고른다", async () => {
    await actor(id(10));

    // ① 새 둘이 실제로 저장된다
    for (const [n, kind] of [
      [300, "admin"],
      [301, "meeting"],
    ] as const) {
      const row = await db.query<{ kind: string }>(
        `select kind from add_board_item_detail_event($1,$2,$3,'${kind}','새 성격',$4)`,
        [id(1), id(20), id(30), id(n)],
      );
      expect(row.rows[0].kind).toBe(kind);
    }

    // ② 옛 둘도 그대로다 — 넓혔지 좁힌 게 아니다
    for (const [n, kind] of [
      [302, "memo"],
      [303, "call"],
    ] as const) {
      await expect(
        db.query(
          `select * from add_board_item_detail_event($1,$2,$3,'${kind}','옛 성격',$4)`,
          [id(1), id(20), id(30), id(n)],
        ),
      ).resolves.toBeTruthy();
    }

    // ③ ★ 자동은 사람이 못 고른다. 시스템이 남기는 기록이다
    await expect(
      db.query(
        "select * from add_board_item_detail_event($1,$2,$3,'field_change','손으로 자동',$4)",
        [id(1), id(20), id(30), id(304)],
      ),
    ).rejects.toThrow(/invalid_detail_event/);

    // ④ 모르는 값도 여전히 막힌다 — 넓힌 것이지 열어 준 것이 아니다
    await expect(
      db.query(
        "select * from add_board_item_detail_event($1,$2,$3,'무엇','아무거나',$4)",
        [id(1), id(20), id(30), id(305)],
      ),
    ).rejects.toThrow(/invalid_detail_event/);

    // ⑤ 그런데 «시스템» 은 여전히 자동 기록을 남길 수 있어야 한다 — CHECK 는 다섯을 받는다
    const allowed = await db.query<{ def: string }>(
      "select pg_get_constraintdef(oid) as def from pg_constraint where conname='board_item_detail_events_kind_check'",
    );
    for (const kind of ["memo", "call", "admin", "meeting", "field_change"]) {
      expect(allowed.rows[0].def).toContain(kind);
    }
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
