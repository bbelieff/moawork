import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_PERM_ITEMS, PERM_ITEM_COUNT, PERM_MATRIX, findPermItem, isKnownScopeKey, isRole } from "./matrix";

const MIGRATION = join(__dirname, "..", "..", "..", "..", "supabase", "migrations", "144_issue645_case_ownership_registry.sql");
const LEGACY_PERMISSION_MIGRATION = join(__dirname, "..", "..", "..", "..", "supabase", "migrations", "055_permission_role_matrix.sql");
const ENUM_MIGRATION = join(__dirname, "..", "..", "..", "..", "supabase", "migrations", "054_permission_role_enums.sql");

describe("PERM_MATRIX 구조", () => {
  it("기존 24항목과 분리된 finance read/manage seam 2개다", () => {
    expect(PERM_ITEM_COUNT).toBe(26);
  });

  it("기존 5개 그룹을 보존하고 재무 seam을 별도 그룹으로 둔다", () => {
    expect(PERM_MATRIX.map((g) => g.items.length)).toEqual([5, 5, 4, 5, 5, 2]);
  });

  it("scope_key 는 26개 전부 유일하다", () => {
    const keys = ALL_PERM_ITEMS.map((i) => i.scopeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("기존 위험 5항목과 재무 2항목만 danger=true 다", () => {
    const dangerKeys = ALL_PERM_ITEMS.filter((i) => i.danger).map((i) => i.scopeKey);
    expect(dangerKeys).toEqual([
      "danger.csv_export",
      "danger.bulk_edit_delete",
      "danger.view_accounting_amount",
      "danger.year_end_archive",
      "danger.data_import",
      "finance.ledger_read",
      "finance.ledger_manage",
    ]);
  });

  it("소유자 열은 26항목 전부 true 다 — 소유자 권한은 끌 수 없다", () => {
    expect(ALL_PERM_ITEMS.every((i) => i.defaultAllowed[0] === true)).toBe(true);
  });

  it("findPermItem·isKnownScopeKey 가 일관된다", () => {
    expect(isKnownScopeKey("work.view_tabs")).toBe(true);
    expect(isKnownScopeKey("no.such.key")).toBe(false);
    expect(findPermItem("work.view_tabs")?.label).toBe("탭 보기");
    expect(findPermItem("no.such.key")).toBeUndefined();
  });

  it("역할 입력은 4종 화이트리스트로만 받는다", () => {
    expect(["owner", "admin", "team_lead", "member"].every(isRole)).toBe(true);
    expect(isRole("platform_admin")).toBe(false);
  });
});

describe("142 migration perm_baseline() 과 TS 매트릭스가 완전히 일치한다", () => {
  // 값이 SQL 과 TS 양쪽에 있으므로 한쪽만 고치면 조용히 어긋난다. 여기서 막는다.
  const sql = readFileSync(MIGRATION, "utf8");
  const legacySql = readFileSync(LEGACY_PERMISSION_MIGRATION, "utf8");
  const enumSql = readFileSync(ENUM_MIGRATION, "utf8");
  const valuesBlock = sql.slice(sql.indexOf("perm_baseline()"));
  const rowPattern = /\(\s*'([^']+)','([^']+)','([^']+)',(true|false),(true|false),(true|false),(true|false),(true|false)\)/g;

  const sqlRows: Array<{
    group: string;
    scopeKey: string;
    label: string;
    danger: boolean;
    allowed: [boolean, boolean, boolean, boolean];
  }> = [];
  let match: RegExpExecArray | null;
  while ((match = rowPattern.exec(valuesBlock))) {
    const [, group, scopeKey, label, danger, owner, admin, teamLead, member] = match;
    sqlRows.push({
      group,
      scopeKey,
      label,
      danger: danger === "true",
      allowed: [owner === "true", admin === "true", teamLead === "true", member === "true"],
    });
  }

  it("SQL VALUES 에서 26행을 파싱했다(파서 자체가 깨지지 않았는지 확인)", () => {
    expect(sqlRows).toHaveLength(26);
  });

  it("항목별 group·label·danger·역할별 허용값이 TS 와 완전히 같다", () => {
    const tsRows = PERM_MATRIX.flatMap((g) =>
      g.items.map((i) => ({
        group: g.group,
        scopeKey: i.scopeKey,
        label: i.label,
        danger: Boolean(i.danger),
        allowed: i.defaultAllowed,
      })),
    );
    const bySqlKey = new Map(sqlRows.map((r) => [r.scopeKey, r]));
    for (const ts of tsRows) {
      const sqlRow = bySqlKey.get(ts.scopeKey);
      expect(sqlRow, `SQL 에 ${ts.scopeKey} 없음`).toBeDefined();
      expect(sqlRow).toEqual(ts);
    }
    expect(sqlRows).toHaveLength(tsRows.length);
  });

  it("BBE-119 부서 범위를 뷰보다 먼저 강제하고 숨김 수를 반환한다", () => {
    expect(enumSql).toContain("alter type public.member_scope add value if not exists 'department'");
    expect(legacySql).toContain("create or replace function public.read_permission_scoped_work_items");
    expect(legacySql.indexOf("scope_visible as materialized")).toBeLessThan(legacySql.indexOf("viewed as"));
    expect(legacySql).toContain("p_view_assignee is null or s.assigned_to = p_view_assignee");
    expect(legacySql).toContain("'hiddenCount', v_hidden");
    expect(legacySql).toContain("public.department_members");
  });

  it("SECURITY DEFINER RPC는 PUBLIC·anon 실행권을 회수한다", () => {
    for (const signature of [
      "effective_permission(uuid, text)",
      "write_org_role_permission(uuid, public.member_role, text, boolean, uuid)",
      "bind_workspace_member_permission_exception(uuid, uuid, text, text, text, uuid)",
      "record_risky_action(uuid, text, jsonb)",
      "read_org_permission_matrix(uuid)",
      "read_permission_scoped_work_items(uuid, uuid)",
    ]) {
      expect(legacySql).toContain(`revoke all on function public.${signature} from public, anon`);
    }
  });
});
