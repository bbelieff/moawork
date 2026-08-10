import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_PERM_ITEMS, PERM_ITEM_COUNT, PERM_MATRIX, findPermItem, isKnownScopeKey } from "./matrix";

const MIGRATION = join(__dirname, "..", "..", "..", "..", "supabase", "migrations", "035_perm_role_matrix.sql");

describe("PERM_MATRIX 구조", () => {
  it("총 24항목이다 — 카드 제목 22항목은 낡은 값, 목업 실측이 정본", () => {
    expect(PERM_ITEM_COUNT).toBe(24);
  });

  it("그룹 5개, 그룹별 항목 수가 목업과 같다 — 업무5·구조5·자동화발송4·조직공지5·위험5", () => {
    expect(PERM_MATRIX.map((g) => g.items.length)).toEqual([5, 5, 4, 5, 5]);
  });

  it("scope_key 는 24개 전부 유일하다", () => {
    const keys = ALL_PERM_ITEMS.map((i) => i.scopeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("위험 그룹 5항목만 danger=true 다", () => {
    const dangerKeys = ALL_PERM_ITEMS.filter((i) => i.danger).map((i) => i.scopeKey);
    expect(dangerKeys).toEqual([
      "danger.csv_export",
      "danger.bulk_edit_delete",
      "danger.view_accounting_amount",
      "danger.year_end_archive",
      "danger.data_import",
    ]);
  });

  it("소유자 열은 24항목 전부 true 다 — 소유자 권한은 끌 수 없다", () => {
    expect(ALL_PERM_ITEMS.every((i) => i.defaultAllowed[0] === true)).toBe(true);
  });

  it("findPermItem·isKnownScopeKey 가 일관된다", () => {
    expect(isKnownScopeKey("work.view_tabs")).toBe(true);
    expect(isKnownScopeKey("no.such.key")).toBe(false);
    expect(findPermItem("work.view_tabs")?.label).toBe("탭 보기");
    expect(findPermItem("no.such.key")).toBeUndefined();
  });
});

describe("035_perm_role_matrix.sql 의 perm_baseline() 과 TS 매트릭스가 완전히 일치한다", () => {
  // 값이 SQL 과 TS 양쪽에 있으므로 한쪽만 고치면 조용히 어긋난다. 여기서 막는다.
  const sql = readFileSync(MIGRATION, "utf8");
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

  it("SQL VALUES 에서 24행을 파싱했다(파서 자체가 깨지지 않았는지 확인)", () => {
    expect(sqlRows).toHaveLength(24);
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
});
