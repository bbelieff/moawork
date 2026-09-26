import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * 154 초안(미적용) SQL의 실제 의미 증명 (PGlite 실제 SQL, 인증 직접 RPC).
 *
 * 초안 파일 자체를 그대로 실행한다 — 모사가 아니라 적용 전 SQL의 동작이다.
 * handoff 체인(7절)은 실제 065 `handoff_company_to_work` 파일을 함께 올려
 * 증명한다 (섀도 스텁이 아니라 같은 파일의 같은 함수).
 * - intake meta(생년월일·종목·미연계 사업자번호) 저장·검증·replay.
 * - P1 권한: 세 RPC 전부 fail-closed (`IS NOT TRUE`). revoked feature·
 *   멤버 없음·미지정 deal+null role/scope(본인)·타인 담당·허용(scope-all)·
 *   본인 담당을 인증 직접 RPC(auth.uid 설정 후 RPC 호출)로 증명한다.
 *   앱 모킹이 아니라 SQL 함수 자체를 호출한다.
 * - 연계 회사 사업자번호: 확정 필수·체크섬·충돌 보호·회사 생성 없음.
 * - 연계 회사명: 사용자 확정 + 이전값 CAS가 있어야 원본을 갱신한다.
 *   (구 fill-if-blank는 틀린 이름을 버리는 결함이라 교체됐다.)
 * - 같은 회사 다중 deal 일관 + 자동 병합·기존 레코드 재작성 없음.
 * - P1 preview: security_invoker 뷰는 RLS 거부 시 0행 (owner 뷰 3행 대비),
 *   생년월일 누출 없음.
 * - 2026-09-27 protected-integration: old direct-065 handoff tests REMOVED.
 *   Protected-chain integration (065+069+087+151+154 wrapper, blocked/commit/
 *   deny/retry/mismatch)은 ocr-protected-chain.pglite.test.ts가 실제
 *   consultation fixture로 증명한다 (065-only 불충분 지적 반영).
 */

const fullDraft = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/154_document_ocr_metadata.sql"),
  "utf8",
);
// This suite covers the OCR field RPCs and RLS only. The complete protected
// handoff chain is executed in ocr-protected-chain.pglite.test.ts.
const draft = fullDraft.slice(fullDraft.indexOf("alter table public.deal_intake"), fullDraft.indexOf("-- -- 7."));
const real065 = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/065_company_master_identity.sql"),
  "utf8",
);

const ids = {
  orgA: "00000000-0000-4000-8000-000000000001",
  owner: "00000000-0000-4000-8000-000000000010",
  mgr: "00000000-0000-4000-8000-000000000011",
  sales: "00000000-0000-4000-8000-000000000012",
  plain: "00000000-0000-4000-8000-000000000013",
  nullRole: "00000000-0000-4000-8000-000000000014",
  ghost: "00000000-0000-4000-8000-000000000015",
  boardA: "00000000-0000-4000-8000-000000000020",
  groupA: "00000000-0000-4000-8000-000000000030",
  dealFree: "00000000-0000-4000-8000-000000000040",
  itemFree: "00000000-0000-4000-8000-000000000050",
  dealLinked: "00000000-0000-4000-8000-000000000041",
  itemLinked: "00000000-0000-4000-8000-000000000051",
  dealLinked2: "00000000-0000-4000-8000-000000000042",
  itemLinked2: "00000000-0000-4000-8000-000000000052",
  dealOther: "00000000-0000-4000-8000-000000000043",
  itemOther: "00000000-0000-4000-8000-000000000053",
  dealMine: "00000000-0000-4000-8000-000000000044",
  itemMine: "00000000-0000-4000-8000-000000000054",
  companyA: "00000000-0000-4000-8000-000000000060",
  companyB: "00000000-0000-4000-8000-000000000061",
};

// 합성 번호 — 체크섬 통과, 실재 사업자 아님.
const VALID_BIZ = "1234567891";
const VALID_BIZ_DASHED = "123-45-67891";
const OTHER_BIZ = "2222222227";

