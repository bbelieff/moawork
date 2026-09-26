import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deriveOcrFieldRequestId } from "@/lib/document-ocr/apply-adapter";

/**
 * OCR 필드별 안정 requestId의 실제 SQL 영수증 증명 (PGlite 실제 SQL).
 *
 * `new_lead_requests` PK(org_id, request_id)는 payload/operation에 묶인다
 * (087 update · 110 title · 120 meta). 같은 ID에 다른 payload가 오면
 * 22023 'idempotency key reuse'로 영구 실패하고, 같은 payload면 replay다.
 * 구 동작(세션 base ID를 전 필드에 공용)은 두 번째 필드부터 SQL에서
 * 직접 22023을 내는 것을 아래 1번이 실제 SQL로 재현한다.
 * 파생 ID(어댑터의 `deriveOcrFieldRequestId` 그대로 — 모사 아님)는
 * 필드·동작마다 영수증이 분리돼 전부 성공하고 재시도는 replay가 된다.
 */

const sql087 = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/087_new_lead_canonical.sql"),
  "utf8",
);
const sql110 = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/110_bbe171_new_lead_title_audit.sql"),
  "utf8",
);
const sql120 = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/120_bbe273_new_lead_full_intake.sql"),
  "utf8",
);
const updateSql = sql087.slice(
  sql087.indexOf("create or replace function public.update_new_lead_fields("),
  sql087.indexOf(
    "create or replace function public.execute_contact_pipeline_transition(",
  ),
);
const metaSql = sql120.slice(
  sql120.indexOf("create or replace function public.update_new_lead_intake_meta("),
  sql120.indexOf("revoke all on function public.update_new_lead_intake_meta"),
);

const ids = {
  orgA: "00000000-0000-4000-8000-000000000001",
  owner: "00000000-0000-4000-8000-000000000010",
  boardA: "00000000-0000-4000-8000-000000000020",
  groupA: "00000000-0000-4000-8000-000000000030",
  dealA: "00000000-0000-4000-8000-000000000040",
  itemA: "00000000-0000-4000-8000-000000000050",
};

async function actor(db: PGlite, userId: string) {
  await db.exec(`select set_config('request.jwt.claim.sub','${userId}',false)`);
}

