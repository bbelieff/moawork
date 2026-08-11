import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/050_org_reporting.sql"),
  "utf8",
).toLowerCase();

describe("050_org_reporting migration contract", () => {
  it("부서 부모와 소속이 같은 org 안에서만 연결된다", () => {
    expect(sql).toContain("foreign key (parent_id, org_id) references public.departments(id, org_id)");
    expect(sql).toContain("foreign key (dept_id, org_id) references public.departments(id, org_id)");
  });

  it("노출 테이블은 RLS와 조직 구성원 select 정책을 함께 둔다", () => {
    expect(sql).toContain("alter table public.departments enable row level security");
    expect(sql).toContain("alter table public.department_members enable row level security");
    expect(sql.match(/using \(public\.is_org_member\(org_id\)\)/g)).toHaveLength(3);
  });

  it("부서 트리 순환을 DB 트리거로 거부한다", () => {
    expect(sql).toContain("before insert or update of parent_id on public.departments");
    expect(sql).toContain("department move would create a cycle");
    expect(sql).toContain("where id = v_cursor and org_id = new.org_id");
  });

  it("기존 migration을 덮지 않고 예약된 신규 번호를 사용한다", () => {
    expect(sql).toContain("org-reporting-050");
    expect(sql).not.toContain("org-departments-035");
  });
});
