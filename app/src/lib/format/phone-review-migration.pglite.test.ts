import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/131_issue528_item_phone_review_status.sql"),
  "utf8",
);

const ORG = "00000000-0000-4000-8000-000000000001";
const BOARD = "00000000-0000-4000-8000-000000000002";
const ITEM = "00000000-0000-4000-8000-000000000003";
const NEXT_ITEM = "00000000-0000-4000-8000-000000000004";

const databases: PGlite[] = [];
afterEach(async () => Promise.all(databases.splice(0).map((db) => db.close())));

async function boot() {
  const db = new PGlite();
  databases.push(db);
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.orgs(id uuid primary key);
    create table public.boards(id uuid primary key,org_id uuid not null references public.orgs(id));
    create table public.items(id uuid primary key,org_id uuid not null references public.orgs(id),board_id uuid not null references public.boards(id));
    create table public.board_columns(board_id uuid not null,org_id uuid not null,key text not null,type text not null,primary key(board_id,key));
    create table public.item_values(org_id uuid not null,item_id uuid not null,column_key text not null,value_jsonb jsonb,primary key(item_id,column_key));
    create table public.phone_normalization_originals(
      source_table text not null,org_id uuid not null,record_id uuid not null,field_key text not null,
      raw_value jsonb not null,normalization_status text not null,primary key(source_table,record_id,field_key)
    );
    create function public.begin_guarded_migration(
      p_logical_key text,p_file_name text,p_file_digest text,p_expected_predecessor text,
      p_executor text,p_thread_id text,p_foundation boolean
    ) returns void language sql as $$ select $$;
    create function public.normalize_phone(p_value text) returns text language plpgsql immutable set search_path='' as $$
    declare v_digits text := regexp_replace(coalesce(p_value,''),'[^0-9]','','g');
    begin
      if v_digits like '82%' then v_digits := '0' || substring(v_digits from 3); end if;
      if length(v_digits) between 9 and 11 then return v_digits; end if;
      return null;
    end $$;
    create function public.normalize_item_value_phone() returns trigger language plpgsql as $$ begin return new; end $$;
    create trigger trg_item_values_normalize_phone before insert or update of value_jsonb,column_key on public.item_values
      for each row execute function public.normalize_item_value_phone();
    insert into public.orgs values('${ORG}');
    insert into public.boards values('${BOARD}','${ORG}');
    insert into public.items values('${ITEM}','${ORG}','${BOARD}'),('${NEXT_ITEM}','${ORG}','${BOARD}');
    insert into public.board_columns values('${BOARD}','${ORG}','phone','phone');
    insert into public.item_values values('${ORG}','${ITEM}','phone',null);
    insert into public.phone_normalization_originals values('item_values','${ORG}','${ITEM}','phone','"판독불가"','needs_review');
  `);
  await db.exec(migration);
  return db;
}

describe("#528 item phone review status migration", () => {
  it("기존 고객 전화값은 바꾸지 않고 잠금 audit의 검토상태만 연결한다", async () => {
    const db = await boot();
    const row = await db.query<{ value_jsonb: unknown; phone_normalization_status: string }>(
      `select value_jsonb,phone_normalization_status from public.item_values where item_id='${ITEM}'`,
    );
    expect(row.rows[0]).toEqual({ value_jsonb: null, phone_normalization_status: "needs_review" });
    const original = await db.query<{ raw_value: unknown }>("select raw_value from public.phone_normalization_originals");
    expect(original.rows[0].raw_value).toBe("판독불가");
  });

  it("교체된 trigger가 이후 입력을 숫자로 저장하고 상태를 함께 유지한다", async () => {
    const db = await boot();
    await db.exec(`insert into public.item_values values('${ORG}','${NEXT_ITEM}','phone','"+82 10-1234-5678"','normalized')`);
    const row = await db.query<{ value_jsonb: unknown; phone_normalization_status: string }>(
      `select value_jsonb,phone_normalization_status from public.item_values where item_id='${NEXT_ITEM}'`,
    );
    expect(row.rows[0]).toEqual({ value_jsonb: "01012345678", phone_normalization_status: "normalized" });

    await db.exec(`update public.item_values set value_jsonb='"abc"' where item_id='${NEXT_ITEM}' and column_key='phone'`);
    const review = await db.query<{ value_jsonb: unknown; phone_normalization_status: string }>(
      `select value_jsonb,phone_normalization_status from public.item_values where item_id='${NEXT_ITEM}'`,
    );
    expect(review.rows[0]).toEqual({ value_jsonb: null, phone_normalization_status: "needs_review" });
  });
});
