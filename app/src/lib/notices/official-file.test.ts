import { describe, expect, it } from "vitest";
import { encodeNoticeFile, parseNoticeFile } from "./official-file";

describe("notice official PDF boundary", () => {
  it("reuses BBE-16 validation and keeps bytes behind metadata", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "notice.pdf", { type: "application/pdf" });
    const stored = await encodeNoticeFile(file);
    expect(stored).toMatchObject({ name: "notice.pdf", mimeType: "application/pdf", size: 3 });
    expect(parseNoticeFile(JSON.stringify(stored))).toEqual(stored);
    expect(parseNoticeFile("not-json")).toBeNull();
  });
  it("rejects the same unsafe extension as the BBE-16 boundary", async () => {
    await expect(encodeNoticeFile(new File(["x"], "attack.exe"))).rejects.toThrow();
  });
});
