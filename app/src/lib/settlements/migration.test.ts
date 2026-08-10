import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../../../../supabase/migrations/033_settlement_ledger.sql", import.meta.url), "utf8");

describe("033 settlement ledger DB/RLS contract", () => {
  it("원장과 감사 테이블 모두 RLS를 켠다", () => {
    expect(sql).toContain("alter table public.settlement_ledger_entries enable row level security");
    expect(sql).toContain("alter table public.settlement_ledger_audit enable row level security");
    expect(sql).toContain("alter table public.settlement_export_audit enable row level security");
  });
  it("CSV 내보내기는 관리자 권한과 별도 감사행을 남긴다", () => {
    expect(sql).toContain("record_settlement_csv_export");
    expect(sql).toContain("insert into public.settlement_export_audit");
    expect(sql).toContain("row_count");
  });
  it("담당범위 읽기와 owner/admin 쓰기 권한을 분리한다", () => {
    expect(sql).toContain("get_settlement_ledger_snapshot");
    expect(sql).toContain("public.org_scope(s.org_id) = 'all'");
    expect(sql).toContain("d.assigned_to = auth.uid()");
    expect(sql).toContain("public.org_role(v_org_id) not in ('owner', 'admin')");
  });
  it("정산 기본 금액도 담당범위 RPC 안에서만 반환한다", () => {
    expect(sql).toMatch(/get_settlement_ledger_snapshot[\s\S]*s\.org_id = p_org_id[\s\S]*d\.assigned_to = auth\.uid\(\)/);
  });
  it("직접 변경을 막고 RPC만 authenticated에 공개한다", () => {
    expect(sql).toContain("revoke all on public.settlement_ledger_entries from public, anon, authenticated");
    expect(sql).toMatch(/grant execute on function[\s\S]*public\.post_settlement_ledger_entry/);
  });
  it("취소·정정은 삭제나 덮어쓰기 대신 감사행을 추가한다", () => {
    expect(sql).not.toMatch(/delete from public\.settlement_ledger_entries/i);
    expect(sql).toContain("'corrected'");
    expect(sql).toContain("'canceled'");
  });
});
