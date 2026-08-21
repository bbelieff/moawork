import { describe, expect, it } from "vitest";
import { newColumnTemplateRequestId } from "./column-template-request";

describe("ColumnTemplateLibrary request receipts", () => {
  it("issues a fresh id for every independent user command", () => {
    const ids = [
      newColumnTemplateRequestId(() => "00000000-0000-4000-8000-000000000001"),
      newColumnTemplateRequestId(() => "00000000-0000-4000-8000-000000000002"),
    ];
    expect(ids).toEqual([
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ]);
    expect(new Set(ids)).toHaveLength(2);
  });
});
