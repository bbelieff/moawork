// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { APPEARANCE_DEFAULT } from "@/lib/appearance/vivid";
import { APPEARANCE_CHANGE_EVENT, applyAppearancePreference, readAppearancePreference, storeAppearancePreference } from "./RouteAppearance";

vi.mock("next/navigation", () => ({ usePathname: () => "/w/sample-lab" }));

afterEach(() => {
  vi.restoreAllMocks();
  storeAppearancePreference(APPEARANCE_DEFAULT);
});

describe("appearance storage failure", () => {
  it("keeps the selected appearance after same-tab listeners synchronize when persistence fails", () => {
    storeAppearancePreference(APPEARANCE_DEFAULT);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Blocked", "QuotaExceededError"); });
    const sync = () => applyAppearancePreference(readAppearancePreference());
    window.addEventListener(APPEARANCE_CHANGE_EVENT, sync);
    try {
      storeAppearancePreference({ preset: "coral", effects: "off" });
      expect(readAppearancePreference()).toEqual({ preset: "coral", effects: "off" });
      expect(document.documentElement.dataset.moaTheme).toBe("coral");
      expect(document.documentElement.dataset.mwEffects).toBe("off");
    } finally {
      window.removeEventListener(APPEARANCE_CHANGE_EVENT, sync);
    }
  });
});
