import { describe, expect, it } from "vitest";
import {
  decideModeDestination,
  decideModeMutation,
  decideUserModeDestination,
  parsePresentationMode,
  sanitizeModeNext,
} from "./contract";

const one = [{ orgId: "org-1", slug: "demo-team" }];

describe("mode contract", () => {
  it("shows the dedicated chooser only for a verified platform actor with no preference", () => {
    expect(decideModeDestination({ preference: null, platformAccess: "granted", memberships: [] }))
      .toEqual({ kind: "chooser", path: "/mode" });
    expect(decideModeDestination({ preference: null, platformAccess: "denied", memberships: one }))
      .toEqual({ kind: "workspace", path: "/w/demo-team" });
  });

  it("requires the canonical platform guard for the platform destination", () => {
    expect(decideModeDestination({ preference: "platform", platformAccess: "granted", memberships: [] }))
      .toEqual({ kind: "platform", path: "/platform" });
    expect(decideModeDestination({ preference: "platform", platformAccess: "denied", memberships: one }))
      .toEqual({ kind: "workspace", path: "/w/demo-team" });
    expect(decideModeDestination({ preference: "platform", platformAccess: "unavailable", memberships: [] }))
      .toEqual({ kind: "entry", path: "/workspace-entry" });
  });

  it("keeps verified user routing at zero, one, and multiple memberships", () => {
    expect(decideUserModeDestination([])).toEqual({ kind: "entry", path: "/workspace-entry" });
    expect(decideUserModeDestination(one)).toEqual({ kind: "workspace", path: "/w/demo-team" });
    expect(decideUserModeDestination([...one, { orgId: "org-2", slug: "other-team" }]))
      .toEqual({ kind: "workspaces", path: "/workspaces" });
  });

  it("fails closed for malformed membership identity and sanitizes return hints", () => {
    expect(decideUserModeDestination([{ orgId: "org-1", slug: "bad slug" }]))
      .toEqual({ kind: "fail-closed", path: "/workspace-entry?error=routing" });
    expect(parsePresentationMode("platform")).toBe("platform");
    expect(parsePresentationMode("owner")).toBeNull();
    expect(sanitizeModeNext("/account?tab=privacy")).toBe("/account?tab=privacy");
    expect(sanitizeModeNext("https://example.test")).toBeNull();
  });

  it("denies ordinary direct preference mutation and validates mode input", () => {
    expect(decideModeMutation("denied", "platform")).toEqual({ kind: "forbidden" });
    expect(decideModeMutation("unavailable", "platform")).toEqual({ kind: "unavailable" });
    expect(decideModeMutation("granted", "owner")).toEqual({ kind: "invalid" });
    expect(decideModeMutation("granted", "user")).toEqual({ kind: "accepted", mode: "user" });
  });
});
