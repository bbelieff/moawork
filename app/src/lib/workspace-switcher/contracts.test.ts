import { describe, expect, it } from "vitest";
import { WORKSPACE_SWITCHER_DESTINATIONS } from "./contracts";

describe("workspace switcher destinations", () => {
  it("uses B3 canonical create and resume modes without target intent", () => {
    expect(WORKSPACE_SWITCHER_DESTINATIONS).toEqual({
      createWorkspaceHref: "/workspace-entry?mode=new",
      joinWorkspaceHref: "/workspace-entry?mode=resume",
    });
    expect(WORKSPACE_SWITCHER_DESTINATIONS.createWorkspaceHref).not.toContain("request");
    expect(WORKSPACE_SWITCHER_DESTINATIONS.joinWorkspaceHref).not.toContain("request");
  });
});
