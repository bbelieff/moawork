import { PGlite, type PGliteInterface } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// 시험 대상. 작업 폴더(app/)에서 supabase 쪽 마이그레이션을 읽는다.
const migration = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/169_board_trash_lifecycle.sql"),
  "utf8",
);

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const ids = {
  orgA: id("a1"),
  orgB: id("b1"),
  owner: id("1a"),
  admin: id("2a"),
  member: id("3a"),
  ownerB: id("1b"),
};

// 숫자만으로 매번 새 uuid를 만든다.
let seq = 0;
const fresh = () => `30000000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;

// 169이 참조하는 것만 최소로 둔다. 열 이름은 실제와 같게.
const SCHEMA = `
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema storage;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('app.uid', true), '')::uuid $$;

  create table public.orgs(id uuid primary key);
  create table public.users(id uuid primary key);
  create table public.org_members(
    org_id uuid not null references public.orgs(id) on delete cascade,
    user_id uuid not null references public.users(id),
    role text not null,
    status text not null default 'active',
    primary key(org_id, user_id)
  );
  create function public.is_org_member(p_org uuid) returns boolean language sql stable as
    $$ select exists(select 1 from public.org_members
         where org_id = p_org and user_id = auth.uid() and status = 'active') $$;
  create function public.effective_permission(p_org uuid, p_key text) returns boolean
    language sql stable as
    $$ select case (select role from public.org_members
         where org_id = p_org and user_id = auth.uid() and status = 'active')
      when 'owner' then true
      when 'admin' then p_key = 'structure.tab_manage'
      else false end $$;
  create function public.begin_guarded_migration(
    p_logical_key text, p_file_name text, p_file_digest text,
    p_expected_predecessor text, p_executor text, p_thread_id text, p_foundation boolean
  ) returns void language sql as $$ select $$;
  create function public.item_operations_require_actor(p_org uuid, p_key text)
    returns void language sql as $$ select $$;
  create function public.item_operations_visible(p_org uuid, p_user uuid)
    returns boolean language sql as $$ select true $$;

  create table public.boards(
    id uuid primary key default gen_random_uuid(),
    org_id uuid, name text, description text, icon text,
    is_system boolean default false, source text, sort_order integer default 0,
    created_by uuid, created_at timestamptz default now(), updated_at timestamptz default now(),
    unique(org_id, id)
  );
  create unique index boards_org_product_source_uq
    on public.boards(org_id, source) where source like 'core.default-tab/%';
  create table public.board_columns(
    id uuid primary key default gen_random_uuid(),
    org_id uuid, board_id uuid references public.boards(id) on delete cascade,
    key text, label text, type text, source text,
    right_pinned boolean, options_jsonb jsonb, sort_order integer, is_readonly boolean
  );
  create table public.board_groups(
    id uuid primary key default gen_random_uuid(),
    org_id uuid, board_id uuid references public.boards(id) on delete cascade,
    name text, color text, sort_order integer default 0
  );
  create table public.board_create_requests(
    org_id uuid, request_id uuid, actor_id uuid, payload jsonb,
    board_id uuid references public.boards(id) on delete cascade,
    primary key(org_id, request_id)
  );
  create table public.board_order_requests(
    org_id uuid, request_id uuid, actor_id uuid, board_ids uuid[],
    created_at timestamptz default now(), primary key(org_id, request_id)
  );
  create table public.items(
    id uuid primary key default gen_random_uuid(),
    org_id uuid, board_id uuid references public.boards(id) on delete cascade,
    group_id uuid references public.board_groups(id) on delete set null,
    parent_item_id uuid references public.items(id) on delete cascade,
    title text, assigned_to uuid, archived_at timestamptz, archived_by uuid,
    deleted_at timestamptz, updated_at timestamptz default now()
  );
  create table public.item_values(
    org_id uuid, item_id uuid references public.items(id) on delete cascade,
    column_key text, value_jsonb jsonb,
    primary key(item_id, column_key)
  );
  create table public.messaging_trigger_rules(
    id uuid primary key default gen_random_uuid(),
    org_id uuid, board_id uuid references public.boards(id) on delete cascade,
    enabled boolean default true
  );
  create table public.board_automation_rules(
    id uuid primary key default gen_random_uuid(),
    org_id uuid, board_id uuid references public.boards(id) on delete cascade,
    enabled boolean default true
  );
  create table public.board_item_detail_events(
    id uuid primary key default gen_random_uuid(),
    org_id uuid, board_id uuid references public.boards(id),
    item_id uuid references public.items(id), kind text, deleted_at timestamptz
  );
  create table public.board_item_detail_links(
    id uuid primary key default gen_random_uuid(),
    org_id uuid, board_id uuid references public.boards(id),
    item_id uuid references public.items(id)
  );
  create table public.board_item_detail_files(
    id uuid primary key default gen_random_uuid(),
    org_id uuid, board_id uuid references public.boards(id),
    item_id uuid references public.items(id), storage_path text unique
  );
  create table public.board_item_detail_file_reservations(
    org_id uuid, request_id uuid,
    board_id uuid references public.boards(id) on delete cascade,
    item_id uuid references public.items(id) on delete cascade,
    storage_path text unique, state text,
    primary key(org_id, request_id)
  );
  create table public.board_item_cloud_folder_requests(
    org_id uuid, request_id uuid,
    board_id uuid references public.boards(id),
    item_id uuid references public.items(id),
    primary key(org_id, request_id)
  );
  create table public.company_work_start_requests(
    org_id uuid, request_id uuid,
    item_id uuid references public.items(id) on delete restrict,
    primary key(org_id, request_id)
  );
  create table public.company_intake_requests(
    org_id uuid, request_id uuid,
    item_id uuid references public.items(id) on delete restrict,
    primary key(org_id, request_id)
  );
  create table public.board_item_create_receipts(
    org_id uuid, request_id uuid, item_id uuid,
    primary key(org_id, request_id)
  );
  create table public.notifications(
    id uuid primary key default gen_random_uuid(),
    org_id uuid, target_type text, target_id uuid
  );
  create table public.tab_views(
    id uuid primary key default gen_random_uuid(),
    org_id uuid, board_id uuid references public.boards(id) on delete cascade
  );
  create table storage.objects(bucket_id text, name text);
  alter table storage.objects enable row level security;

  grant usage on schema public, auth, storage to authenticated;
  grant select on all tables in schema public to authenticated;
