import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/104_bbe240_deal_ledger_vat_wiring.sql"),
  "utf8",
);

describe("BBE-240 · deal ledger VAT wiring migration", () => {
  it("adds the two VAT columns additively", () => {
    expect(sql).toContain(
      "add column if not exists vat_included boolean not null default false",
    );
    expect(sql).toContain(
      "add column if not exists tax_invoice_issued boolean not null default false",
    );
  });

  it("locates the two conflicting CHECK constraints by definition text, not by guessed name", () => {
    // pg_get_constraintdef() 정규화 때문에 035 원문의 "between" 리터럴로는 절대 못 찾는다
    // (BETWEEN 이 카탈로그에 >=/<= 로 저장됨) — >=/<= 형태로 찾고 vat_included 를 언급하는
    // 새 제약과 헷갈리지 않게 제외 조건을 같이 건다.
    expect(sql).toContain("pg_get_constraintdef(oid) ilike '%received_amount <= amount%'");
    expect(sql).toContain("pg_get_constraintdef(oid) not ilike '%vat_included%'");
    expect(sql).toContain("pg_get_constraintdef(oid) ilike '%paid_on is not null%'");
    expect(sql).toMatch(/drop constraint %I/);
  });

  it("replaces them with VAT-aware constraints that keep non-VAT semantics exact", () => {
    expect(sql).toContain(
      "check (received_amount >= 0 and trunc(received_amount) = received_amount and (vat_included or received_amount <= amount))",
    );
    expect(sql).toContain(
      "(not vat_included and ((received_amount = amount and paid_on is not null) or (received_amount < amount and paid_on is null)))",
    );
    expect(sql).toContain(
      "(vat_included and ((received_amount > 0 and paid_on is not null) or (received_amount = 0 and paid_on is null)))",
    );
  });

  it("drops the old 7-arg add_deal_ledger_entry overload before recreating it with 9 args", () => {
    expect(sql).toContain(
      "drop function if exists public.add_deal_ledger_entry(uuid,text,numeric,numeric,date,date,date);",
    );
    expect(sql).toContain(
      "create or replace function public.add_deal_ledger_entry(",
    );
    expect(sql).toContain("p_vat_included boolean default false, p_tax_invoice_issued boolean default false");
    expect(sql).toContain(
      "public.add_deal_ledger_entry(uuid,text,numeric,numeric,date,date,date,boolean,boolean) to authenticated",
    );
  });

  it("leaves delete_deal_ledger_entry and deal_ledger_summary untouched (no redefinition)", () => {
    expect(sql).not.toContain("create or replace function public.delete_deal_ledger_entry");
    expect(sql).not.toContain("create or replace function public.deal_ledger_summary");
  });

  it("rejects a second contract_deposit entry for the same deal — server-side, not just a UI hint", () => {
    expect(sql).toContain("p_kind = 'contract_deposit' and exists (");
    expect(sql).toContain("where e.deal_id = p_deal_id and e.kind = 'contract_deposit'");
    expect(sql).toContain("raise exception 'contract deposit already recorded for this deal'");
  });
});
