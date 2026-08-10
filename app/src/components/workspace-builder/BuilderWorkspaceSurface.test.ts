import { describe, expect, it } from "vitest";
import { parseDeidentifiedCsvPreview } from "./BuilderWorkspaceSurface";

describe("workspace builder local CSV preview", () => {
  it("counts well-shaped deidentified rows without persisting them", () => {
    expect(parseDeidentifiedCsvPreview("external_id,name\nrow-1,Example\nrow-2,Another")).toEqual({ rows: 2, quarantined: 0 });
  });

  it("quarantines rows whose column shape does not match the header", () => {
    expect(parseDeidentifiedCsvPreview("external_id,name\nrow-1,Example\nrow-2")).toEqual({ rows: 1, quarantined: 1 });
  });
});
