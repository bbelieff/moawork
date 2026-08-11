import { describe, expect, it } from "vitest";
import {
  resolveEffectivePermission,
  resolvePermAccess,
  roleDefaultAllowed,
  roleEffectiveAllowed,
} from "./resolve";

describe("roleDefaultAllowed — 역할 기본값(matrix.ts 미러)", () => {
  it("소유자는 위험 항목도 기본 허용이다", () => {
    expect(roleDefaultAllowed("owner", "danger.bulk_edit_delete")).toBe(true);
  });

  it("멤버는 항목 삭제가 기본 차단이다", () => {
    expect(roleDefaultAllowed("member", "work.item_delete")).toBe(false);
  });

  it("팀장은 담당자 지정은 되지만 컬럼 관리는 안 된다", () => {
    expect(roleDefaultAllowed("team_lead", "work.assign_owner")).toBe(true);
    expect(roleDefaultAllowed("team_lead", "structure.column_manage")).toBe(false);
  });

  it("모르는 scope_key 는 전부 닫힘이다", () => {
    expect(roleDefaultAllowed("owner", "no.such.key")).toBe(false);
    expect(roleDefaultAllowed("admin", "no.such.key")).toBe(false);
  });
});

describe("roleEffectiveAllowed — 조직 오버라이드가 기본값을 덮는다", () => {
  it("오버라이드가 없으면 기본값 그대로", () => {
    expect(roleEffectiveAllowed("admin", "danger.csv_export", [])).toBe(true);
  });

  it("오버라이드가 있으면 그 값을 쓴다", () => {
    const overrides = [{ role: "admin" as const, scopeKey: "danger.csv_export", allowed: false }];
    expect(roleEffectiveAllowed("admin", "danger.csv_export", overrides)).toBe(false);
  });

  it("소유자는 오버라이드가 있어도 항상 true 다", () => {
    const overrides = [{ role: "owner" as const, scopeKey: "danger.csv_export", allowed: false }];
    expect(roleEffectiveAllowed("owner", "danger.csv_export", overrides)).toBe(true);
  });

  it("다른 역할의 오버라이드는 영향을 주지 않는다", () => {
    const overrides = [{ role: "admin" as const, scopeKey: "work.item_delete", allowed: true }];
    expect(roleEffectiveAllowed("member", "work.item_delete", overrides)).toBe(false);
  });
});

describe("resolveEffectivePermission — 차단이 허용을 이긴다", () => {
  const uid = "user-1";

  it("예외가 없으면 역할 유효값 그대로", () => {
    expect(resolveEffectivePermission("member", "work.view_tabs", [], [], uid)).toBe(true);
  });

  it("개인 allow 예외가 역할 기본 차단을 뒤집는다", () => {
    const exceptions = [{ userId: uid, scopeKey: "work.item_delete", decision: "allow" as const }];
    expect(resolveEffectivePermission("member", "work.item_delete", [], exceptions, uid)).toBe(true);
  });

  it("개인 deny 예외가 역할 기본 허용을 이긴다", () => {
    const exceptions = [{ userId: uid, scopeKey: "work.view_tabs", decision: "deny" as const }];
    expect(resolveEffectivePermission("member", "work.view_tabs", [], exceptions, uid)).toBe(false);
  });

  it("다른 사람의 예외는 나에게 적용되지 않는다", () => {
    const exceptions = [{ userId: "someone-else", scopeKey: "work.view_tabs", decision: "deny" as const }];
    expect(resolveEffectivePermission("member", "work.view_tabs", [], exceptions, uid)).toBe(true);
  });

  it("소유자는 예외가 있어도 항상 true 다", () => {
    const exceptions = [{ userId: uid, scopeKey: "danger.data_import", decision: "deny" as const }];
    expect(resolveEffectivePermission("owner", "danger.data_import", [], exceptions, uid)).toBe(true);
  });

  it("역할 오버라이드와 개인 예외가 함께 있으면 예외가 최종값이다", () => {
    const overrides = [{ role: "member" as const, scopeKey: "work.item_delete", allowed: true }];
    const exceptions = [{ userId: uid, scopeKey: "work.item_delete", decision: "deny" as const }];
    expect(resolveEffectivePermission("member", "work.item_delete", overrides, exceptions, uid)).toBe(false);
  });
});

describe("resolvePermAccess", () => {
  it("허용이면 allowed", () => {
    expect(resolvePermAccess(true)).toEqual({ kind: "allowed" });
  });
  it("불허면 denied/permission", () => {
    expect(resolvePermAccess(false)).toEqual({ kind: "denied", reason: "permission" });
  });
});