async function actor(db: PGlite, userId: string) {
  await db.exec(`select set_config('request.jwt.claim.sub','${userId}',false)`);
}

describe.sequential("154 초안 intake meta·연계 회사 (PGlite 실제 SQL)", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec("create role anon; create role authenticated; create role service_role;");
  });
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => {
    // Reuse only the WASM engine. Rebuild every schema/function/row/ACL from the
    // actual SQL below, preserving autocommit and recovery after expected errors.
    // An outer transaction would poison later assertions after a denied RPC.
    await db.exec(`
      reset role; reset all;
      drop schema if exists public cascade;
      drop schema if exists auth cascade;
      drop role if exists ocr_denied;
      create schema public;
      grant usage on schema public to public;
    `);
    await db.exec(`
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table users(id uuid primary key); create table orgs(id uuid primary key,status text);
      create table org_members(org_id uuid,user_id uuid,role text,scope text,status text,primary key(org_id,user_id));
      create table boards(id uuid primary key,org_id uuid,source text);
      create table board_groups(id uuid primary key,org_id uuid,board_id uuid);
      create table deals(id uuid primary key default gen_random_uuid(),org_id uuid,company_id uuid,assigned_to uuid,title text,applied_on date,updated_at timestamptz default now());
      create table deal_intake(deal_id uuid primary key,org_id uuid,representative_name text,industry text,updated_at timestamptz default now());
      create table companies(id uuid primary key default gen_random_uuid(),org_id uuid,name text,biz_no text,merged_into uuid,assigned_to uuid,owner_name text,phone text,founded_on date,revenue numeric,region text,biz_type text,created_at timestamptz default now());
      create table items(id uuid primary key default gen_random_uuid(),org_id uuid,board_id uuid,group_id uuid,title text,assigned_to uuid,deal_id uuid,deleted_at timestamptz,updated_at timestamptz default now());
      create table new_lead_requests(org_id uuid,request_id uuid,operation text,deal_id uuid,item_id uuid,actor_id uuid,payload jsonb,primary key(org_id,request_id));
      create table deal_intake_field_audit(id uuid primary key default gen_random_uuid(),org_id uuid,deal_id uuid,field_key text,old_value jsonb,new_value jsonb,value_source text,actor_id uuid,request_id uuid,unique(org_id,request_id,field_key));
      insert into users values('${ids.owner}'),('${ids.mgr}'),('${ids.sales}'),('${ids.plain}'),('${ids.nullRole}');
      insert into orgs values('${ids.orgA}','active');
      insert into org_members values
        ('${ids.orgA}','${ids.owner}','owner','all','active'),
        ('${ids.orgA}','${ids.mgr}','member','all','active'),
        ('${ids.orgA}','${ids.sales}','member','sales','active'),
        ('${ids.orgA}','${ids.plain}','member',null,'active'),
        ('${ids.orgA}','${ids.nullRole}',null,null,'active');
      insert into boards values('${ids.boardA}','${ids.orgA}','core.default-tab/new-lead');
      insert into board_groups values('${ids.groupA}','${ids.orgA}','${ids.boardA}');
      insert into companies values('${ids.companyA}','${ids.orgA}','틀린상호',null,null,'${ids.owner}',null,null,null,null,null,null,now());
      insert into companies values('${ids.companyB}','${ids.orgA}','다른회사',null,null,'${ids.mgr}',null,null,null,null,null,null,now());
      insert into deals values('${ids.dealFree}','${ids.orgA}',null,null,'미연계건',null,now());
      insert into deals values('${ids.dealLinked}','${ids.orgA}','${ids.companyA}','${ids.owner}','연계건',null,now());
      insert into deals values('${ids.dealLinked2}','${ids.orgA}','${ids.companyA}','${ids.owner}','연계건2',null,now());
      insert into deals values('${ids.dealOther}','${ids.orgA}','${ids.companyB}','${ids.mgr}','타인건',null,now());
      insert into deals values('${ids.dealMine}','${ids.orgA}',null,'${ids.plain}','내건',null,now());
      insert into deal_intake(deal_id,org_id) values('${ids.dealFree}','${ids.orgA}'),('${ids.dealLinked}','${ids.orgA}'),('${ids.dealLinked2}','${ids.orgA}'),('${ids.dealOther}','${ids.orgA}'),('${ids.dealMine}','${ids.orgA}');
      insert into items values('${ids.itemFree}','${ids.orgA}','${ids.boardA}','${ids.groupA}','미연계건','${ids.owner}','${ids.dealFree}',null,now());
      insert into items values('${ids.itemLinked}','${ids.orgA}','${ids.boardA}','${ids.groupA}','연계건','${ids.owner}','${ids.dealLinked}',null,now());
      insert into items values('${ids.itemLinked2}','${ids.orgA}','${ids.boardA}','${ids.groupA}','연계건2','${ids.owner}','${ids.dealLinked2}',null,now());
      insert into items values('${ids.itemOther}','${ids.orgA}','${ids.boardA}','${ids.groupA}','타인건','${ids.mgr}','${ids.dealOther}',null,now());
      insert into items values('${ids.itemMine}','${ids.orgA}','${ids.boardA}','${ids.groupA}','내건','${ids.plain}','${ids.dealMine}',null,now());
    `);
    await db.exec(`
      create function effective_permission(p_org uuid,p_key text) returns boolean language sql stable as $$select exists(select 1 from public.org_members where org_id=p_org and user_id=auth.uid() and status='active')$$;
      create function is_org_member(p_org uuid) returns boolean language sql stable as $$select exists(select 1 from org_members where org_id=p_org and user_id=auth.uid() and status='active')$$;
      create function org_role(p_org uuid) returns text language sql stable as $$select role::text from org_members where org_id=p_org and user_id=auth.uid()$$;
      create function org_scope(p_org uuid) returns text language sql stable as $$select scope::text from org_members where org_id=p_org and user_id=auth.uid()$$;
    `);
    // handoff 체인은 실제 065 파일을 올린다 (섀도 스텁 아님).
    await db.exec("alter table public.items add column archived_at timestamptz");
    await db.exec(real065);
    await db.exec(draft);
    await actor(db, ids.owner);
  });

  function metaCall(deal: string, request: string, patchJson: string) {
    return `select * from update_new_lead_ocr_meta('${ids.orgA}','${deal}','${request}','${patchJson}'::jsonb,'manual')`;
  }
  const REQ = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;

  it("생년월일은 YYYY-MM-DD 실재 날짜만, 종목은 업태와 분리 저장된다", async () => {
    const r = await db.query(
      metaCall(ids.dealFree, REQ(11), '{"birthdate":"1990-01-15","business_item":"경영컨설팅"}'),
    );
    expect((r.rows[0] as { replayed: boolean }).replayed).toBe(false);
    const row = (
      await db.query<{ birthdate: string; business_item: string }>(
        `select birthdate::text birthdate, business_item from deal_intake where deal_id='${ids.dealFree}'`,
      )
    ).rows[0];
    expect(row.birthdate).toBe("1990-01-15");
    expect(row.business_item).toBe("경영컨설팅");
    // 같은 의도 재시도는 replay.
    const replay = await db.query(
      metaCall(ids.dealFree, REQ(11), '{"birthdate":"1990-01-15","business_item":"경영컨설팅"}'),
    );
    expect((replay.rows[0] as { replayed: boolean }).replayed).toBe(true);
  });

  it("주민번호 형태·없는 날짜·빈 종목은 22023으로 거부된다", async () => {
    await expect(
      db.query(metaCall(ids.dealFree, REQ(21), '{"birthdate":"900101-1234567"}')),
    ).rejects.toThrow(/ocr birthdate invalid/);
    await expect(
      db.query(metaCall(ids.dealFree, REQ(22), '{"birthdate":"1990-02-30"}')),
    ).rejects.toThrow(/ocr birthdate invalid/);
    await expect(
      db.query(metaCall(ids.dealFree, REQ(23), '{"business_item":""}')),
    ).rejects.toThrow(/ocr business_item invalid/);
    await expect(
      db.query(metaCall(ids.dealFree, REQ(24), '{"industry":"서비스업"}')),
    ).rejects.toThrow(/ocr meta field unsupported/);
    const untouched = (
      await db.query<{ n: number }>(
        `select count(*)::int n from new_lead_requests where org_id='${ids.orgA}'`,
      )
    ).rows[0].n;
    expect(untouched).toBe(0);
  });

  it("미연계 사업자번호는 intake 보관분으로, 체크섬 실패는 거부", async () => {
    await db.query(metaCall(ids.dealFree, REQ(31), `{"biz_no":"${VALID_BIZ_DASHED}"}`));
    const row = (
      await db.query<{ biz_no: string }>(
        `select biz_no from deal_intake where deal_id='${ids.dealFree}'`,
      )
    ).rows[0];
    expect(row.biz_no).toBe(VALID_BIZ);
    await expect(
      db.query(metaCall(ids.dealFree, REQ(32), '{"biz_no":"000-00-00000"}')),
    ).rejects.toThrow(/ocr biz_no/);
    await expect(
      db.query(metaCall(ids.dealFree, REQ(33), '{"biz_no":"123-45-67890"}')),
    ).rejects.toThrow(/checksum mismatch/);
  });

  it("P1 권한 매트릭스: intake meta는 fail-closed (인증 직접 RPC)", async () => {
    // revoked feature — effective_permission이 false면 owner도 거부.
    await db.exec(`create or replace function effective_permission(p_org uuid,p_key text) returns boolean language sql stable as $$select false$$;`);
    await actor(db, ids.owner);
    await expect(db.query(metaCall(ids.dealFree, REQ(41), '{"business_item":"x"}'))).rejects.toThrow(
      /ocr meta denied/,
    );
    await db.exec(`create or replace function effective_permission(p_org uuid,p_key text) returns boolean language sql stable as $$select exists(select 1 from public.org_members where org_id=p_org and user_id=auth.uid() and status='active')$$;`);

    // 멤버 행 없음 — 거부.
    await actor(db, ids.ghost);
    await expect(db.query(metaCall(ids.dealFree, REQ(42), '{"business_item":"x"}'))).rejects.toThrow(
      /ocr meta denied/,
    );

    // P1 재현: 본인 멤버 + 미지정 deal + null role/scope — business_item 쓰기가
    // 구 `NOT(... OR ...)` NULL 판정을 통과했었다. 이제 거부된다.
    await actor(db, ids.nullRole);
    await expect(
      db.query(metaCall(ids.dealFree, REQ(43), '{"business_item":"컨설팅"}')),
    ).rejects.toThrow(/ocr meta denied/);
    const leaked = (
      await db.query<{ business_item: string | null }>(
        `select business_item from deal_intake where deal_id='${ids.dealFree}'`,
      )
    ).rows[0].business_item;
    expect(leaked).toBeNull();

    // 일반 멤버 + 미지정 deal — 거부.
    await actor(db, ids.plain);
    await expect(db.query(metaCall(ids.dealFree, REQ(44), '{"business_item":"x"}'))).rejects.toThrow(
      /ocr meta denied/,
    );

    // 타인 담당 deal — 거부.
    await expect(db.query(metaCall(ids.dealOther, REQ(45), '{"business_item":"x"}'))).rejects.toThrow(
      /ocr meta denied/,
    );

    // 본인 담당 deal — 허용.
    await db.query(metaCall(ids.dealMine, REQ(46), '{"business_item":"내종목"}'));
    const mine = (
      await db.query<{ business_item: string }>(
        `select business_item from deal_intake where deal_id='${ids.dealMine}'`,
      )
    ).rows[0];
    expect(mine.business_item).toBe("내종목");

    // 허용된 범위(scope-all, 전 부서) — 타인 담당 deal도 허용.
    await actor(db, ids.mgr);
    await db.query(metaCall(ids.dealOther, REQ(47), '{"business_item":"공통종목"}'));

    // 특정 부서 scope(sales)는 미지정 deal에 fail-closed — 허용되지 않는다.
    await actor(db, ids.sales);
    await expect(db.query(metaCall(ids.dealFree, REQ(48), '{"business_item":"x"}'))).rejects.toThrow(
      /ocr meta denied/,
    );
  });

  it("P1 권한 매트릭스: 회사 RPC 2종도 fail-closed (인증 직접 RPC)", async () => {
    const bizCall = (deal: string, req: string, confirmed: boolean) =>
      `select * from ocr_update_linked_company_biz_no('${ids.orgA}','${deal}','${req}','${VALID_BIZ_DASHED}',${confirmed})`;
    const nameCall = (deal: string, req: string, title: string, expected: string | null, confirmed: boolean) =>
      `select * from ocr_sync_linked_company_name('${ids.orgA}','${deal}','${req}','${title}',${expected === null ? "null" : `'${expected}'`},${confirmed})`;

    // 멤버 없음 — 둘 다 거부.
    await actor(db, ids.ghost);
    await expect(db.query(bizCall(ids.dealLinked, REQ(51), true))).rejects.toThrow(/denied/);
    await expect(db.query(nameCall(ids.dealLinked, REQ(52), "바른상호", "틀린상호", true))).rejects.toThrow(
      /denied/,
    );

    // 본인 null role/scope + 타인 담당 deal — 둘 다 거부.
    await actor(db, ids.nullRole);
    await expect(db.query(bizCall(ids.dealLinked, REQ(53), true))).rejects.toThrow(/denied/);
    await expect(db.query(nameCall(ids.dealLinked, REQ(54), "바른상호", "틀린상호", true))).rejects.toThrow(
      /denied/,
    );

    // revoked feature — owner도 거부.
    await db.exec(`create or replace function effective_permission(p_org uuid,p_key text) returns boolean language sql stable as $$select false$$;`);
    await actor(db, ids.owner);
    await expect(db.query(bizCall(ids.dealLinked, REQ(55), true))).rejects.toThrow(/denied/);
    await expect(db.query(nameCall(ids.dealLinked, REQ(56), "바른상호", "틀린상호", true))).rejects.toThrow(
      /denied/,
    );
    await db.exec(`create or replace function effective_permission(p_org uuid,p_key text) returns boolean language sql stable as $$select exists(select 1 from public.org_members where org_id=p_org and user_id=auth.uid() and status='active')$$;`);

    // deal 담당이지만 회사 담당이 아니면 회사 쓰기 거부 (065와 같은 회사 가시성).
    // plain에게 dealMine을 연계시키고 회사는 owner 담당으로 둔다.
    await actor(db, ids.owner);
    await db.exec(`update deals set company_id='${ids.companyA}' where id='${ids.dealMine}'`);
    await actor(db, ids.plain);
    await expect(db.query(bizCall(ids.dealMine, REQ(57), true))).rejects.toThrow(/denied/);
    await expect(db.query(nameCall(ids.dealMine, REQ(58), "바른상호", "틀린상호", true))).rejects.toThrow(
      /denied/,
    );
    // intake meta(회사 아님)는 본인 deal이라 허용된다 — 경계가 가름된다.
    await db.query(metaCall(ids.dealMine, REQ(59), '{"business_item":"내종목2"}'));

    // scope-all은 deal+회사 모두 통과.
    await actor(db, ids.mgr);
    await db.query(bizCall(ids.dealOther, REQ(60), true));
    const biz = (
      await db.query<{ biz_no: string }>(`select biz_no from companies where id='${ids.companyB}'`)
    ).rows[0];
    expect(biz.biz_no).toBe(VALID_BIZ);
  });

  it("연계 회사 사업자번호: 확정 필수·멱등·충돌 보호·회사 생성 없음", async () => {
    // 확정 없이는 저장하지 않는다.
    await expect(
      db.query(
        `select * from ocr_update_linked_company_biz_no('${ids.orgA}','${ids.dealLinked}','${REQ(61)}','${VALID_BIZ_DASHED}',false)`,
      ),
    ).rejects.toThrow(/confirm required/);
    // 연계 없이는 intake로 가야 한다 (회사 생성·재연계 없음).
    await expect(
      db.query(
        `select * from ocr_update_linked_company_biz_no('${ids.orgA}','${ids.dealFree}','${REQ(62)}','${VALID_BIZ_DASHED}',true)`,
      ),
    ).rejects.toThrow(/not linked/);
    // 확정+유효 → 연계 원본에만 기록.
    const r = await db.query(
      `select * from ocr_update_linked_company_biz_no('${ids.orgA}','${ids.dealLinked}','${REQ(63)}','${VALID_BIZ_DASHED}',true)`,
    );
    expect((r.rows[0] as { replayed: boolean }).replayed).toBe(false);
    const company = (
      await db.query<{ biz_no: string }>(
        `select biz_no from companies where id='${ids.companyA}'`,
      )
    ).rows[0];
    expect(company.biz_no).toBe(VALID_BIZ);
    // 회사가 늘지 않았다 (생성 없음).
    const companies = (
      await db.query<{ n: number }>(
        `select count(*)::int n from companies where org_id='${ids.orgA}'`,
      )
    ).rows[0].n;
    expect(companies).toBe(2);
    // 같은 값 재시도는 replay.
    const replay = await db.query(
      `select * from ocr_update_linked_company_biz_no('${ids.orgA}','${ids.dealLinked}','${REQ(63)}','${VALID_BIZ_DASHED}',true)`,
    );
    expect((replay.rows[0] as { replayed: boolean }).replayed).toBe(true);
    // 다른 번호가 있으면 조용히 덮지 않고 충돌.
    await expect(
      db.query(
        `select * from ocr_update_linked_company_biz_no('${ids.orgA}','${ids.dealLinked}','${REQ(64)}','${OTHER_BIZ}',true)`,
      ),
    ).rejects.toThrow(/conflict/);
    const kept = (
      await db.query<{ biz_no: string }>(
        `select biz_no from companies where id='${ids.companyA}'`,
      )
    ).rows[0];
    expect(kept.biz_no).toBe(VALID_BIZ);
  });

  it("P2 회사명 정정: 확정+CAS가 있어야 틀린 원본을 갱신한다", async () => {
    const call = (req: string, title: string, expected: string | null, confirmed: boolean) =>
      `select * from ocr_sync_linked_company_name('${ids.orgA}','${ids.dealLinked}','${req}','${title}',${expected === null ? "null" : `'${expected}'`},${confirmed})`;
    const nameOf = async () =>
      (await db.query<{ name: string }>(`select name from companies where id='${ids.companyA}'`)).rows[0].name;

    // 확정 없이는 저장하지 않는다 (선택 아님 → 보존).
    await expect(db.query(call(REQ(71), "바른상호", "틀린상호", false))).rejects.toThrow(
      /confirm required/,
    );
    // 이전값(CAS) 없이는 저장하지 않는다 (blind 금지).
    await expect(db.query(call(REQ(72), "바른상호", null, true))).rejects.toThrow(
      /expected required/,
    );
    // 연계 없이는 저장하지 않는다.
    await expect(
      db.query(
        `select * from ocr_sync_linked_company_name('${ids.orgA}','${ids.dealFree}','${REQ(73)}','바른상호','',true)`,
      ),
    ).rejects.toThrow(/not linked/);
    expect(await nameOf()).toBe("틀린상호");

    // CAS 불일치(그 사이 바뀜) — 덮지 않고 충돌.
    await expect(db.query(call(REQ(74), "바른상호", "낡은관찰값", true))).rejects.toThrow(/conflict/);
    expect(await nameOf()).toBe("틀린상호");

    // 확정 + CAS 일치 + 다름 → 원본 갱신 (P2 정정).
    const fixed = await db.query(call(REQ(75), "바른상호", "틀린상호", true));
    expect((fixed.rows[0] as { skipped: boolean; replayed: boolean }).skipped).toBe(false);
    expect((fixed.rows[0] as { skipped: boolean; replayed: boolean }).replayed).toBe(false);
    expect(await nameOf()).toBe("바른상호");
    // 감사가 남는다.
    const audits = (
      await db.query<{ n: number }>(
        `select count(*)::int n from deal_intake_field_audit where org_id='${ids.orgA}' and request_id='${REQ(75)}' and field_key='linked_company_name'`,
      )
    ).rows[0].n;
    expect(audits).toBe(1);

    // 같은 의도 재시도는 replay이며 첫 실행과 같은 skipped(false)를 돌려준다.
    const replay = await db.query(call(REQ(75), "바른상호", "틀린상호", true));
    expect((replay.rows[0] as { replayed: boolean }).replayed).toBe(true);
    expect((replay.rows[0] as { skipped: boolean }).skipped).toBe(false);

    // 이미 같으면 skipped=true 멱등 (쓰기 없음).
    const same = await db.query(call(REQ(76), "바른상호", "바른상호", true));
    expect((same.rows[0] as { skipped: boolean }).skipped).toBe(true);

    // 다른 회사(companyB)는 건드리지 않는다 (자동 병합·재작성 없음).
    const other = (
      await db.query<{ name: string; biz_no: string | null }>(
        `select name, biz_no from companies where id='${ids.companyB}'`,
      )
    ).rows[0];
    expect(other).toEqual({ name: "다른회사", biz_no: null });

    // 같은 회사 다중 deal은 정정 후 같은 이름을 보인다 (일관된 투영).
    const preview = (
      await db.query<{ deal_id: string; company_name: string | null }>(
        `select deal_id::text, company_name from ocr_precompany_handoff_preview where org_id='${ids.orgA}' and company_id='${ids.companyA}'`,
      )
    ).rows;
    expect(preview.length).toBe(2);
    for (const row of preview) expect(row.company_name).toBe("바른상호");
  });

  it("P1 preview: security_invoker라 RLS 거부 시 0행 — 생년월일 누출 없음", async () => {
    // intake 보관분에 생년월일을 둔다 (누출 검사 대상).
    await db.query(metaCall(ids.dealLinked, REQ(81), '{"birthdate":"1990-01-15","business_item":"경영컨설팅"}'));
    // 대조용 구식 owner 뷰 (security_invoker 없음 — RLS 우회 재현).
    // 중첩 뷰의 호출자 판정이 모호하므로 구 뷰 정의문 자체를 그대로 둔다.
    await db.exec(`create or replace view public.legacy_owner_preview as
      select d.org_id, d.id as deal_id, d.title as deal_title, d.company_id,
        c.name as company_name,
        nullif(regexp_replace(coalesce(c.biz_no,''), '[^0-9]', '', 'g'),'') as linked_biz_no,
        i.representative_name, i.industry, i.business_item, i.birthdate,
        nullif(regexp_replace(coalesce(i.biz_no,''), '[^0-9]', '', 'g'),'') as intake_biz_no
      from public.deals d
      left join public.companies c on c.org_id=d.org_id and c.id=d.company_id and c.merged_into is null
      left join public.deal_intake i on i.org_id=d.org_id and i.deal_id=d.id;`);
    await db.exec(`
      alter table deals enable row level security;
      alter table companies enable row level security;
      alter table deal_intake enable row level security;
      create role ocr_denied nologin;
      grant usage on schema public to ocr_denied;
      grant select on deals, companies, deal_intake to ocr_denied;
      grant select on ocr_precompany_handoff_preview, legacy_owner_preview to ocr_denied;
    `);
    await db.exec(`set role ocr_denied`);
    try {
      const deals = (await db.query<{ n: number }>(`select count(*)::int n from deals`)).rows[0].n;
      expect(deals).toBe(0);
      // 구 owner 뷰는 RLS를 우회해 행을 노출했다 (결함 재현).
      const legacy = (await db.query<{ n: number }>(`select count(*)::int n from legacy_owner_preview`)).rows[0].n;
      expect(legacy).toBeGreaterThan(0);
      // 수정된 뷰는 호출자 RLS 그대로라 0행 — 생년월일 포함 어떤 고객 필드도 안 샌다.
      const fixed = (await db.query(`select * from ocr_precompany_handoff_preview`)).rows;
      expect(fixed.length).toBe(0);
    } finally {
      await db.exec(`reset role`);
    }
    await db.exec(`drop view public.legacy_owner_preview`);
    // 권한자는 정상 조회된다.
    const mine = (
      await db.query<{ birthdate: string }>(
        `select birthdate::text birthdate from ocr_precompany_handoff_preview where deal_id='${ids.dealLinked}'`,
      )
    ).rows;
    expect(mine.length).toBe(1);
    expect(mine[0].birthdate).toBe("1990-01-15");
  });

  it.each(["tabs", "deleted", "archived", "missing", "other-item-owner"])("public OCR RPCs deny %s before writes and replay", async (scenario) => {
    const requests = [REQ(91), REQ(92), REQ(93)];
    const calls = [
      metaCall(ids.dealLinked, requests[0], '{"business_item":"Synthetic category"}'),
      `select * from ocr_update_linked_company_biz_no('${ids.orgA}','${ids.dealLinked}','${requests[1]}','${VALID_BIZ}',true)`,
      `select * from ocr_sync_linked_company_name('${ids.orgA}','${ids.dealLinked}','${requests[2]}','Corrected','틀린상호',true)`,
    ];
    await db.exec("set role authenticated");
    for (const call of calls) await db.query(call);
    await db.exec("reset role");
    if (scenario === "tabs") {
      await db.exec(`create or replace function effective_permission(p_org uuid,p_key text) returns boolean language sql stable as $$select p_key <> 'work.view_tabs'$$`);
    } else if (scenario === "deleted") {
      await db.query("update items set deleted_at=now() where id=$1", [ids.itemLinked]);
    } else if (scenario === "archived") {
      await db.query("update items set archived_at=now() where id=$1", [ids.itemLinked]);
    } else if (scenario === "missing") {
      await db.query("delete from items where id=$1", [ids.itemLinked]);
    } else {
      await db.query("update org_members set role='member',scope='self' where user_id=$1", [ids.owner]);
      await db.query("update items set assigned_to=$1 where id=$2", [ids.mgr, ids.itemLinked]);
    }
    const beforeCompany = (await db.query("select name,biz_no from companies where id=$1", [ids.companyA])).rows;
    const beforeAudit = (await db.query("select count(*) from deal_intake_field_audit")).rows;
    await db.exec("set role authenticated");
    for (let index=0; index<calls.length; index++) {
      await expect(db.query(calls[index])).rejects.toMatchObject({code:"42501"});
      await expect(db.query(calls[index].replace(requests[index], REQ(94+index)))).rejects.toMatchObject({code:"42501"});
    }
    await db.exec("reset role");
    expect((await db.query("select name,biz_no from companies where id=$1", [ids.companyA])).rows).toEqual(beforeCompany);
    expect((await db.query("select count(*) from deal_intake_field_audit")).rows).toEqual(beforeAudit);
    expect((await db.query("select count(*)::int n from new_lead_requests")).rows).toEqual([{n:3}]);
  });

  it("absent intake cannot report a stored OCR field or consume a receipt", async () => {
    await db.query("delete from deal_intake where deal_id=$1", [ids.dealFree]);
    await db.exec("set role authenticated");
    await expect(db.query(metaCall(ids.dealFree, REQ(97), '{"business_item":"Missing"}'))).rejects.toMatchObject({code:"22023"});
    await db.exec("reset role");
    expect((await db.query("select count(*)::int n from new_lead_requests")).rows).toEqual([{n:0}]);
  });

});
