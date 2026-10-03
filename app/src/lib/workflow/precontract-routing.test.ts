import { describe, expect, it } from "vitest";
import {
  CONSULTATION_CANONICAL_PATH,
  CONSULTATION_LEGACY_PATHS,
  CONSULTATION_VIEW_IDS,
  PRECONTRACT_MENU_IDS,
  resolveConsultationRoute,
} from "./precontract-routing";

describe("pre-contract route compatibility", () => {
  it("uses stable menu and view identifiers", () => {
    expect(PRECONTRACT_MENU_IDS).toEqual(["new-lead", "consultation"]);
    expect(CONSULTATION_VIEW_IDS).toEqual(["all", "remote", "inperson", "unspecified"]);
  });

  it.each([
    [CONSULTATION_CANONICAL_PATH, "all", "/contract", false],
    [CONSULTATION_LEGACY_PATHS.remote, "remote", "/contract?consultation=remote", true],
    [CONSULTATION_LEGACY_PATHS.inperson, "inperson", "/contract?consultation=inperson", true],
  ] as const)("maps %s to the same consultation menu", (href, viewId, canonicalHref, legacyAlias) => {
    expect(resolveConsultationRoute(href)).toEqual({
      menuId: "consultation",
      viewId,
      canonicalHref,
      legacyAlias,
    });
  });

  it("preserves safe saved-view state while canonicalizing a legacy bookmark", () => {
    const resolved = resolveConsultationRoute(
      "/consult-inperson?savedView=team-view&view=flat&group=owner&mwFocus=status#item-1",
    );
    expect(resolved?.canonicalHref).toBe(
      "/contract?savedView=team-view&view=flat&group=owner&mwFocus=status&consultation=inperson#item-1",
    );
  });

  it("keeps malformed modes neutral instead of inventing a remote consultation", () => {
    expect(resolveConsultationRoute("/contract?consultation=unexpected&savedView=team-view")).toEqual({
      menuId: "consultation",
      viewId: "unspecified",
      canonicalHref: "/contract?savedView=team-view",
      legacyAlias: false,
    });
  });

  it("rejects external and unrelated destinations", () => {
    expect(resolveConsultationRoute("https://example.com/contract?savedView=mine")).toBeNull();
    expect(resolveConsultationRoute("//example.com/contract")).toBeNull();
    expect(resolveConsultationRoute("/\\example.com/contract")).toBeNull();
    expect(resolveConsultationRoute("/work?savedView=mine")).toBeNull();
  });
});
