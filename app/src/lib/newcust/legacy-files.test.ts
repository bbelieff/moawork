import { describe, expect, it } from "vitest";
import { normalizeLegacyFiles } from "./legacy-files";

const valid = { storage_path: "org-a/deals/a.pdf", name: "a.pdf", size_bytes: 7, mime_type: "application/pdf" };

describe("normalizeLegacyFiles", () => {
  it("org 내부 storage path만 file cell shape로 변환한다", () => {
    expect(normalizeLegacyFiles("org-a", [valid])).toEqual({ ok: true, value: [{ path: valid.storage_path, name: valid.name, size: 7, mime: valid.mime_type }] });
  });
  it("inline, cross-org, 외부 URL 및 임의 key를 거부한다", () => {
    expect(normalizeLegacyFiles("org-a", [{ ...valid, storage_path: undefined, data_url: "data:x" }])).toEqual({ ok: false, reason: "inline_only" });
    expect(normalizeLegacyFiles("org-a", [{ ...valid, storage_path: "org-b/a.pdf" }])).toEqual({ ok: false, reason: "cross_org_path" });
    expect(normalizeLegacyFiles("org-a", [{ ...valid, storage_path: "https://example.com/a" }])).toEqual({ ok: false, reason: "cross_org_path" });
    expect(normalizeLegacyFiles("org-a", [{ ...valid, url: "secret" }])).toEqual({ ok: false, reason: "malformed" });
  });
  it("rejects duplicate paths and unsafe or fractional sizes", () => {
    expect(normalizeLegacyFiles("org-a", [valid, valid])).toEqual({ ok: false, reason: "malformed" });
    expect(normalizeLegacyFiles("org-a", [{ ...valid, size_bytes: 1.5 }])).toEqual({ ok: false, reason: "malformed" });
    expect(normalizeLegacyFiles("org-a", [{ ...valid, size_bytes: Number.MAX_SAFE_INTEGER + 1 }])).toEqual({ ok: false, reason: "malformed" });
  });
});
