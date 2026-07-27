import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { RESERVED_WORKSPACE_SLUGS, normalizeWorkspaceSlug, parseWorkspaceEntryResume, parseWorkspaceRequest, validateWorkspaceSlug, workspaceEntryResumeValue } from "./contracts";

describe("workspace entry request contract", () => {
  it("normalizes and validates only lower-case ASCII slug candidates", () => {
    expect(normalizeWorkspaceSlug("  Moa-Team ")).toBe("moa-team");
    expect(validateWorkspaceSlug("moa-team")).toBeNull();
    expect(validateWorkspaceSlug("모아팀")).toMatch(/영문/);
    expect(validateWorkspaceSlug("ab")).toMatch(/영문/);
  });

  it("keeps reserved slug and duplicate reason generic", () => {
    expect(RESERVED_WORKSPACE_SLUGS.has("login")).toBe(true);
    expect(validateWorkspaceSlug("login")).toBe("이 회사 주소는 사용할 수 없어요.");
    expect(parseWorkspaceRequest({ kind: "create", displayName: "모아", slug: "login" })).toEqual({ ok: false, message: "이 회사 주소는 사용할 수 없어요." });
  });

  it("separates pending request actions from membership grants", () => {
    expect(parseWorkspaceRequest({ kind: "join", lookup: "alpha-team", requestId: "20000000-0000-4000-8000-000000000002" })).toMatchObject({ ok: true, input: { kind: "join", lookup: "alpha-team" } });
    expect(parseWorkspaceRequest({ kind: "join", lookup: "INVITE-OPAQUE-24", requestId: "30000000-0000-4000-8000-000000000003" })).toMatchObject({ ok: true, input: { kind: "join", lookup: "INVITE-OPAQUE-24" } });
    expect(parseWorkspaceRequest({ kind: "cancel", requestId: "10000000-0000-4000-8000-000000000001" })).toMatchObject({ ok: true, input: { kind: "cancel" } });
    expect(parseWorkspaceRequest({ kind: "select_workspace", workspaceId: "server-row" })).toMatchObject({ ok: true, input: { kind: "select_workspace" } });
  });

  it("reserves every current top-level route, including route-group children", () => {
    const appRoot = join(process.cwd(), "src", "app");
    const topLevel = new Set<string>();
    for (const entry of readdirSync(appRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith("(")) {
        for (const child of readdirSync(join(appRoot, entry.name), { withFileTypes: true })) {
          if (child.isDirectory() && !child.name.startsWith("[") && !child.name.startsWith("(")) topLevel.add(child.name);
        }
      } else if (!entry.name.startsWith("[")) topLevel.add(entry.name);
    }
    for (const route of topLevel) expect(RESERVED_WORKSPACE_SLUGS, `unreserved route: ${route}`).toContain(route);
    for (const explicit of ["_next", "w", "api", "auth", "login", "platform", "workspace-entry", "workspaces"]) {
      expect(RESERVED_WORKSPACE_SLUGS).toContain(explicit);
    }
  });

  it("matches the DB reserved slug contract exactly", () => {
    const sql = readFileSync(join(process.cwd(), "..", "supabase", "migrations", "006_public_workspace_entry.sql"), "utf8");
    const block = sql.match(/slug not in \(([\s\S]*?)\)/)?.[1];
    expect(block).toBeTruthy();
    const dbReserved = new Set(Array.from(block!.matchAll(/'([^']+)'/g), (match) => match[1]));
    expect([...RESERVED_WORKSPACE_SLUGS].sort()).toEqual([...dbReserved].sort());
  });

  it("keeps slug and invite-code lookup shapes behind one neutral field", () => {
    for (const [lookup, requestId] of [["alpha-team", "40000000-0000-4000-8000-000000000004"], ["INVITE-OPAQUE-24", "50000000-0000-4000-8000-000000000005"]]) {
      const parsed = parseWorkspaceRequest({ kind: "join", lookup, requestId });
      expect(parsed).toMatchObject({ ok: true, input: { kind: "join", lookup } });
    }
    expect(parseWorkspaceRequest({ kind: "join", lookup: "" })).toEqual({ ok: false, message: "요청을 확인할 수 없어요." });
  });

  it("accepts only a kind-bound canonical UUID resume helper", () => {
    expect(workspaceEntryResumeValue("join", "10000000-0000-4000-8000-000000000001")).toBe("join.10000000-0000-4000-8000-000000000001");
    expect(parseWorkspaceEntryResume("create.20000000-0000-4000-8000-000000000002")).toEqual({ kind: "create", requestId: "20000000-0000-4000-8000-000000000002" });
    for (const value of ["join.not-a-uuid", "other.10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000001"]) expect(parseWorkspaceEntryResume(value)).toBeNull();
  });
});
