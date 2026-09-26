import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

/**
 * OCR-PROTECTED-CHAIN — actual 065+069+087+151+154 protected integration.
 *
 * Source (read-only, owned by other worker): ../v17-consultation-final fixture.
 * - 065 full, 069 full, 087 chain extract (DO rename + wrapper + ACL),
 *   151 body (from deals_org_id_id_uq, guard skipped), 152 board view.
 * - 154 local draft (supabase/migrations-draft/154) applied LAST as narrow
 *   wrapper around the preserved protected chain. No wholesale 151 copy,
 *   no direct 065 call, no second user workflow.
 *
 * Proves (reviewer: 065-only insufficient):
 * - incomplete checklist/seal -> blocked, 0 company write, no premature metadata.
 * - complete checklist + seal -> committed SAME company + blank-only enrich.
 * - revoke/other-row -> 42501 denial, no write.
 * - first new-company sameID retry -> same ID, no duplicate.
 * - mismatched intent (different deal/item/kind) -> 22023.
 * - unlinked stored biz_no is p_biz_no default only when explicit absent;
 *   explicit wins. DOB/business_item blank-only, name CAS untouched.
 */

const CONSULT = "../supabase/migrations";
const full065 = readFileSync(resolve(process.cwd(), `${CONSULT}/065_company_master_identity.sql`), "utf8");
const full069 = readFileSync(resolve(process.cwd(), `${CONSULT}/069_contact_pipeline_transitions.sql`), "utf8");
const full087 = readFileSync(resolve(process.cwd(), `${CONSULT}/087_new_lead_canonical.sql`), "utf8");
const full151 = readFileSync(resolve(process.cwd(), `${CONSULT}/151_consultation_protected_state.sql`), "utf8");
const body151 = full151.slice(full151.indexOf("create unique index if not exists deals_org_id_id_uq"));
const full152 = readFileSync(resolve(process.cwd(), `${CONSULT}/152_consultation_board_view.sql`), "utf8");
const body152 = full152.slice(full152.indexOf("create or replace function public.read_consultation_board_view"));
const full154 = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/154_document_ocr_metadata.sql"),
  "utf8",
);

// Deployment provenance/guard is tested by the repository migration gate.
const draft154 = full154.slice(full154.indexOf("alter table public.deal_intake"));

const doStart = full087.indexOf("if to_regprocedure('public.execute_contact_pipeline_transition(uuid");
const doBlockStart = full087.lastIndexOf("do $$", doStart);
const doBlockEnd = full087.indexOf("end $$;", doStart) + "end $$;".length;
const wrapperStart = full087.indexOf(
  "create or replace function public.execute_contact_pipeline_transition(",
  doBlockEnd,
);
const wrapperEnd = full087.indexOf("end $$;", wrapperStart) + "end $$;".length;
const body087chain =
  full087.slice(doBlockStart, doBlockEnd) + "\n" + full087.slice(wrapperStart, wrapperEnd);
const acl087chain = full087
  .split("\n")
  .filter(
    (line) =>
      line.includes("execute_contact_pipeline_transition(") &&
      (line.startsWith("revoke") || line.startsWith("grant")),
  )
  .join("\n");

const ids = {
  org: "00000000-0000-4000-8000-000000000001",
  owner: "00000000-0000-4000-8000-000000000010",
  assignee: "00000000-0000-4000-8000-000000000011",
  stranger: "00000000-0000-4000-8000-000000000013",
  pipeline: "00000000-0000-4000-8000-000000000020",
  meeting: "00000000-0000-4000-8000-000000000021",
  work: "00000000-0000-4000-8000-000000000022",
  board: "00000000-0000-4000-8000-000000000030",
  item: "00000000-0000-4000-8000-000000000031",
  deal: "00000000-0000-4000-8000-000000000040",
  item2: "00000000-0000-4000-8000-000000000032",
  deal2: "00000000-0000-4000-8000-000000000041",
  dept: "00000000-0000-4000-8000-000000000060",
};

// Synthetic valid biz numbers (checksum pass, not real).
const INTAKE_BIZ = "1234567891";
const OTHER_BIZ = "2222222227";

