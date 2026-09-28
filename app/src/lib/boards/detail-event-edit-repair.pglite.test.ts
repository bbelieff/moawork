import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

const sql150 = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/150_issue700_detail_event_edit.sql"),
  "utf8",
);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("150 detail event edit repair (PGlite actual SQL)", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      create schema auth; create schema storage; create role anon; create role authenticated; create role service_role;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table orgs(id uuid primary key); create table users(id uuid primary key);
      create table org_members(org_id uuid,user_id uuid,role text,scope text,status text,primary key(org_id,user_id));
      create table boards(id uuid primary key,org_id uuid,source text,is_system boolean not null default false);
      create table items(id uuid primary key,org_id uuid,board_id uuid,assigned_to uuid,deleted_at timestamptz);
      create table item_values(org_id uuid,item_id uuid,column_key text,value_jsonb jsonb,primary key(item_id,column_key));
      create table new_lead_requests(org_id uuid,request_id uuid,operation text,deal_id uuid,item_id uuid,actor_id uuid,payload jsonb,primary key(org_id,request_id));
      create table notifications(id uuid primary key default gen_random_uuid(),org_id uuid,user_id uuid,type text,title text,body text,target_type text,target_id uuid,actor_id uuid,is_action boolean,dedupe_key text);
      create table storage.buckets(id text primary key,name text,public boolean);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;
      create table board_item_detail_events(id uuid primary key default gen_random_uuid(),org_id uuid not null references orgs(id),board_id uuid not null references boards(id),item_id uuid not null references items(id),actor_id uuid references users(id),kind text not null check (kind in ('memo','call','admin','meeting','field_change')),body text not null check (length(btrim(body)) between 1 and 4000),metadata jsonb not null default '{}'::jsonb,request_id uuid not null,created_at timestamptz not null default now(),deleted_at timestamptz,deleted_by uuid,unique(org_id,request_id));
      create function public.is_org_member(p_org uuid) returns boolean language sql stable as $$select exists(select 1 from org_members where org_id=p_org and user_id=auth.uid() and status='active')$$;
      create function public.effective_permission(p_org uuid,p_permission text) returns boolean language sql stable as $$select auth.uid() is not null and auth.uid()<>'${id(13)}' and p_permission='work.item_upsert'$$;
      create function public.begin_guarded_migration(p_logical_key text,p_file_name text,p_file_digest text,p_expected_predecessor text,p_executor text,p_thread_id text,p_foundation boolean) returns void language sql as $$select$$;
      grant usage on schema auth,storage to authenticated;
      insert into orgs values('${id(1)}'),('${id(2)}');
      insert into users values('${id(10)}'),('${id(11)}'),('${id(12)}'),('${id(13)}'),('${id(14)}');
      insert into org_members values('${id(1)}','${id(10)}','owner','all','active'),('${id(1)}','${id(11)}','member','assigned','active'),('${id(1)}','${id(13)}','member','assigned','active'),('${id(1)}','${id(14)}','member','all','active'),('${id(2)}','${id(12)}','owner','all','active');
      insert into boards values('${id(20)}','${id(1)}','core.default-tab/new-lead',false),('${id(21)}','${id(2)}','core.default-tab/new-lead',false),('${id(22)}','${id(1)}','core.default-tab/notice',true);
      insert into items values('${id(30)}','${id(1)}','${id(20)}','${id(11)}',null),('${id(31)}','${id(1)}','${id(20)}','${id(10)}',null),('${id(32)}','${id(2)}','${id(21)}','${id(12)}',null),('${id(33)}','${id(1)}','${id(22)}','${id(10)}',null);
    `);
    await db.exec(sql150);
  });

  async function actor(user: string) {
    await db.exec(`select set_config('request.jwt.claim.sub','${user}',false)`);
  }

  async function createMemo(item: string, body: string, req: string, asUser: string) {
    await actor(asUser);
    const row = await db.query<{ id: string }>(
      `insert into board_item_detail_events(org_id,board_id,item_id,actor_id,kind,body,request_id) values('${id(1)}','${id(20)}','${item}','${asUser}','memo','${body}','${req}') returning id`,
    );
    return row.rows[0].id;
  }

  it("재배정 뒤 옛 담당자는 자기 옛 메모도 못 고친다 (현재 가시성)", async () => {
    const event = await createMemo(id(30), "옛 메모", id(500), id(11));
    // 아이템을 소유자에게 재배정
    await db.exec(`update items set assigned_to='${id(10)}' where id='${id(30)}'`);
    await actor(id(11));
    await expect(
      db.query(`select * from update_board_item_detail_event('${id(1)}','${id(20)}','${id(30)}','${event}','고치기','${id(501)}',0,'옛 메모')`),
    ).rejects.toThrow(/permission_denied/);
    // 원본 그대로
    const body = (await db.query<{ body: string }>(`select body from board_item_detail_events where id='${event}'`)).rows[0].body;
    expect(body).toBe("옛 메모");
    // 되돌려 다음 테스트 격리
    await db.exec(`update items set assigned_to='${id(11)}' where id='${id(30)}'`);
  });

  it("cross-org·inactive·system·NULL 작성자는 막는다", async () => {
    const event = await createMemo(id(30), "원본", id(510), id(11));
    // cross-org
    await actor(id(12));
    await expect(
      db.query(`select * from update_board_item_detail_event('${id(1)}','${id(20)}','${id(30)}','${event}','침범','${id(511)}',0,'원본')`),
    ).rejects.toThrow(/permission_denied/);
    // inactive
    await db.exec(`update org_members set status='inactive' where org_id='${id(1)}' and user_id='${id(11)}'`);
    await actor(id(11));
    await expect(
      db.query(`select * from update_board_item_detail_event('${id(1)}','${id(20)}','${id(30)}','${event}','고치기','${id(512)}',0,'원본')`),
    ).rejects.toThrow(/permission_denied/);
    await db.exec(`update org_members set status='active' where org_id='${id(1)}' and user_id='${id(11)}'`);
    // system board
    await actor(id(10));
    const sysEvent = (
      await db.query<{ id: string }>(
        `insert into board_item_detail_events(org_id,board_id,item_id,actor_id,kind,body,request_id) values('${id(1)}','${id(22)}','${id(33)}','${id(10)}','memo','시스템메모','${id(513)}') returning id`,
      )
    ).rows[0].id;
    await expect(
      db.query(`select * from update_board_item_detail_event('${id(1)}','${id(22)}','${id(33)}','${sysEvent}','고치기','${id(514)}',0,'시스템메모')`),
    ).rejects.toThrow(/permission_denied/);
    // NULL 작성자: 비소유자는 못 고친다
    const nullEvent = (
      await db.query<{ id: string }>(
        `insert into board_item_detail_events(org_id,board_id,item_id,actor_id,kind,body,request_id) values('${id(1)}','${id(20)}','${id(30)}',null,'memo','주인없음','${id(515)}') returning id`,
      )
    ).rows[0].id;
    await actor(id(11));
    await expect(
      db.query(`select * from update_board_item_detail_event('${id(1)}','${id(20)}','${id(30)}','${nullEvent}','탈취','${id(516)}',0,'주인없음')`),
    ).rejects.toThrow(/permission_denied/);
    // 자동 생성은 소유자도 못 고친다
    const auto = (
      await db.query<{ id: string }>(
        `insert into board_item_detail_events(org_id,board_id,item_id,actor_id,kind,body,request_id) values('${id(1)}','${id(20)}','${id(30)}','${id(10)}','field_change','자동','${id(517)}') returning id`,
      )
    ).rows[0].id;
    await actor(id(10));
    await expect(
      db.query(`select * from update_board_item_detail_event('${id(1)}','${id(20)}','${id(30)}','${auto}','고치기','${id(518)}',0,'자동')`),
    ).rejects.toThrow(/invalid_detail_event_edit/);
  });

  it("requestA→ownerB→replayA는 옛글로 덮지 않는다 (원장+버전)", async () => {
    const event = await createMemo(id(31), "v0", id(520), id(10));
    await actor(id(10));
    await db.query(
      `select * from update_board_item_detail_event('${id(1)}','${id(20)}','${id(31)}','${event}','v1','${id(521)}',0,'v0')`,
    );
    // 다른 요청으로 v2 (owner가 같은 줄을 다시 고침을 흉내: 같은 actor 다른 request)
    await db.query(
      `select * from update_board_item_detail_event('${id(1)}','${id(20)}','${id(31)}','${event}','v2','${id(522)}',1,'v1')`,
    );
    // 옛 요청 replay (같은 request, 같은 옛 본문) → 뒤에 편집이 끼었으므로 거절
    await expect(
      db.query(
        `select * from update_board_item_detail_event('${id(1)}','${id(20)}','${id(31)}','${event}','v1','${id(521)}',0,'v0')`,
      ),
    ).rejects.toThrow(/request_replay_conflict/);
    const cur = (await db.query<{ body: string; edit_count: number }>(`select body,edit_count from board_item_detail_events where id='${event}'`)).rows[0];
    expect(cur).toEqual({ body: "v2", edit_count: 2 });
    // 같은 요청·같은 결과의 순수 재시도는 성공 (멱등)
    await actor(id(10));
    const replay = await db.query<{ body: string }>(
      `select * from update_board_item_detail_event('${id(1)}','${id(20)}','${id(31)}','${event}','v2','${id(522)}',1,'v1')`,
    );
    expect(replay.rows[0].body).toBe("v2");
  });

  it("낡은 초안은 다른 request로 못 쓴다 (expected/base), 취소는 쓰지 않는다", async () => {
    const event = await createMemo(id(31), "base", id(530), id(10));
    await actor(id(10));
    await db.query(
      `select * from update_board_item_detail_event('${id(1)}','${id(20)}','${id(31)}','${event}','edit1','${id(531)}',0,'base')`,
    );
    // 낡은 expected(0)로 다른 request → stale
    await expect(
      db.query(
        `select * from update_board_item_detail_event('${id(1)}','${id(20)}','${id(31)}','${event}','stale','${id(532)}',0,'base')`,
      ),
    ).rejects.toThrow(/stale_detail_event_edit/);
    // 낡은 base로 다른 request → stale
    await expect(
      db.query(
        `select * from update_board_item_detail_event('${id(1)}','${id(20)}','${id(31)}','${event}','stale2','${id(533)}',1,'base')`,
      ),
    ).rejects.toThrow(/stale_detail_event_edit/);
    // 같은 본문 no-op은 이력을 늘리지 않는다 (취소와 같은 효과: 쓰기 없음)
    const before = (await db.query<{ edit_count: number }>(`select edit_count from board_item_detail_events where id='${event}'`)).rows[0].edit_count;
    await db.query(
      `select * from update_board_item_detail_event('${id(1)}','${id(20)}','${id(31)}','${event}','edit1','${id(534)}',1,'edit1')`,
    );
    const after = (await db.query<{ edit_count: number }>(`select edit_count from board_item_detail_events where id='${event}'`)).rows[0].edit_count;
    expect(after).toBe(before);
    const revs = (await db.query<{ n: number }>(`select count(*)::int n from board_item_detail_event_revisions where event_id='${event}'`)).rows[0].n;
    expect(revs).toBe(1);
  });

  it("25번 고쳐도 원본까지 전부 남는다 (무절단)", async () => {
    const event = await createMemo(id(31), "원본0", id(540), id(10));
    await actor(id(10));
    let base = "원본0";
    for (let n = 1; n <= 25; n += 1) {
      const next = `본문${n}`;
      await db.query(
        `select * from update_board_item_detail_event('${id(1)}','${id(20)}','${id(31)}','${event}','${next}','${id(540 + n)}',${n - 1},'${base}')`,
      );
      base = next;
    }
    const row = (await db.query<{ body: string; edit_count: number }>(`select body,edit_count from board_item_detail_events where id='${event}'`)).rows[0];
    expect(row).toEqual({ body: "본문25", edit_count: 25 });
    const revCount = (await db.query<{ n: number }>(`select count(*)::int n from board_item_detail_event_revisions where event_id='${event}'`)).rows[0].n;
    expect(revCount).toBe(25);
    const first = (await db.query<{ body: string }>(`select body from board_item_detail_event_revisions where event_id='${event}' and edit_number=1`)).rows[0].body;
    expect(first).toBe("원본0");
    const histLen = (await db.query<{ n: number }>(`select jsonb_array_length(metadata->'edit_history')::int n from board_item_detail_events where id='${event}'`)).rows[0].n;
    expect(histLen).toBe(25);
  });

  it("인증 전 replay는 누설하지 않고 원장은 actor/event/payload를 묶는다", async () => {
    const event = await createMemo(id(31), "비밀", id(550), id(10));
    await actor(id(10));
    await db.query(
      `select * from update_board_item_detail_event('${id(1)}','${id(20)}','${id(31)}','${event}','비밀1','${id(551)}',0,'비밀')`,
    );
    // 권한 없는 자가 같은 request·같은 내용으로 replay해도 행을 돌려받지 못한다
    await actor(id(13));
    await expect(
      db.query(
        `select * from update_board_item_detail_event('${id(1)}','${id(20)}','${id(31)}','${event}','비밀1','${id(551)}',0,'비밀')`,
      ),
    ).rejects.toThrow(/permission_denied/);
    // 같은 request로 payload가 다르면 소유자도 거절
    await actor(id(10));
    await expect(
      db.query(
        `select * from update_board_item_detail_event('${id(1)}','${id(20)}','${id(31)}','${event}','변조','${id(551)}',0,'비밀')`,
      ),
    ).rejects.toThrow(/request_replay_conflict/);
  });

  it("동일 본문도 요청을 소비하고 무버전 쓰기를 거절한다", async () => {
    const event = await createMemo(id(31), "원본", id(580), id(10));
    const call = `select * from update_board_item_detail_event('${id(1)}','${id(20)}','${id(31)}','${event}','원본','${id(581)}',0,'원본')`;
    await db.query(call);
    await db.query(call);
    await expect(db.query(`select * from update_board_item_detail_event('${id(1)}','${id(20)}','${id(31)}','${event}','다른내용','${id(581)}',0,'원본')`)).rejects.toThrow(/request_replay_conflict/);
    await expect(db.query(`select * from update_board_item_detail_event('${id(1)}','${id(20)}','${id(31)}','${event}','변경','${id(582)}',null,null)`)).rejects.toThrow(/invalid_detail_event_edit/);
    const revisions = await db.query<{ n: number }>("select count(*)::int n from board_item_detail_event_revisions");
    expect(revisions.rows[0].n).toBe(0);
  });

  it("넓은 GRANT·자동 body 변경·고정 search_path를 파일에서 잡는다", () => {
    expect(sql150).toContain("force row level security");
    expect(sql150).toMatch(/security definer set search_path = public, pg_temp/);
    expect(sql150).not.toMatch(/grant\s+(all|select).*\son\s+public\.board_item_detail_event_revisions\s+to\s+authenticated/i);
    expect(sql150).not.toMatch(/grant\s+(all|select).*\son\s+public\.board_item_detail_edit_requests\s+to\s+authenticated/i);
    // 마이그레이션 본문에 기존 행 body를 고치는 top-level UPDATE는 없다 (함수 안 제외)
    const withoutFunctions = sql150
      .replace(/create or replace function[\s\S]*?end \$\$;/giu, "");
    expect(withoutFunctions).not.toMatch(/update\s+public\.board_item_detail_events\s+set\s+body/i);
  });
});
