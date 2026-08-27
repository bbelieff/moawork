import { describe, expect, it } from "vitest";
import {
  OTHER_INFO_KEYS,
  checkedOtherInfoCount,
  emptyOtherInfoValue,
  matchesOtherInfoFacet,
  matchesOtherInfoFacets,
  otherInfoCountLabel,
  otherInfoFacetState,
  projectOtherInfoValue,
  updateOtherInfoEntry,
} from "./structured-field";

describe("Issue #601 structured other-info contract", () => {
  it("creates a versioned value with exactly five stable entries", () => {
    const value = emptyOtherInfoValue();

    expect(value.version).toBe(1);
    expect(Object.keys(value).sort()).toEqual(["version", ...OTHER_INFO_KEYS].sort());
    for (const key of OTHER_INFO_KEYS) expect(value[key]).toEqual({ checked: false, text: "" });
  });

  it("counts checked entries from 0건 through 5건", () => {
    let value = emptyOtherInfoValue();
    expect(otherInfoCountLabel(value)).toBe("0건");
    for (const [index, key] of OTHER_INFO_KEYS.entries()) {
      value = updateOtherInfoEntry(value, key, { checked: true });
      expect(checkedOtherInfoCount(value)).toBe(index + 1);
      expect(otherInfoCountLabel(value)).toBe(`${index + 1}건`);
    }
  });

  it("preserves text when an entry is unchecked", () => {
    const checked = updateOtherInfoEntry(emptyOtherInfoValue(), "certifications", {
      checked: true,
      text: "벤처기업 인증",
    });
    const unchecked = updateOtherInfoEntry(checked, "certifications", { checked: false });

    expect(unchecked.certifications).toEqual({ checked: false, text: "벤처기업 인증" });
  });

  it("projects legacy select values without inventing the other three entries", () => {
    const projection = projectOtherInfoValue(null, {
      closed_business: "폐업",
      export_status: "수출 예정",
    });

    expect(projection.source).toBe("legacy");
    expect(projection.value.closedHistory).toEqual({ checked: true, text: "폐업" });
    expect(projection.value.export).toEqual({ checked: true, text: "수출 예정" });
    expect(projection.present.intellectualProperty).toBe(false);
    expect(otherInfoFacetState(null, "intellectualProperty", { closed_business: "폐업" })).toBe("missing");
  });

  it("keeps missing, unchecked, and checked as distinct facet states", () => {
    const empty = emptyOtherInfoValue();
    const checked = updateOtherInfoEntry(empty, "otherBusinesses", { checked: true });

    expect(otherInfoFacetState(null, "otherBusinesses")).toBe("missing");
    expect(otherInfoFacetState(empty, "otherBusinesses")).toBe("false");
    expect(otherInfoFacetState(checked, "otherBusinesses")).toBe("true");
    expect(matchesOtherInfoFacet(null, "otherBusinesses", ["missing", "true"])).toBe(true);
    expect(matchesOtherInfoFacet(empty, "otherBusinesses", ["missing", "true"])).toBe(false);
    expect(matchesOtherInfoFacet(checked, "otherBusinesses", ["missing", "true"])).toBe(true);
  });

  it("ORs states within one facet and ANDs separate facets", () => {
    let value = updateOtherInfoEntry(emptyOtherInfoValue(), "export", { checked: true });
    value = updateOtherInfoEntry(value, "certifications", { checked: false });

    expect(matchesOtherInfoFacets(value, {
      export: ["missing", "true"],
      certifications: ["false"],
    })).toBe(true);
    expect(matchesOtherInfoFacets(value, {
      export: ["missing", "true"],
      certifications: ["true"],
    })).toBe(false);
  });

  it("fails closed to missing for malformed structured input", () => {
    const projection = projectOtherInfoValue({
      version: 1,
      export: { checked: "yes", text: "수출 중" },
    });

    expect(projection.source).toBe("missing");
    expect(otherInfoFacetState(projection.value, "export")).toBe("false");
  });

  it("does not accept a partial v1 object as a migrated structured value", () => {
    const projection = projectOtherInfoValue({
      version: 1,
      export: { checked: true, text: "수출 중" },
    });

    expect(projection.source).toBe("missing");
    expect(projection.present.export).toBe(false);
  });
});
