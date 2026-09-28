import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";
import { ORG_LOGO_MAX_BYTES } from "@/lib/org-logo/contracts";
import { MAX_FILE_BYTES } from "@/lib/services/file-contract";
import { validateUpload } from "@/lib/services/files";

const OLD_LIMIT_BYTES = 6 * 1024 * 1024;
const NEXT_LIMIT_BYTES = 16 * 1024 * 1024;

describe("Server Action upload envelope", () => {
  it("keeps the finite Next limit aligned with advertised product limits", () => {
    const serverActions = nextConfig.experimental?.serverActions as
      | { bodySizeLimit?: string }
      | undefined;

    expect(serverActions?.bodySizeLimit).toBe("16mb");
    expect(MAX_FILE_BYTES).toBe(10 * 1024 * 1024);
    expect(ORG_LOGO_MAX_BYTES).toBe(4 * 1024 * 1024);
    expect(validateUpload({ name: "max.pdf", size_bytes: MAX_FILE_BYTES }).ok).toBe(true);
    expect(validateUpload({ name: "over.pdf", size_bytes: MAX_FILE_BYTES + 1 }).ok).toBe(false);
  });

  it("fits a representative exact-10MiB multipart request above the old 6MiB ceiling", async () => {
    const form = new FormData();
    form.set("boardId", "board-1");
    form.set("itemId", "item-1");
    form.set("columnKey", "attachment");
    form.set(
      "value",
      new File([new Uint8Array(MAX_FILE_BYTES)], "exact-10m.pdf", {
        type: "application/pdf",
      }),
    );

    const request = new Request("https://moa-work.invalid/action", {
      method: "POST",
      body: form,
    });
    const serializedBytes = (await request.arrayBuffer()).byteLength;

    expect(serializedBytes).toBeGreaterThan(OLD_LIMIT_BYTES);
    expect(serializedBytes).toBeLessThan(NEXT_LIMIT_BYTES);
  });
});