describe.sequential("OCR requestId 영수증 (PGlite 실제 SQL)", () => {
  let db: PGlite;
  beforeAll(async () => { db = new PGlite(); await db.waitReady; });
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => {
    // Reuse the engine only; every test keeps fresh schemas, roles and autocommit.
    await db.exec(`reset role; reset all;
      drop schema if exists public cascade; drop schema if exists auth cascade;
      drop role if exists anon; drop role if exists authenticated; drop role if exists service_role;
      create schema public; grant usage on schema public to public;`);
    await db.exec(`
      create schema auth; create role anon; create role authenticated; create role service_role;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function public.begin_guarded_migration(p_logical_key text,p_file_name text,p_file_digest text,p_expected_predecessor text,p_executor text,p_thread_id text,p_foundation boolean) returns void language sql as $$select$$;
      create table users(id uuid primary key); create table orgs(id uuid primary key,status text);
      create table org_members(org_id uuid,user_id uuid,role text,scope text,status text,primary key(org_id,user_id));
      create table boards(id uuid primary key,org_id uuid,source text);
      create table board_groups(id uuid primary key,org_id uuid,board_id uuid);
      create table board_columns(id uuid primary key default gen_random_uuid(),org_id uuid,board_id uuid,key text,archived_at timestamptz);
      create table deals(id uuid primary key default gen_random_uuid(),org_id uuid,company_id uuid,assigned_to uuid,title text,applied_on date,updated_at timestamptz default now());
      create table deal_intake(deal_id uuid primary key,org_id uuid,representative_name text,phone_normalized text,phone_display text,email_normalized text,business_registration_type text,industry text,industry_code text,revenue_band text,region_sido text,region_sigungu text,address_detail text,acquisition_source text,source_external_id text,updated_at timestamptz default now());
      create table items(id uuid primary key default gen_random_uuid(),org_id uuid,board_id uuid,group_id uuid,title text,assigned_to uuid,deal_id uuid,deleted_at timestamptz,updated_at timestamptz default now());
      create table new_lead_requests(org_id uuid,request_id uuid,operation text,deal_id uuid,item_id uuid,actor_id uuid,payload jsonb,primary key(org_id,request_id));
      create table item_values(org_id uuid,item_id uuid,column_key text,value_jsonb jsonb,primary key(item_id,column_key));
      create table deal_intake_field_audit(id uuid primary key default gen_random_uuid(),org_id uuid,deal_id uuid,field_key text,old_value jsonb,new_value jsonb,value_source text,actor_id uuid,request_id uuid,unique(org_id,request_id,field_key));
      insert into users values('${ids.owner}');
      insert into orgs values('${ids.orgA}','active');
      insert into org_members values ('${ids.orgA}','${ids.owner}','owner','all','active');
      insert into boards values('${ids.boardA}','${ids.orgA}','core.default-tab/new-lead');
      insert into board_groups values('${ids.groupA}','${ids.orgA}','${ids.boardA}');
      insert into board_columns(org_id,board_id,key) select '${ids.orgA}','${ids.boardA}',unnest(array['rep_name','industry','biz_reg_type','address_detail']);
      insert into deals values('${ids.dealA}','${ids.orgA}',null,'${ids.owner}','기존상호',null);
      insert into deal_intake(deal_id,org_id) values('${ids.dealA}','${ids.orgA}');
      insert into items values('${ids.itemA}','${ids.orgA}','${ids.boardA}','${ids.groupA}','기존상호','${ids.owner}','${ids.dealA}',null);
    `);
    // language sql 스텁은 참조 테이블이 있은 뒤에 정의한다 (생성 시점에 해석됨).
    await db.exec(`
      create function effective_permission(p_org uuid,p_key text) returns boolean language sql stable as $$select exists(select 1 from public.org_members where org_id=p_org and user_id=auth.uid() and status='active')$$;
    `);
    await db.exec(updateSql);
    await db.exec(sql110);
    await db.exec(metaSql);
    await actor(db, ids.owner);
  });

  function updateCall(request: string, patchJson: string) {
    return `select * from update_new_lead_fields('${ids.orgA}','${ids.dealA}','${request}','${patchJson}'::jsonb,'manual')`;
  }
  function metaCall(request: string, patchJson: string) {
    return `select * from update_new_lead_intake_meta('${ids.orgA}','${ids.dealA}','${request}','${patchJson}'::jsonb)`;
  }
  function titleCall(request: string, title: string) {
    return `select * from update_new_lead_title('${ids.orgA}','${ids.dealA}','${request}','${title}','manual')`;
  }

  it("같은 ID에 다른 payload(두 번째 필드)는 실제 SQL이 22023으로 거부한다", async () => {
    const shared = "00000000-0000-4000-8000-000000000101";
    const first = await db.query(updateCall(shared, '{"representative_name":"홍길동"}'));
    expect((first.rows[0] as { replayed: boolean }).replayed).toBe(false);
    // 구 동작: 두 번째 필드가 같은 ID를 재사용 → 영구 실패.
    await expect(db.query(updateCall(shared, '{"industry":"서비스업"}'))).rejects.toThrow(
      /idempotency key reuse/,
    );
    // 같은 ID 재시도는 같은 payload가 아니면 절대 성공하지 않는다.
    await expect(db.query(updateCall(shared, '{"industry":"서비스업"}'))).rejects.toThrow(
      /idempotency key reuse/,
    );
  });

  it("필드별 파생 ID(대표자/업종/주소)는 영수증 분리로 전부 성공한다", async () => {
    const base = "00000000-0000-4000-8000-000000000102";
    const repId = deriveOcrFieldRequestId(base, "representative", "rep_name", "홍길동");
    const indId = deriveOcrFieldRequestId(base, "businessCategory", "industry", "서비스업");
    const addrId = deriveOcrFieldRequestId(base, "businessAddress", "address_detail", "서울 강남");
    const r1 = await db.query(updateCall(repId, '{"representative_name":"홍길동"}'));
    const r2 = await db.query(updateCall(indId, '{"industry":"서비스업"}'));
    const r3 = await db.query(metaCall(addrId, '{"address_detail":"서울 강남"}'));
    for (const r of [r1, r2, r3]) {
      expect((r.rows[0] as { replayed: boolean }).replayed).toBe(false);
    }
    const receipts = (
      await db.query<{ n: number }>("select count(*)::int n from new_lead_requests")
    ).rows[0].n;
    expect(receipts).toBe(3);
    // 같은 의도 재시도는 같은 파생 ID → replay 성공 (실패분만 다시 시도 가능).
    const replay = await db.query(updateCall(repId, '{"representative_name":"홍길동"}'));
    expect((replay.rows[0] as { replayed: boolean }).replayed).toBe(true);
  });

  it("title 경로도 같은 규칙 — 같은 ID 다른 상호는 22023, 같은 상호는 replay", async () => {
    const titleId = deriveOcrFieldRequestId(
      "00000000-0000-4000-8000-000000000103",
      "companyName",
      "title",
      "(주)가상상회",
    );
    const first = await db.query(titleCall(titleId, "(주)가상상회"));
    expect((first.rows[0] as { replayed: boolean }).replayed).toBe(false);
    await expect(db.query(titleCall(titleId, "(주)다른상회"))).rejects.toThrow(
      /idempotency key reuse/,
    );
    const replay = await db.query(titleCall(titleId, "(주)가상상회"));
    expect((replay.rows[0] as { replayed: boolean }).replayed).toBe(true);
  });

  it("동작이 달라도 파생 ID는 겹치지 않는다 (update vs title vs meta)", async () => {
    const base = "00000000-0000-4000-8000-000000000104";
    const updateId = deriveOcrFieldRequestId(base, "representative", "rep_name", "홍길동");
    const titleId = deriveOcrFieldRequestId(base, "companyName", "title", "홍길동");
    const metaId = deriveOcrFieldRequestId(base, "businessAddress", "address_detail", "홍길동");
    expect(new Set([updateId, titleId, metaId]).size).toBe(3);
    await db.query(updateCall(updateId, '{"representative_name":"홍길동"}'));
    await db.query(titleCall(titleId, "홍길동"));
    await db.query(metaCall(metaId, '{"address_detail":"홍길동"}'));
    const receipts = (
      await db.query<{ n: number }>("select count(*)::int n from new_lead_requests")
    ).rows[0].n;
    expect(receipts).toBe(3);
  });
});
