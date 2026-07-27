import { describe, expect, it } from "vitest";
import { decideWorkspaceEntryPage } from "./route-decision";

const membership = (slug: string) => ({ slug });
const base = {
  authState: "ready" as const,
  memberships: [] as { slug: string }[],
  resumeTarget: { kind: "none" as const },
  selfState: "eligible" as const,
  isPlatformAdmin: false,
};

describe("workspace entry page precedence", () => {
  it("never lets mode=new bypass verified active membership routing", () => {
    expect(decideWorkspaceEntryPage({ ...base, mode: "new", memberships: [membership("alpha-team")] })).toEqual({ kind: "redirect", path: "/w/alpha-team" });
    expect(decideWorkspaceEntryPage({ ...base, mode: "new", memberships: [membership("alpha-team"), membership("beta-team")] })).toEqual({ kind: "redirect", path: "/workspaces" });
  });

  it("falls back to current 1/2+ routing when resume has no bound target", () => {
    expect(decideWorkspaceEntryPage({ ...base, mode: "resume", memberships: [membership("alpha-team")] })).toEqual({ kind: "redirect", path: "/w/alpha-team" });
    expect(decideWorkspaceEntryPage({ ...base, mode: "resume", memberships: [membership("alpha-team"), membership("beta-team")] })).toEqual({ kind: "redirect", path: "/workspaces" });
  });

  it("uses a uniquely verified accepted target before the ordinary 2+ chooser", () => {
    expect(decideWorkspaceEntryPage({ ...base, mode: "resume", memberships: [membership("alpha-team"), membership("beta-team")], resumeTarget: { kind: "workspace", slug: "beta-team" } })).toEqual({ kind: "redirect", path: "/w/beta-team" });
    expect(decideWorkspaceEntryPage({ ...base, mode: "resume", memberships: [membership("alpha-team"), membership("beta-team")], resumeTarget: { kind: "invalid" } })).toEqual({ kind: "render", view: "blocked" });
  });

  it("keeps errors, unknown self state, and inactive self state account-safe", () => {
    expect(decideWorkspaceEntryPage({ ...base, authState: "error" })).toEqual({ kind: "render", view: "blocked" });
    expect(decideWorkspaceEntryPage({ ...base, selfState: "unknown" })).toEqual({ kind: "render", view: "blocked" });
    expect(decideWorkspaceEntryPage({ ...base, selfState: "blocked_inactive" })).toEqual({ kind: "render", view: "blocked" });
    expect(decideWorkspaceEntryPage({ ...base, hasRoutingError: true })).toEqual({ kind: "render", view: "blocked" });
  });

  it("shows operator control-plane only for eligible active=0", () => {
    expect(decideWorkspaceEntryPage({ ...base, isPlatformAdmin: true })).toEqual({ kind: "redirect", path: "/platform/workspace-requests" });
    expect(decideWorkspaceEntryPage({ ...base, isPlatformAdmin: true, selfState: "blocked_inactive" })).toEqual({ kind: "render", view: "blocked" });
    expect(decideWorkspaceEntryPage({ ...base, isPlatformAdmin: true, memberships: [membership("alpha-team")] })).toEqual({ kind: "redirect", path: "/w/alpha-team" });
  });
});