`;

// 169이 가드 함수를 다시 정의하므로, 153 같은 트리거는 적용 뒤에 붙인다.
const TRIGGERS = `
  create trigger guard_archived_item_write
    before update or delete on public.items
    for each row execute function public.guard_archived_item_write();
  create trigger guard_archived_item_child_write_values
    before insert or update or delete on public.item_values
    for each row execute function public.guard_archived_item_child_write();
  create trigger guard_archived_item_child_write_events
    before insert or update or delete on public.board_item_detail_events
    for each row execute function public.guard_archived_item_child_write();
`;

const SEED = `
  insert into public.orgs(id) values ('${ids.orgA}'), ('${ids.orgB}');
  insert into public.users(id) values
    ('${ids.owner}'), ('${ids.admin}'), ('${ids.member}'), ('${ids.ownerB}');
  insert into public.org_members(org_id, user_id, role) values
    ('${ids.orgA}', '${ids.owner}', 'owner'),
    ('${ids.orgA}', '${ids.admin}', 'admin'),
    ('${ids.orgA}', '${ids.member}', 'member'),
    ('${ids.orgB}', '${ids.ownerB}', 'owner');
`;

describe("169 — 탭 휴지통 생애주기", () => {
  let template: PGlite;
  let db: PGliteInterface;
  beforeAll(async () => {
    template = new PGlite();
    await template.exec(SCHEMA);
    await template.exec(migration);
    await template.exec(TRIGGERS);
    await template.exec(SEED);
  });
  afterAll(async () => { await template.close(); });

  beforeEach(async () => {
    db = await template.clone();
  });
  afterEach(async () => { await db.close(); });

  const as = (uid: string) => db.exec(`set app.uid = '${uid}';`);

  async function createBoard(
    uid: string, org: string, name: string, source: string | null, requestId: string, nav?: string,
  ) {
    await as(uid);
    const src = source === null ? "null" : `'${source}'`;
    const navArg = nav === undefined ? "" : `,'${nav}'`;
    const rows = await db.query<{ id: string; source: string | null; nav_section: string | null }>(
      `select id, source, nav_section from public.create_workspace_board(` +
      `'${org}','${name}',null,null,${src},'${requestId}'${navArg})`);
    return rows.rows[0];
  }

  async function trashBoard(uid: string, org: string, boardId: string) {
    await as(uid);
    const rows = await db.query<{
      id: string; source: string | null; trashed_source: string | null;
      deleted_at: string | null; trash_paused_rules: unknown;
    }>(`select id, source, trashed_source, deleted_at, trash_paused_rules
         from public.trash_workspace_board('${org}','${boardId}')`);
    return rows.rows[0];
  }

  async function fails(promise: Promise<unknown>) {
    try {
      await promise;
    } catch (error) {
      return error as Error;
    }
    throw new Error("오류가 나야 하는데 성공했다");
  }

  async function countWhere(table: string, where: string) {
    const rows = await db.query<{ n: number }>(
      `select count(*)::int as n from public.${table} where ${where}`);
    return rows.rows[0].n;
  }

  describe("만들기", () => {
    it("새 탭은 기본 열·새 아이템과 함께 고른 자리에 생기고 엉뚱한 자리는 거부한다", async () => {
      const b = await createBoard(ids.owner, ids.orgA, "영업", null, fresh());
      expect(b.nav_section).toBe("after-contract");
      const cols = await db.query<{ key: string }>(
        `select key from public.board_columns where board_id='${b.id}' order by sort_order`);
      expect(cols.rows.map((r) => r.key)).toEqual(["status", "owner", "due"]);
      const groups = await db.query<{ name: string }>(
        `select name from public.board_groups where board_id='${b.id}'`);
      expect(groups.rows).toEqual([{ name: "새 아이템" }]);

      const before = await createBoard(ids.owner, ids.orgA, "인수", null, fresh(), "before-contract");
      expect(before.nav_section).toBe("before-contract");

      await as(ids.owner);
      const err = await fails(db.query(
        `select id from public.create_workspace_board('${ids.orgA}','영업',null,null,null,'${fresh()}','sideways')`));
      expect(err.message).toMatch(/invalid_nav_section/);
    });

    it("같은 요청을 다시 보내면 같은 탭을 돌려준다. 기본 탭은 빈 껍데기로 생긴다", async () => {
      const requestId = fresh();
      const a = await createBoard(ids.owner, ids.orgA, "영업", null, requestId);
      const again = await createBoard(ids.owner, ids.orgA, "영업", null, requestId);
      expect(again.id).toBe(a.id);
      expect(await countWhere("boards", `org_id='${ids.orgA}'`)).toBe(1);

      const d = await createBoard(ids.owner, ids.orgA, "공지", "core.default-tab/notice", fresh());
      expect(d.nav_section).toBeNull();
      expect(await countWhere("board_columns", `board_id='${d.id}'`)).toBe(0);
      expect(await countWhere("board_groups", `board_id='${d.id}'`)).toBe(0);
    });

    it("구성원은 탭을 만들 수 없고 관리자는 만들 수 있다", async () => {
      await as(ids.member);
      const err = await fails(db.query(
        `select id from public.create_workspace_board('${ids.orgA}','영업',null,null,null,'${fresh()}')`));
      expect(err.message).toMatch(/permission_denied/);

      const b = await createBoard(ids.admin, ids.orgA, "영업", null, fresh());
      expect(b.id).toBeTruthy();
    });
  });

  describe("휴지통·복구", () => {
    it("휴지통에 넣으면 표시가 바뀌고 켜져 있던 규칙만 쉬게 한다. 두 번 넣어도 같다", async () => {
      const b = await createBoard(ids.owner, ids.orgA, "영업", "user.custom/sales", fresh());
      const mOn = fresh(); const mOff = fresh(); const aOn = fresh(); const aOff = fresh();
      await db.exec(`
        insert into public.messaging_trigger_rules(id, org_id, board_id, enabled) values
          ('${mOn}','${ids.orgA}','${b.id}',true), ('${mOff}','${ids.orgA}','${b.id}',false);
        insert into public.board_automation_rules(id, org_id, board_id, enabled) values
          ('${aOn}','${ids.orgA}','${b.id}',true), ('${aOff}','${ids.orgA}','${b.id}',false);`);

      const t1 = await trashBoard(ids.owner, ids.orgA, b.id);
      expect(t1.deleted_at).toBeTruthy();
      expect(t1.source).toBe(`trash/${b.id}/user.custom/sales`);
      expect(t1.trashed_source).toBe("user.custom/sales");
      expect(t1.trash_paused_rules).toEqual({ messaging: [mOn], automation: [aOn] });
      const enabled = await db.query<{ id: string }>(
        `select id from public.messaging_trigger_rules where board_id='${b.id}' and enabled
         union all
         select id from public.board_automation_rules where board_id='${b.id}' and enabled`);
      expect(enabled.rows).toEqual([]);

      const t2 = await trashBoard(ids.owner, ids.orgA, b.id);
      expect(t2.source).toBe(t1.source);
      expect(String(t2.deleted_at)).toBe(String(t1.deleted_at));

      await as(ids.admin);
      const adminErr = await fails(db.query(
        `select id from public.trash_workspace_board('${ids.orgA}','${b.id}')`));
      expect(adminErr.message).toMatch(/permission_denied/);
      await as(ids.member);
      const memberErr = await fails(db.query(
        `select id from public.trash_workspace_board('${ids.orgA}','${b.id}')`));
      expect(memberErr.message).toMatch(/permission_denied/);
    });

    it("지운 기본 탭은 기록에 남고 같은 자리로 다시 만들 수 없다", async () => {
      const b = await createBoard(ids.owner, ids.orgA, "공지", "core.default-tab/notice", fresh());
      await trashBoard(ids.owner, ids.orgA, b.id);
      const dismissed = await db.query<{ source: string }>(
        `select source from public.default_tab_dismissals where org_id='${ids.orgA}'`);
      expect(dismissed.rows).toEqual([{ source: "core.default-tab/notice" }]);

      await as(ids.owner);
      const err = await fails(db.query(
        `select id from public.create_workspace_board('${ids.orgA}','공지',null,null,` +
        `'core.default-tab/notice','${fresh()}')`));
      expect(err.message).toMatch(/default_tab_dismissed/);
    });

    it("복구하면 표시·규칙·기본 탭 기록이 돌아온다", async () => {
      const b = await createBoard(ids.owner, ids.orgA, "공지", "core.default-tab/notice", fresh());
      const mOn = fresh(); const mOff = fresh(); const aOn = fresh(); const aOff = fresh();
      await db.exec(`
        insert into public.messaging_trigger_rules(id, org_id, board_id, enabled) values
          ('${mOn}','${ids.orgA}','${b.id}',true), ('${mOff}','${ids.orgA}','${b.id}',false);
        insert into public.board_automation_rules(id, org_id, board_id, enabled) values
          ('${aOn}','${ids.orgA}','${b.id}',true), ('${aOff}','${ids.orgA}','${b.id}',false);`);
      await trashBoard(ids.owner, ids.orgA, b.id);

      await as(ids.owner);
      const rows = await db.query<{
        source: string | null; deleted_at: string | null;
        trashed_source: string | null; trash_paused_rules: unknown;
      }>(`select source, deleted_at, trashed_source, trash_paused_rules
           from public.restore_workspace_board('${ids.orgA}','${b.id}')`);
      const r = rows.rows[0];
      expect(r.source).toBe("core.default-tab/notice");
      expect(r.deleted_at).toBeNull();
      expect(r.trashed_source).toBeNull();
      expect(r.trash_paused_rules).toBeNull();
      const on = await db.query<{ id: string }>(
        `select id from public.messaging_trigger_rules where board_id='${b.id}' and enabled
         union all
         select id from public.board_automation_rules where board_id='${b.id}' and enabled
         order by id`);
      expect(on.rows.map((row) => row.id).sort()).toEqual([mOn, aOn].sort());
      expect(await countWhere("default_tab_dismissals", `org_id='${ids.orgA}'`)).toBe(0);
    });

    it("기록을 지우고 같은 기본 탭을 새로 만들면 휴지통 탭은 복구되지 않는다", async () => {
      const b = await createBoard(ids.owner, ids.orgA, "공지", "core.default-tab/notice", fresh());
      await trashBoard(ids.owner, ids.orgA, b.id);
      await as(ids.owner);
      await db.query(
        `select public.clear_default_tab_dismissal('${ids.orgA}','core.default-tab/notice')`);
      await createBoard(ids.owner, ids.orgA, "공지", "core.default-tab/notice", fresh());
      const err = await fails(db.query(
        `select id from public.restore_workspace_board('${ids.orgA}','${b.id}')`));
      expect(err.message).toMatch(/default_tab_already_installed/);
    });
  });

  describe("완전 삭제", () => {
    it("탭과 딸린 행을 지우고 파일 경로 두 개를 대기열에 남긴다", async () => {
      const b = await createBoard(ids.owner, ids.orgA, "영업", null, fresh());
      const f1 = `${ids.orgA}/purge-test/f1__a.pdf`; const f2 = `${ids.orgA}/purge-test/f2__b.pdf`;
      const g = fresh(); const i1 = fresh(); const i2 = fresh();
      await db.exec(`
        insert into public.board_groups(id, org_id, board_id, name, sort_order)
          values ('${g}','${ids.orgA}','${b.id}','묶음',0);
        insert into public.items(id, org_id, board_id, group_id, title)
          values ('${i1}','${ids.orgA}','${b.id}','${g}','첫 행');
        insert into public.items(id, org_id, board_id, group_id, title, archived_at, archived_by)
          values ('${i2}','${ids.orgA}','${b.id}','${g}','묶인 행', now(), '${ids.owner}');
        insert into public.item_values(org_id, item_id, column_key, value_jsonb)
          values ('${ids.orgA}','${i1}','status','"opt-doing"');
        insert into public.board_item_detail_events(org_id, board_id, item_id, kind)
          values ('${ids.orgA}','${b.id}','${i1}','memo');
        insert into public.board_item_detail_links(org_id, board_id, item_id)
          values ('${ids.orgA}','${b.id}','${i1}');
        insert into public.board_item_detail_files(org_id, board_id, item_id, storage_path)
          values ('${ids.orgA}','${b.id}','${i1}','${f1}');
        insert into public.board_item_detail_file_reservations(
          org_id, request_id, board_id, item_id, storage_path, state)
          values ('${ids.orgA}','${fresh()}','${b.id}','${i1}','${f2}','pending');
        insert into public.board_item_cloud_folder_requests(org_id, request_id, board_id, item_id)
          values ('${ids.orgA}','${fresh()}','${b.id}','${i1}');
        insert into public.company_work_start_requests(org_id, request_id, item_id)
          values ('${ids.orgA}','${fresh()}','${i1}');
        insert into public.company_intake_requests(org_id, request_id, item_id)
          values ('${ids.orgA}','${fresh()}','${i1}');
        insert into public.board_item_create_receipts(org_id, request_id, item_id)
          values ('${ids.orgA}','${fresh()}','${i1}');
        insert into public.notifications(org_id, target_type, target_id) values
          ('${ids.orgA}','board_item','${i1}'),
          ('${ids.orgA}','board_item','${i2}'),
          ('${ids.orgA}','board','${b.id}');
        insert into public.tab_views(org_id, board_id) values ('${ids.orgA}','${b.id}');
        insert into public.messaging_trigger_rules(org_id, board_id)
          values ('${ids.orgA}','${b.id}');
        insert into public.board_automation_rules(org_id, board_id)
          values ('${ids.orgA}','${b.id}');`);
      await trashBoard(ids.owner, ids.orgA, b.id);

      await as(ids.owner);
      const purged = await db.query<{ n: number }>(
        `select public.purge_workspace_board('${ids.orgA}','${b.id}') as n`);
      expect(purged.rows[0].n).toBe(2);
      const queued = await db.query<{ storage_path: string }>(
        `select storage_path from public.board_storage_purge_queue where org_id='${ids.orgA}'`);
      expect(queued.rows.map((r) => r.storage_path).sort()).toEqual([f1, f2].sort());
      for (const table of [
        "boards", "board_groups", "items", "item_values", "board_item_detail_events",
        "board_item_detail_links", "board_item_detail_files",
        "board_item_detail_file_reservations", "board_item_cloud_folder_requests",
        "company_work_start_requests", "company_intake_requests", "board_item_create_receipts",
        "notifications", "tab_views", "messaging_trigger_rules", "board_automation_rules",
      ]) {
        expect(await countWhere(table, `org_id='${ids.orgA}'`), table).toBe(0);
      }
    });

    it("옮겨 간 행의 메모는 지우지 않고 새 탭으로 넘긴다", async () => {
      const trashed = await createBoard(ids.owner, ids.orgA, "옛 탭", null, fresh());
      const live = await createBoard(ids.owner, ids.orgA, "새 탭", null, fresh());
      const item = fresh();
      await db.exec(`
        insert into public.items(id, org_id, board_id, title)
          values ('${item}','${ids.orgA}','${live.id}','살아 있는 행');
        insert into public.board_item_detail_events(org_id, board_id, item_id, kind)
          values ('${ids.orgA}','${trashed.id}','${item}','memo');`);
      await trashBoard(ids.owner, ids.orgA, trashed.id);

      await as(ids.owner);
      await db.query(`select public.purge_workspace_board('${ids.orgA}','${trashed.id}')`);
      const rows = await db.query<{ board_id: string }>(
        `select board_id from public.board_item_detail_events where item_id='${item}'`);
      expect(rows.rows.map((r) => r.board_id)).toEqual([live.id]);
    });

    it("완전 삭제가 아닌 길로는 휴지통 탭의 보관된 행을 지울 수 없다", async () => {
      const b = await createBoard(ids.owner, ids.orgA, "영업", null, fresh());
      const archived = fresh();
      await db.exec(`
        insert into public.items(id, org_id, board_id, title, archived_at)
          values ('${archived}','${ids.orgA}','${b.id}','보관된 행', now());`);
      await trashBoard(ids.owner, ids.orgA, b.id);
      const err = await fails(db.query(`delete from public.items where id='${archived}'`));
      expect(err.message).toMatch(/archived item must be restored/);
    });

    it("다른 탭으로 옮겨 간 하위 행은 부모 연결만 끊고 남긴다", async () => {
      const trashed = await createBoard(ids.owner, ids.orgA, "옛 탭", null, fresh());
      const live = await createBoard(ids.owner, ids.orgA, "새 탭", null, fresh());
      const parent = fresh(); const child = fresh();
      await db.exec(`
        insert into public.items(id, org_id, board_id, title)
          values ('${parent}','${ids.orgA}','${trashed.id}','부모 행');
        insert into public.items(id, org_id, board_id, title, parent_item_id, archived_at)
          values ('${child}','${ids.orgA}','${live.id}','옮겨 간 하위 행','${parent}', now());`);
      await trashBoard(ids.owner, ids.orgA, trashed.id);

      await as(ids.owner);
      await db.query(`select public.purge_workspace_board('${ids.orgA}','${trashed.id}')`);
      const rows = await db.query<{ board_id: string; parent_item_id: string | null }>(
        `select board_id, parent_item_id from public.items where id='${child}'`);
      expect(rows.rows).toEqual([{ board_id: live.id, parent_item_id: null }]);
    });

    it("옮겨 간 행의 파일은 정리 대상에 넣지 않고, 보관된 행의 메모도 정리를 막지 않는다", async () => {
      const trashed = await createBoard(ids.owner, ids.orgA, "옛 탭", null, fresh());
      const live = await createBoard(ids.owner, ids.orgA, "새 탭", null, fresh());
      const moved = fresh(); const gone = fresh();
      const keepPath = `${ids.orgA}/${trashed.id}/${moved}/keep__a.pdf`;
      const gonePath = `${ids.orgA}/${trashed.id}/${gone}/gone__b.pdf`;
      await db.exec(`
        insert into public.items(id, org_id, board_id, title)
          values ('${moved}','${ids.orgA}','${live.id}','옮겨 간 보관 행');
        insert into public.items(id, org_id, board_id, title)
          values ('${gone}','${ids.orgA}','${trashed.id}','지울 행');
        insert into public.board_item_detail_file_reservations(org_id, request_id, board_id, item_id, storage_path, state)
          values ('${ids.orgA}','${fresh()}','${trashed.id}','${moved}','${keepPath}','finalized');
        insert into public.board_item_detail_files(org_id, board_id, item_id, storage_path) values
          ('${ids.orgA}','${trashed.id}','${moved}','${keepPath}'),
          ('${ids.orgA}','${trashed.id}','${gone}','${gonePath}');
        insert into public.board_item_detail_events(org_id, board_id, item_id, kind)
          values ('${ids.orgA}','${trashed.id}','${moved}','memo');
        update public.items set archived_at = now() where id='${moved}';`);
      await trashBoard(ids.owner, ids.orgA, trashed.id);

      await as(ids.owner);
      const queued = await db.query<{ n: number }>(
        `select public.purge_workspace_board('${ids.orgA}','${trashed.id}') as n`);
      expect(queued.rows[0].n).toBe(1);
      const paths = await db.query<{ storage_path: string }>(
        `select storage_path from public.board_storage_purge_queue where org_id='${ids.orgA}'`);
      expect(paths.rows.map((r) => r.storage_path)).toEqual([gonePath]);
      const kept = await db.query<{ board_id: string }>(
        `select board_id from public.board_item_detail_files where storage_path='${keepPath}'`);
      expect(kept.rows).toEqual([{ board_id: live.id }]);
    });

    it("살아 있는 탭은 완전 삭제할 수 없고 구성원은 지울 수 없다", async () => {
      const b = await createBoard(ids.owner, ids.orgA, "영업", null, fresh());
      await as(ids.owner);
      const liveErr = await fails(db.query(
        `select public.purge_workspace_board('${ids.orgA}','${b.id}')`));
      expect(liveErr.message).toMatch(/board_not_in_trash/);

      const t = await createBoard(ids.owner, ids.orgA, "버릴 탭", null, fresh());
      await trashBoard(ids.owner, ids.orgA, t.id);
      await as(ids.member);
      const memberErr = await fails(db.query(
        `select public.purge_workspace_board('${ids.orgA}','${t.id}')`));
      expect(memberErr.message).toMatch(/permission_denied/);
    });

    it("살아 있는 탭의 보관된 행은 여전히 지울 수 없다", async () => {
      const b = await createBoard(ids.owner, ids.orgA, "영업", null, fresh());
      const item = fresh();
      await db.exec(`
        insert into public.items(id, org_id, board_id, title, archived_at, archived_by)
          values ('${item}','${ids.orgA}','${b.id}','묶인 행', now(), '${ids.owner}');`);
      const err = await fails(db.query(`delete from public.items where id='${item}'`));
      expect(err.message).toMatch(/archived item must be restored/);
    });

    it("7일 지난 휴지통만 비운다. 구성원은 부를 수 없다", async () => {
      const oldBoard = await createBoard(ids.owner, ids.orgA, "옛 탭", null, fresh());
      const newBoard = await createBoard(ids.owner, ids.orgA, "새 탭", null, fresh());
      await trashBoard(ids.owner, ids.orgA, oldBoard.id);
      await trashBoard(ids.owner, ids.orgA, newBoard.id);
      await db.exec(`
        update public.boards set deleted_at = now() - interval '8 days' where id='${oldBoard.id}';
        update public.boards set deleted_at = now() - interval '1 day' where id='${newBoard.id}';`);

      await as(ids.owner);
      const purged = await db.query<{ n: number }>(
        `select public.purge_expired_workspace_boards('${ids.orgA}') as n`);
      expect(purged.rows[0].n).toBe(1);
      expect(await countWhere("boards", `id='${oldBoard.id}'`)).toBe(0);
      expect(await countWhere("boards", `id='${newBoard.id}'`)).toBe(1);

      await as(ids.member);
      const err = await fails(db.query(
        `select public.purge_expired_workspace_boards('${ids.orgA}')`));
      expect(err.message).toMatch(/permission_denied/);
    });
  });

  describe("정리·개수·모양", () => {
    it("파일 정리는 지울 권한이 있는 사람만 보고 치운다", async () => {
      const b = await createBoard(ids.owner, ids.orgA, "영업", null, fresh());
      const f1 = `${ids.orgA}/purge-test/f1__a.pdf`; const f2 = `${ids.orgA}/purge-test/f2__b.pdf`;
      const item = fresh();
      await db.exec(`
        insert into public.items(id, org_id, board_id, title)
          values ('${item}','${ids.orgA}','${b.id}','첫 행');
        insert into public.board_item_detail_files(org_id, board_id, item_id, storage_path)
          values ('${ids.orgA}','${b.id}','${item}','${f1}');
        insert into public.board_item_detail_file_reservations(
          org_id, request_id, board_id, item_id, storage_path, state)
          values ('${ids.orgA}','${fresh()}','${b.id}','${item}','${f2}','pending');`);
      await trashBoard(ids.owner, ids.orgA, b.id);
      await as(ids.owner);
      await db.query(`select public.purge_workspace_board('${ids.orgA}','${b.id}')`);

      await as(ids.owner);
      const ownerSees = await db.query<{ ok: boolean }>(
        `select public.can_purge_board_storage_object('${f1}') as ok`);
      expect(ownerSees.rows[0].ok).toBe(true);
      await as(ids.admin);
      const adminSees = await db.query<{ ok: boolean }>(
        `select public.can_purge_board_storage_object('${f1}') as ok`);
      expect(adminSees.rows[0].ok).toBe(false);
      const listErr = await fails(db.query(
        `select public.list_board_storage_purge_queue('${ids.orgA}')`));
      expect(listErr.message).toMatch(/permission_denied/);

      await as(ids.owner);
      const listed = await db.query<{ path: string }>(
        `select public.list_board_storage_purge_queue('${ids.orgA}') as path`);
      expect(listed.rows.map((r) => r.path).sort()).toEqual([f1, f2].sort());
      const acked = await db.query<{ n: number }>(
        `select public.ack_board_storage_purge('${ids.orgA}', array['${f1}','${f2}']) as n`);
      expect(acked.rows[0].n).toBe(2);
      const after = await db.query(
        `select public.list_board_storage_purge_queue('${ids.orgA}') as path`);
      expect(after.rows).toEqual([]);
    });

    it("완전 삭제한 탭의 파일은 로그인 사용자 역할로 실제로 지워진다", async () => {
      const b = await createBoard(ids.owner, ids.orgA, "영업", null, fresh());
      const item = fresh();
      const f1 = `${ids.orgA}/${b.id}/${item}/f1__a.pdf`;
      const other = `${ids.orgA}/${fresh()}/${fresh()}/keep.pdf`;
      await db.exec(`
        insert into public.items(id, org_id, board_id, title)
          values ('${item}','${ids.orgA}','${b.id}','첫 행');
        insert into public.board_item_detail_files(org_id, board_id, item_id, storage_path)
          values ('${ids.orgA}','${b.id}','${item}','${f1}');
        insert into storage.objects(bucket_id, name)
          values ('board-item-files','${f1}'), ('board-item-files','${other}');
        grant select, delete on storage.objects to authenticated;`);
      await trashBoard(ids.owner, ids.orgA, b.id);
      await as(ids.owner);
      await db.query(`select public.purge_workspace_board('${ids.orgA}','${b.id}')`);

      // 저장소 API 와 같은 모양: DELETE … WHERE name IN (…) RETURNING. SELECT 정책도 통과해야 지워진다.
      const removeAs = async (uid: string) => {
        await as(uid);
        await db.exec("set role authenticated");
        try {
          const res = await db.query<{ name: string }>(
            `delete from storage.objects where bucket_id='board-item-files'
               and name in ('${f1}','${other}') returning name`);
          return res.rows.map((r) => r.name);
        } finally {
          await db.exec("reset role");
        }
      };
      expect(await removeAs(ids.admin)).toEqual([]);
      expect(await removeAs(ids.owner)).toEqual([f1]);
      const left = await db.query<{ name: string }>("select name from storage.objects order by name");
      expect(left.rows.map((r) => r.name)).toEqual([other]);
    });

    it("삭제 전에 보여 줄 개수가 맞는다", async () => {
      const b = await createBoard(ids.owner, ids.orgA, "영업", null, fresh());
      const g1 = fresh(); const g2 = fresh();
      const r1 = fresh(); const r2 = fresh(); const r3 = fresh();
      await db.exec(`
        insert into public.board_groups(id, org_id, board_id, name, sort_order) values
          ('${g1}','${ids.orgA}','${b.id}','묶음 1',0),
          ('${g2}','${ids.orgA}','${b.id}','묶음 2',1);
        insert into public.items(id, org_id, board_id, title) values
          ('${r1}','${ids.orgA}','${b.id}','첫 행'),
          ('${r2}','${ids.orgA}','${b.id}','둘째 행');
        insert into public.items(id, org_id, board_id, title, deleted_at) values
          ('${r3}','${ids.orgA}','${b.id}','지운 행', now());
        insert into public.board_item_detail_events(org_id, board_id, item_id, kind) values
          ('${ids.orgA}','${b.id}','${r1}','memo'),
          ('${ids.orgA}','${b.id}','${r1}','field_change');
        insert into public.board_item_detail_events(org_id, board_id, item_id, kind, deleted_at) values
          ('${ids.orgA}','${b.id}','${r2}','memo', now());
        insert into public.board_item_detail_files(org_id, board_id, item_id, storage_path) values
          ('${ids.orgA}','${b.id}','${r1}','purge-test/a.pdf'),
          ('${ids.orgA}','${b.id}','${r2}','purge-test/b.pdf');
        insert into public.tab_views(org_id, board_id) values ('${ids.orgA}','${b.id}');
        insert into public.board_automation_rules(org_id, board_id) values
          ('${ids.orgA}','${b.id}'), ('${ids.orgA}','${b.id}');
        insert into public.messaging_trigger_rules(org_id, board_id)
          values ('${ids.orgA}','${b.id}');`);

      await as(ids.owner);
      const rows = await db.query<{ out: Record<string, number> }>(
        `select public.read_board_trash_impact('${ids.orgA}','${b.id}') as out`);
      // 새 탭에 자동으로 생기는 「새 아이템」까지 아이템은 3개다.
      expect(rows.rows[0].out).toEqual({
        groups: 3, rows: 2, memos: 1, files: 2, views: 1, automations: 2, messaging: 1,
      });
    });

    it("기본 탭 기록 지우기는 권한과 자리를 가린다", async () => {
      await as(ids.member);
      const permErr = await fails(db.query(
        `select public.clear_default_tab_dismissal('${ids.orgA}','core.default-tab/notice')`));
      expect(permErr.message).toMatch(/permission_denied/);

      await as(ids.owner);
      const shapeErr = await fails(db.query(
        `select public.clear_default_tab_dismissal('${ids.orgA}','user.custom/sales')`));
      expect(shapeErr.message).toMatch(/invalid_default_tab/);
    });

    it("휴지통 탭이 있어도 남은 탭의 순서를 저장한다", async () => {
      const a = await createBoard(ids.owner, ids.orgA, "가", null, fresh());
      const b = await createBoard(ids.owner, ids.orgA, "나", null, fresh());
      const c = await createBoard(ids.owner, ids.orgA, "다", null, fresh());
      await trashBoard(ids.owner, ids.orgA, b.id);
      await as(ids.owner);
      const rows = await db.query<{ id: string }>(
        `select id from public.reorder_workspace_boards('${ids.orgA}', array['${c.id}','${a.id}']::uuid[], '${fresh()}')`);
      expect(rows.rows.map((r) => r.id)).toEqual([c.id, a.id]);
    });

    it("살아 있는 탭에 휴지통 표시를 직접 넣을 수 없다", async () => {
      const b = await createBoard(ids.owner, ids.orgA, "영업", null, fresh());
      const err = await fails(db.query(
        `update public.boards set source='trash/${b.id}/user.custom/sales' where id='${b.id}'`));
      expect(err.message).toMatch(/boards_trash_shape_check/);
    });

    it("다른 회사의 탭은 휴지통으로 보낼 수 없다", async () => {
      const b = await createBoard(ids.ownerB, ids.orgB, "베타", null, fresh());
      await as(ids.owner);
      const crossErr = await fails(db.query(
        `select id from public.trash_workspace_board('${ids.orgB}','${b.id}')`));
      expect(crossErr.message).toMatch(/permission_denied/);
      const wrongOrgErr = await fails(db.query(
        `select id from public.trash_workspace_board('${ids.orgA}','${b.id}')`));
      expect(wrongOrgErr.message).toMatch(/board_unavailable/);
    });
  });
});