let db: PGlite;
async function setup(): Promise<PGlite> {
  // Share the WASM engine, never test data. Reapply all actual migrations after
  // replacing schemas; keep independent statement transactions/error recovery.
  await db.exec(`
    reset role; reset all;
    drop schema if exists public cascade;
    drop schema if exists auth cascade;
    create schema public;
      grant usage on schema public to public;
  `);
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable
      as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
    create table public.orgs(id uuid primary key, status text not null default 'active');
    create table public.users(id uuid primary key);
    create table public.org_members(org_id uuid references public.orgs, user_id uuid references public.users,
      role text not null default 'member', scope text not null default 'assigned',
      status text not null default 'active', primary key(org_id, user_id));
    create function public.is_org_member(p_org uuid) returns boolean language sql stable security definer
      set search_path = public as $$select exists (select 1 from org_members m where m.org_id = p_org and m.user_id = auth.uid())$$;
    create function public.org_role(p_org uuid) returns text language sql stable security definer
      set search_path = public as $$select role from org_members where org_id = p_org and user_id = auth.uid()$$;
    create function public.org_scope(p_org uuid) returns text language sql stable security definer
      set search_path = public as $$select scope from org_members where org_id = p_org and user_id = auth.uid()$$;
    create table public.departments(id uuid primary key, org_id uuid, parent_id uuid, archived_at timestamptz);
    create table public.department_members(org_id uuid, dept_id uuid, user_id uuid, is_primary boolean not null default false, primary key(org_id, dept_id, user_id));
    create table public.test_permission_deny(org_id uuid, user_id uuid, perm text, primary key(org_id, user_id, perm));
    create function public.effective_permission(p_org_id uuid, p_scope_key text) returns boolean
      language sql stable security definer set search_path = public as
      $$select exists (select 1 from org_members m where m.org_id = p_org_id and m.user_id = auth.uid() and m.status = 'active')
        and not exists (select 1 from test_permission_deny d where d.org_id = p_org_id and d.user_id = auth.uid() and d.perm = p_scope_key)$$;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    grant execute on function public.is_org_member(uuid) to anon, authenticated, service_role;
    grant execute on function public.org_role(uuid) to anon, authenticated, service_role;
    grant execute on function public.org_scope(uuid) to anon, authenticated, service_role;
    grant execute on function public.effective_permission(uuid, text) to anon, authenticated, service_role;
    create table public.pipelines(id uuid primary key, org_id uuid);
    create table public.stages(id uuid primary key, pipeline_id uuid, kind text);
    create table public.companies(id uuid primary key default gen_random_uuid(), org_id uuid,
      name text, biz_no text, business_type text, industry text, biz_type text,
      region_sido text, region_sigungu text, region text, owner_name text, phone text,
      founded_on date, revenue numeric, assigned_to uuid, created_from text not null default 'manual',
      merged_into uuid, created_at timestamptz not null default now());
    create table public.deals(id uuid primary key, org_id uuid references public.orgs,
      company_id uuid, pipeline_id uuid, stage_id uuid, assigned_to uuid,
      title text, custom jsonb not null default '{}', updated_at timestamptz default now());
    create table public.activities(id uuid primary key default gen_random_uuid(), org_id uuid, deal_id uuid, type text, content text, actor uuid);
    create table public.boards(id uuid primary key, org_id uuid, source text);
    create table public.items(id uuid primary key, org_id uuid, board_id uuid, title text,
      assigned_to uuid, deal_id uuid, deleted_at timestamptz, archived_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
    create table public.item_values(org_id uuid, item_id uuid, column_key text, value_jsonb jsonb, primary key(item_id, column_key));
    create table public.deal_intake(deal_id uuid primary key, org_id uuid, representative_name text, industry text, updated_at timestamptz default now());
    create table public.new_lead_requests(org_id uuid, request_id uuid, operation text, deal_id uuid, item_id uuid, actor_id uuid, payload jsonb, primary key(org_id, request_id));
    create table public.deal_intake_field_audit(id uuid primary key default gen_random_uuid(), org_id uuid, deal_id uuid, field_key text, old_value jsonb, new_value jsonb, value_source text, actor_id uuid, request_id uuid, unique(org_id, request_id, field_key));
  `);
  await db.exec(`
    grant select, insert, update, delete on public.orgs, public.users, public.org_members,
      public.pipelines, public.stages, public.companies, public.deals, public.activities,
      public.boards, public.items, public.item_values, public.departments,
      public.department_members, public.test_permission_deny,
      public.deal_intake, public.new_lead_requests, public.deal_intake_field_audit
      to anon, authenticated, service_role;
  `);
  await db.exec(full065);
  await db.exec(full069);
  await db.exec(body087chain);
  await db.exec(acl087chain);
  await db.exec(body151);
  await db.exec(body152);
  await db.exec(draft154);
  await db.exec(`
    insert into orgs values ('${ids.org}');
    insert into users values ('${ids.owner}'), ('${ids.assignee}'), ('${ids.stranger}');
    insert into org_members values
      ('${ids.org}','${ids.owner}','owner','all','active'),
      ('${ids.org}','${ids.assignee}','member','assigned','active'),
      ('${ids.org}','${ids.stranger}','member','assigned','active');
    insert into pipelines values ('${ids.pipeline}','${ids.org}');
    insert into stages values
      ('${ids.meeting}','${ids.pipeline}','meeting'),
      ('${ids.work}','${ids.pipeline}','work');
    insert into boards values ('${ids.board}','${ids.org}','core.default-tab/contact');
    insert into deals (id, org_id, company_id, pipeline_id, stage_id, assigned_to, title, custom) values
      ('${ids.deal}','${ids.org}',null,'${ids.pipeline}','${ids.meeting}','${ids.assignee}','테스트 회사','{}'),
      ('${ids.deal2}','${ids.org}',null,'${ids.pipeline}','${ids.meeting}','${ids.assignee}','두번째 회사','{}');
    insert into items (id, org_id, board_id, title, assigned_to, deal_id, deleted_at) values
      ('${ids.item}','${ids.org}','${ids.board}','테스트 회사','${ids.assignee}','${ids.deal}',null),
      ('${ids.item2}','${ids.org}','${ids.board}','두번째 회사','${ids.assignee}','${ids.deal2}',null);
    insert into item_values values
      ('${ids.org}','${ids.item}','work_move','"업무관리 이동"'),
      ('${ids.org}','${ids.item2}','work_move','"업무관리 이동"'),
      ('${ids.org}','${ids.item}','seal_status','"완료"'),
      ('${ids.org}','${ids.item2}','seal_status','"완료"');
    insert into deal_intake (deal_id, org_id) values
      ('${ids.deal}','${ids.org}'), ('${ids.deal2}','${ids.org}');
  `);
  return db;
}

async function asUser(db: PGlite, userId: string) {
  await db.exec(`select set_config('app.uid','${userId}',false)`);
}

const reqCache = new Map<string, string>();
let reqCounter = 0;
const req = (tag: string) => {
  const hit = reqCache.get(tag);
  if (hit) return hit;
  reqCounter += 1;
  const id = `00000000-0000-4000-8000-${reqCounter.toString(16).padStart(12, "0")}`;
  reqCache.set(tag, id);
  return id;
};
const STEPS = ["contract_sent", "signed_copy_sent", "counterparty_signature_confirmed", "deposit_confirmed"];

async function check(db: PGlite, itemId: string, suffix: string, step: string, confirmed: boolean, expectedVersion: number) {
  return db.query<{ version: number }>(
    `select version from execute_consultation_transition('${ids.org}','${itemId}','${req(suffix)}','check','${step}',${confirmed},null,null,null,${expectedVersion})`,
  );
}

async function completeChecks(db: PGlite, itemId: string, tag: string): Promise<number> {
  let version = 0;
  for (let i = 0; i < STEPS.length; i += 1) {
    const r = await check(db, itemId, `${tag}${i}`, STEPS[i]!, true, version);
    version = Number(r.rows[0]!.version);
  }
  return version;
}

async function handoff(
  db: PGlite,
  itemId: string,
  dealId: string,
  suffix: string,
  opts: { companyName?: string | null; bizNo?: string | null; companyId?: string | null } = {},
) {
  const nameArg = opts.companyName === undefined ? "'테스트 회사'" : opts.companyName === null ? "null" : `'${opts.companyName}'`;
  const bizArg = opts.bizNo === undefined || opts.bizNo === null ? "null" : `'${opts.bizNo}'`;
  const companyArg = opts.companyId === undefined || opts.companyId === null ? "null" : `'${opts.companyId}'`;
  return db.query<{ status: string; deal_id: string | null; company_id: string | null; reason: string | null }>(
    `select status, deal_id, company_id, reason from execute_contact_pipeline_transition('${ids.org}','${dealId}','${itemId}','${req(suffix)}','contact_to_work',${companyArg},${nameArg},${bizArg},null,null,null,null,null,null,null,null)`,
  );
}

describe.sequential("OCR-PROTECTED-CHAIN (actual 065+069+087+151+154)", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec("create role anon; create role authenticated; create role service_role;");
  });
  afterAll(async () => { await db?.close(); });
  afterEach(async () => {
    reqCache.clear();
    reqCounter = 0;
  });

  it("chain preserves 151/087/069 wrappers (no wholesale copy, no direct 065)", async () => {
    const db = await setup();
    const def = await db.query<{ proname: string }>(
      `select proname from pg_proc where proname in ('execute_contact_pipeline_transition','execute_contact_pipeline_transition_pre_ocr_154','execute_contact_pipeline_transition_069','execute_contact_pipeline_transition_legacy_069','handoff_company_to_work') and pronamespace='public'::regnamespace order by 1`,
    );
    const names = def.rows.map((r) => r.proname).sort();
    expect(names).toContain("execute_contact_pipeline_transition");
    expect(names).toContain("execute_contact_pipeline_transition_pre_ocr_154");
    expect(names).toContain("handoff_company_to_work");
    // old bypass RPC must not exist as publicly callable route
    const bypass = await db.query<{ n: number }>(
      `select count(*)::int n from pg_proc where proname='ocr_handoff_precompany_to_work' and pronamespace='public'::regnamespace`,
    );
    expect(bypass.rows[0]!.n).toBe(0);
    // 154 draft must not call 065 directly
    expect(draft154).not.toMatch(/public\.handoff_company_to_work\s*\(/);
  });

  it("incomplete checklist/seal -> blocked, 0 company write, no premature metadata", async () => {
    const db = await setup();
    await asUser(db, ids.assignee);
    await db.exec(
      `update deal_intake set business_item='부품제조', birthdate='1985-05-05', biz_no='${INTAKE_BIZ}' where deal_id='${ids.deal}'`,
    );
    const blocked = await handoff(db, ids.item, ids.deal, "blk01");
    expect(blocked.rows[0]!.status).toBe("blocked");
    const companies = await db.query<{ n: number }>(
      `select count(*)::int n from companies where org_id='${ids.org}'`,
    );
    expect(companies.rows[0]!.n).toBe(0);
    const audits = await db.query<{ n: number }>(
      `select count(*)::int n from deal_intake_field_audit where org_id='${ids.org}' and request_id='${req("blk01")}'`,
    );
    expect(audits.rows[0]!.n).toBe(0);
    const stage = await db.query<{ kind: string }>(
      `select s.kind from deals d join stages s on s.id=d.stage_id where d.id='${ids.deal}'`,
    );
    expect(stage.rows[0]!.kind).toBe("meeting");
  });

  it("complete checklist+seal commits SAME company and enriches blank-only", async () => {
    const db = await setup();
    await asUser(db, ids.assignee);
    await completeChecks(db, ids.item, "full01");
    await db.exec(`update deals set custom='{\"seal_approval\":\"완료\"}' where id='${ids.deal}'`);
    await db.exec(
      `update deal_intake set business_item='부품제조', birthdate='1985-05-05', biz_no='${INTAKE_BIZ}' where deal_id='${ids.deal}'`,
    );
    const done = await handoff(db, ids.item, ids.deal, "full0100");
    expect(done.rows[0]!.status).toBe("committed");
    expect(done.rows[0]!.deal_id).toBe(ids.deal);
    const companyId = done.rows[0]!.company_id!;
    expect(companyId).not.toBeNull();
    const company = await db.query<{ business_item: string; owner_birthdate: string; biz_no: string }>(
      `select business_item, owner_birthdate::text owner_birthdate, biz_no from companies where id='${companyId}'`,
    );
    expect(company.rows[0]!.business_item).toBe("부품제조");
    expect(company.rows[0]!.owner_birthdate).toBe("1985-05-05");
    // intake biz_no default fed protected handoff (explicit absent) -> company carries it
    expect(company.rows[0]!.biz_no).toBe(INTAKE_BIZ);
    const deal = await db.query<{ company_id: string; kind: string }>(
      `select d.company_id::text company_id, s.kind from deals d join stages s on s.id=d.stage_id where d.id='${ids.deal}'`,
    );
    expect(deal.rows[0]!.company_id).toBe(companyId);
    expect(deal.rows[0]!.kind).toBe("work");
    // blank-only: pre-filled company value is not overwritten
    await db.exec(`update companies set business_item='기존종목' where id='${companyId}'`);
    await db.exec(`update deal_intake set business_item='새종목' where deal_id='${ids.deal}'`);
    // second deal reuses same company via explicit company_id, intake change must not overwrite
    await completeChecks(db, ids.item2, "full02");
    await db.exec(`update deals set custom='{\"seal_approval\":\"완료\"}' where id='${ids.deal2}'`);
    await db.exec(`update deal_intake set business_item='새종목', birthdate='1990-01-01' where deal_id='${ids.deal2}'`);
    const second = await handoff(db, ids.item2, ids.deal2, "full0200", { companyId });
    expect(second.rows[0]!.status).toBe("committed");
    expect(second.rows[0]!.company_id).toBe(companyId);
    const kept = await db.query<{ business_item: string }>(
      `select business_item from companies where id='${companyId}'`,
    );
    expect(kept.rows[0]!.business_item).toBe("기존종목");
  });

  it("explicit p_biz_no wins over stored intake default (no silent swap)", async () => {
    const db = await setup();
    await asUser(db, ids.assignee);
    await completeChecks(db, ids.item, "biz01");
    await db.exec(`update deals set custom='{\"seal_approval\":\"완료\"}' where id='${ids.deal}'`);
    await db.exec(`update deal_intake set biz_no='${INTAKE_BIZ}' where deal_id='${ids.deal}'`);
    // explicit different valid biz_no -> new company with explicit, not intake default
    const done = await handoff(db, ids.item, ids.deal, "biz0100", { bizNo: OTHER_BIZ });
    expect(done.rows[0]!.status).toBe("committed");
    const company = await db.query<{ biz_no: string }>(
      `select biz_no from companies where id='${done.rows[0]!.company_id}'`,
    );
    expect(company.rows[0]!.biz_no).toBe(OTHER_BIZ);
  });

  it("revoke/other-row -> 42501 denial, no write", async () => {
    const db = await setup();
    await asUser(db, ids.assignee);
    await completeChecks(db, ids.item, "deny01");
    await db.exec(`update deals set custom='{\"seal_approval\":\"완료\"}' where id='${ids.deal}'`);
    const done = await handoff(db, ids.item, ids.deal, "deny0100");
    expect(done.rows[0]!.status).toBe("committed");
    // revoke after commit: replay same request must 42501, no new row
    await db.exec(`insert into test_permission_deny values ('${ids.org}','${ids.assignee}','work.item_upsert')`);
    await expect(handoff(db, ids.item, ids.deal, "deny0100")).rejects.toThrow(/unavailable|permission denied|denied/);
    // stranger with no row scope on same deal -> 42501
    await asUser(db, ids.stranger);
    await expect(handoff(db, ids.item, ids.deal, "deny0101")).rejects.toThrow(/unavailable|permission denied|denied/);
    const receipts = await db.query<{ n: number }>(
      `select count(*)::int n from contact_pipeline_transitions where org_id='${ids.org}' and request_id='${req("deny0100")}'`,
    );
    expect(receipts.rows[0]!.n).toBe(1);
  });

  it("first new-company sameID retry returns same ID, no duplicate", async () => {
    const db = await setup();
    await asUser(db, ids.assignee);
    await completeChecks(db, ids.item, "retry01");
    await db.exec(`update deals set custom='{\"seal_approval\":\"완료\"}' where id='${ids.deal}'`);
    await db.exec(`update deal_intake set business_item='부품제조', birthdate='1985-05-05' where deal_id='${ids.deal}'`);
    const first = await handoff(db, ids.item, ids.deal, "retry0100");
    expect(first.rows[0]!.status).toBe("committed");
    const replay = await handoff(db, ids.item, ids.deal, "retry0100");
    expect(replay.rows[0]).toMatchObject({
      status: "committed",
      deal_id: ids.deal,
      company_id: first.rows[0]!.company_id,
    });
    const companies = await db.query<{ n: number }>(
      `select count(*)::int n from companies where org_id='${ids.org}'`,
    );
    expect(companies.rows[0]!.n).toBe(1);
  });

  it("mismatched intent on sameID -> 22023 (deal/item/kind)", async () => {
    const db = await setup();
    await asUser(db, ids.assignee);
    await completeChecks(db, ids.item, "mis01");
    await completeChecks(db, ids.item2, "mis02");
    await db.exec(`update deals set custom='{\"seal_approval\":\"완료\"}' where id in ('${ids.deal}','${ids.deal2}')`);
    await handoff(db, ids.item, ids.deal, "mis0100");
    await expect(handoff(db, ids.item2, ids.deal, "mis0100")).rejects.toThrow(/target mismatch|canonical association/);
    await expect(handoff(db, ids.item, ids.deal2, "mis0100")).rejects.toThrow(/target mismatch|canonical association/);
    await expect(
      db.query(
        `select * from execute_contact_pipeline_transition('${ids.org}','${ids.deal}','${ids.item}','${req("mis0100")}','lead_to_contact',null,null,null,null,null,null,null,null,null,null,null)`,
      ),
    ).rejects.toThrow(/target mismatch/);
    const receipts = await db.query<{ n: number }>(
      `select count(*)::int n from contact_pipeline_transitions where org_id='${ids.org}' and request_id='${req("mis0100")}'`,
    );
    expect(receipts.rows[0]!.n).toBe(1);
  });
  it("completed checklist without seal remains blocked without OCR writes", async () => {
    const db = await setup();
    await asUser(db, ids.assignee);
    await completeChecks(db, ids.item, "noseal");
    await db.exec(`update deal_intake set business_item='합성종목',birthdate='1990-01-01' where deal_id='${ids.deal}'`);
    expect((await handoff(db, ids.item, ids.deal, "nosealhandoff")).rows[0]!.status).toBe("blocked");
    expect((await db.query<{ n: number }>("select count(*)::int n from companies")).rows[0]!.n).toBe(0);
    expect((await db.query<{ n: number }>("select count(*)::int n from deal_intake_field_audit")).rows[0]!.n).toBe(0);
  });

  it("committed replay never applies later OCR edits under the old receipt", async () => {
    const db = await setup();
    await asUser(db, ids.assignee);
    await completeChecks(db, ids.item, "late");
    await db.exec(`update deals set custom='{"seal_approval":"완료"}' where id='${ids.deal}'`);
    const first = await handoff(db, ids.item, ids.deal, "latereplay");
    const companyId = first.rows[0]!.company_id!;
    await db.exec(`update deal_intake set business_item='나중입력',birthdate='1990-01-01',biz_no='${INTAKE_BIZ}' where deal_id='${ids.deal}'`);
    const replay = await handoff(db, ids.item, ids.deal, "latereplay", { companyId });
    expect(replay.rows[0]!.company_id).toBe(companyId);
    expect((await db.query("select business_item,owner_birthdate from companies")).rows[0]).toEqual({ business_item: null, owner_birthdate: null });
    expect((await db.query<{ n: number }>("select count(*)::int n from deal_intake_field_audit")).rows[0]!.n).toBe(0);
    // Simulate a legacy pre-154 receipt: replay still must not gain new effects.
    await db.exec(`delete from new_lead_requests where request_id='${req("latereplay")}'`);
    await handoff(db, ids.item, ids.deal, "latereplay", { companyId });
    expect((await db.query("select business_item,owner_birthdate from companies")).rows[0]).toEqual({ business_item: null, owner_birthdate: null });
  });

  it("same ID with changed identity input or another operation is rejected atomically", async () => {
    const db = await setup();
    await asUser(db, ids.assignee);
    await completeChecks(db, ids.item, "intent");
    await db.exec(`update deals set custom='{"seal_approval":"완료"}' where id='${ids.deal}'`);
    await handoff(db, ids.item, ids.deal, "intent1");
    await asUser(db, ids.owner);
    await expect(handoff(db, ids.item, ids.deal, "intent1")).rejects.toThrow(/intent mismatch/);
    await asUser(db, ids.assignee);
    await expect(handoff(db, ids.item, ids.deal, "intent1", { companyName: "다른상호" })).rejects.toThrow(/intent mismatch/);
    await expect(handoff(db, ids.item, ids.deal, "intent1", { bizNo: OTHER_BIZ })).rejects.toThrow(/intent mismatch/);
    await completeChecks(db, ids.item2, "intent2");
    await db.exec(`update deals set custom='{"seal_approval":"완료"}' where id='${ids.deal2}'`);
    await db.exec(`insert into new_lead_requests(org_id,request_id,operation,deal_id,item_id,actor_id,payload)
      values('${ids.org}','${req("otheroperation")}','update','${ids.deal2}','${ids.item2}','${ids.assignee}','{"ocr_patch":{}}')`);
    await expect(handoff(db, ids.item2, ids.deal2, "otheroperation")).rejects.toThrow(/intent mismatch/);
    expect((await db.query<{ n: number }>("select count(*)::int n from companies")).rows[0]!.n).toBe(1);
    expect((await db.query(`select company_id from deals where id='${ids.deal2}'`)).rows[0]).toEqual({ company_id: null });
    expect((await db.query<{ n: number }>(`select count(*)::int n from contact_pipeline_transitions where request_id='${req("otheroperation")}'`)).rows[0]!.n).toBe(0);
  });


describe("161 preserves the real OCR protected chain", () => {
  it("explicit approval and handoff retain OCR metadata, stable IDs and all receipts without intent prewrite", async () => {
    const db=await setup();
    const workflow=readFileSync(resolve(process.cwd(),`${CONSULT}/156_consultation_workflow.sql`),"utf8");
    await db.exec(workflow.slice(workflow.indexOf("alter table public.consultation_states add column phase")));
    const seal=readFileSync(resolve(process.cwd(),`${CONSULT}/161_consultation_seal_handoff.sql`),"utf8");
    await db.exec(seal.slice(seal.indexOf("alter table public.consultation_requests drop constraint")));
    await asUser(db,ids.owner);
    const version=await completeChecks(db,ids.item,"161-ocr");
    await db.exec(`delete from item_values where item_id='${ids.item}'; update deal_intake set biz_no='${INTAKE_BIZ}',birthdate='1990-01-01',business_item='합성 OCR 종목' where deal_id='${ids.deal}'`);
    const submit=(op:string,v:number,tag:string)=>db.query<{company_id:string;deal_id:string;replayed:boolean}>(
      "select * from execute_consultation_seal_handoff($1,$2,$3,$4,$5,$6)",[ids.org,ids.item,req(tag),v,op,"테스트 회사"]);
    await submit("seal_approval",version,"161-ocr-seal");
    const result=(await submit("handoff",version+1,"161-ocr-go")).rows[0];
    expect(result.deal_id).toBe(ids.deal);
    expect((await db.query("select id,biz_no,owner_birthdate::text,business_item from companies")).rows[0]).toEqual({id:result.company_id,biz_no:INTAKE_BIZ,owner_birthdate:"1990-01-01",business_item:"합성 OCR 종목"});
    expect((await db.query(`select deal_id from items where id='${ids.item}'`)).rows[0]).toEqual({deal_id:ids.deal});
    expect((await db.query(`select company_id,stage_id from deals where id='${ids.deal}'`)).rows[0]).toEqual({company_id:result.company_id,stage_id:ids.work});
    expect((await submit("handoff",version+1,"161-ocr-go")).rows[0]).toMatchObject({company_id:result.company_id,replayed:true});
    for(const table of ["contact_pipeline_transitions","new_lead_requests","consultation_requests"]){
      expect((await db.query<{n:number}>(`select count(*)::int n from ${table} where request_id='${req("161-ocr-go")}'`)).rows[0].n).toBe(1);
    }
    expect((await db.query<{n:number}>("select count(*)::int n from companies")).rows[0].n).toBe(1);
  });
});

describe("162 actual work projection + 139 writer + 153 archive boundary", () => {
  const workBoard = "00000000-0000-4000-8000-000000000080";
  const workGroup = "00000000-0000-4000-8000-000000000081";
  const sql = (file: string) => readFileSync(resolve(process.cwd(), `${CONSULT}/${file}`), "utf8");
  const upgrade = () => {
    const full = sql("162_work_handoff_projection.sql");
    return db.exec(full.slice(full.indexOf("create function public.project_committed_work_item")));
  };
  async function projectSetup(patched = true) {
    await setup();
    await db.exec(`
      do $$begin if not exists(select 1 from pg_roles where rolname='moawork_row_order_writer') then
        create role moawork_row_order_writer nologin bypassrls; end if; end$$;
      alter table boards add column row_order_version bigint default 0, add column updated_at timestamptz default now();
      alter table items alter column id set default gen_random_uuid();
      alter table items add column group_id uuid,add column sort_order integer default 0,
        add column parent_item_id uuid,add column archived_by uuid;
      create table board_groups(id uuid primary key,org_id uuid,board_id uuid,name text,sort_order int default 0);
      create unique index items_active_deal_projection_uq on items(org_id,deal_id) where deal_id is not null and deleted_at is null;
      insert into boards(id,org_id,source) values('${workBoard}','${ids.org}','core.default-tab/contract-work');
      insert into board_groups(id,org_id,board_id,name) values('${workGroup}','${ids.org}','${workBoard}','진행');
      grant usage on schema public to moawork_row_order_writer;
      grant select on boards,board_groups,items to moawork_row_order_writer;
      grant update(board_id,group_id,sort_order,updated_at) on items to moawork_row_order_writer;
      grant update(row_order_version,updated_at) on boards to moawork_row_order_writer;
    `);
    const rowMove=sql("139_issue602_atomic_board_row_move.sql");
    for (const [start,end] of [
      ["create or replace function public.guard_board_row_order_version_direct_write()","-- Row position is an RPC-owned invariant"],
      ["create or replace function public.guard_board_row_position_direct_write()","create table public.board_row_move_requests"],
    ]) await db.exec(rowMove.slice(rowMove.indexOf(start),rowMove.indexOf(end)));
    const archive=sql("153_item_operations_draft.sql");
    await db.exec(archive.slice(archive.indexOf("create or replace function public.guard_archived_item_write()"),archive.indexOf("-- 139 keeps row positions writer-owned")));
    const moveStart=archive.indexOf("create or replace function public.issue602_move_board_item_private(");
    await db.exec(archive.slice(moveStart,archive.indexOf("$$;",moveStart)+3));
    await db.exec(`alter function public.issue602_move_board_item_private(uuid,uuid,uuid,uuid,uuid,uuid,uuid,integer) owner to moawork_row_order_writer;
      revoke all on function public.issue602_move_board_item_private(uuid,uuid,uuid,uuid,uuid,uuid,uuid,integer) from public,anon,authenticated,service_role;
      grant execute on function public.issue602_move_board_item_private(uuid,uuid,uuid,uuid,uuid,uuid,uuid,integer) to postgres;`);
    const projection=sql("100_bbe235_work_board_projection.sql");
    await db.exec(projection.slice(projection.indexOf("create or replace function public.bbe235_project_work_board()")));
    const workflow=sql("156_consultation_workflow.sql");
    await db.exec(workflow.slice(workflow.indexOf("alter table public.consultation_states add column phase")));
    const seal=sql("161_consultation_seal_handoff.sql");
    await db.exec(seal.slice(seal.indexOf("alter table public.consultation_requests drop constraint")));
    if(patched) await upgrade();
    await asUser(db,ids.owner);
  }
  const submit=(op:string,v:number,tag:string)=>db.query<{company_id:string;replayed:boolean}>(
    "select * from execute_consultation_seal_handoff($1,$2,$3,$4,$5,$6)",[ids.org,ids.item,req(tag),v,op,"테스트 회사"]);
  async function ready() {
    const version=await completeChecks(db,ids.item,"projection");
    await submit("seal_approval",version,"seal");
    return version+1;
  }
  const projected = async () => (await db.query<{id:string;deal_id:string;board_id:string;group_id:string|null}>(`select id,deal_id,board_id,group_id from items where deal_id='${ids.deal}' and deleted_at is null`)).rows;

  it("negative control: real 100 accepts handoff but leaves canonical item on contact", async()=>{
    await projectSetup(false);
    await submit("handoff",await ready(),"go");
    expect(await projected()).toEqual([{id:ids.item,deal_id:ids.deal,board_id:ids.board,group_id:null}]);
  });

  it("moves the SAME item/deal; preserves OCR, owner, appointment, checklist, history and replay",async()=>{
    await projectSetup();
    await db.exec(`update deal_intake set biz_no='${INTAKE_BIZ}',birthdate='1990-01-01',business_item='합성 종목' where deal_id='${ids.deal}'`);
    const version=await ready();
    await db.exec(`update consultation_states set meeting_at='2026-09-28 02:00:00+00' where item_id='${ids.item}'`);
    const state=(await db.query(`select * from consultation_states where item_id='${ids.item}'`)).rows[0];
    const values=(await db.query(`select column_key,value_jsonb from item_values where item_id='${ids.item}' order by column_key`)).rows;
    const events=(await db.query(`select * from consultation_events where item_id='${ids.item}' order by id`)).rows;
    const result=(await submit("handoff",version,"go")).rows[0];
    expect(await projected()).toEqual([{id:ids.item,deal_id:ids.deal,board_id:workBoard,group_id:workGroup}]);
    expect((await db.query(`select * from consultation_states where item_id='${ids.item}'`)).rows[0]).toEqual(state);
    expect((await db.query(`select column_key,value_jsonb from item_values where item_id='${ids.item}' order by column_key`)).rows).toEqual(values);
    expect((await db.query(`select * from consultation_events where item_id='${ids.item}' order by id`)).rows).toEqual(events);
    expect((await db.query(`select assigned_to from items where id='${ids.item}'`)).rows[0]).toEqual({assigned_to:ids.assignee});
    expect((await db.query("select id,owner_birthdate::text,business_item from companies")).rows).toEqual([{id:result.company_id,owner_birthdate:"1990-01-01",business_item:"합성 종목"}]);
    expect((await submit("handoff",version,"go")).rows[0].replayed).toBe(true);
    expect((await db.query("select row_order_version from boards order by id")).rows).toEqual([{row_order_version:1},{row_order_version:1}]);
    expect((await db.query("select count(*)::int n from companies")).rows[0]).toEqual({n:1});
  });

  it.each(["missing-board","duplicate-board","missing-group","hierarchy","foreign-board","foreign-group"])("%s rolls back the whole protected handoff",async(condition)=>{
    await projectSetup(); const version=await ready();
    if(condition==="missing-board") await db.exec(`delete from boards where id='${workBoard}'`);
    if(condition==="duplicate-board") await db.exec(`insert into boards(id,org_id,source) values(gen_random_uuid(),'${ids.org}','core.default-tab/contract-work')`);
    if(condition==="missing-group") await db.exec("delete from board_groups");
    if(condition==="hierarchy") await db.exec(`update items set parent_item_id='${ids.item2}' where id='${ids.item}'`);
    if(condition==="foreign-board") await db.exec(`update boards set org_id=gen_random_uuid() where id='${workBoard}'`);
    if(condition==="foreign-group") await db.exec("update board_groups set org_id=gen_random_uuid()");
    await expect(submit("handoff",version,"go")).rejects.toThrow();
    expect((await db.query(`select company_id,stage_id from deals where id='${ids.deal}'`)).rows[0]).toEqual({company_id:null,stage_id:ids.meeting});
    expect((await db.query("select count(*)::int n from companies")).rows[0]).toEqual({n:0});
    expect((await db.query("select count(*)::int n from contact_pipeline_transitions")).rows[0]).toEqual({n:0});
    expect((await projected())[0].board_id).toBe(ids.board);
  });

  it("does not reorder an archived sibling, and revoked replay cannot invoke projection",async()=>{
    await projectSetup();
    await db.exec(`update items set archived_at=now() where id='${ids.item2}'`);
    const version=await ready(); await submit("handoff",version,"go");
    expect((await db.query(`select board_id,sort_order from items where id='${ids.item2}'`)).rows[0]).toEqual({board_id:ids.board,sort_order:0});
    await db.exec(`insert into test_permission_deny values('${ids.org}','${ids.owner}','work.item_upsert')`);
    await expect(submit("handoff",version,"go")).rejects.toThrow(/permission denied/);
    expect((await db.query("select row_order_version from boards order by id")).rows).toEqual([{row_order_version:1},{row_order_version:1}]);
  });

  it.each(["stranger","inactive","feature","archived"])("%s cannot cause projection or bypass its current authority",async(condition)=>{
    await projectSetup(); const version=await ready();
    if(condition==="stranger") await asUser(db,ids.stranger);
    if(condition==="inactive") await db.exec("update orgs set status='inactive'");
    if(condition==="feature") await db.exec(`insert into test_permission_deny values('${ids.org}','${ids.owner}','work.item_upsert')`);
    if(condition==="archived") await db.exec(`update items set archived_at=now() where id='${ids.item}'`);
    await expect(submit("handoff",version,"go")).rejects.toThrow();
    expect((await projected())[0].board_id).toBe(ids.board);
    expect((await db.query("select count(*)::int n from companies")).rows[0]).toEqual({n:0});
  });

  it("private projection and row writer have no Data API execute; position guard is real",async()=>{
    await projectSetup();
    for(const role of ["anon","authenticated","service_role"]){
      expect((await db.query(`select has_function_privilege('${role}','public.project_committed_work_item(uuid,uuid)','EXECUTE') ok`)).rows[0]).toEqual({ok:false});
    }
    await expect(db.exec(`update items set board_id='${workBoard}' where id='${ids.item}'`)).rejects.toThrow(/RPC-only/);
  });
});

});
