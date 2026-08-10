import { describe, expect, it } from "vitest";
import { DUE_DATE_COLUMN, LEGACY_WORK_COLUMNS, structureFingerprint, validateLegacyTemplate, WORK_COLUMNS, WORK_TEMPLATE } from "./template";

describe("work template", () => {
  it("keeps the exact 31-column legacy contract and aliases", () => {
    expect(validateLegacyTemplate(LEGACY_WORK_COLUMNS)).toEqual([]);
    expect(LEGACY_WORK_COLUMNS).toHaveLength(31);
    expect(LEGACY_WORK_COLUMNS[16]).toMatchObject({ key: "workflow_status", label: "진행상황", sourceAliases: ["진행상항"] });
    expect(LEGACY_WORK_COLUMNS[24].sourceAliases).toEqual(["수수료_입금일"]);
    expect(LEGACY_WORK_COLUMNS[30].sourceAliases).toEqual(["계약금_입금일"]);
  });

  it("inserts visible due date outside the legacy fingerprint", () => {
    expect(WORK_COLUMNS).toHaveLength(32);
    expect(WORK_COLUMNS[17]).toEqual(DUE_DATE_COLUMN);
    expect(WORK_TEMPLATE.baselineFingerprint).toBe(structureFingerprint(LEGACY_WORK_COLUMNS));
    expect(WORK_TEMPLATE.baselineFingerprint).not.toBe(structureFingerprint(WORK_COLUMNS));
  });
});

