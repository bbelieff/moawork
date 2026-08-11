import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("platform operation page composition", () => {
  it("routes all four tabs through the operation contract page", () => {
    for (const section of ["billing", "access", "support", "admins"] as const) {
      const source = readFileSync(
        new URL(`../${section}/page.tsx`, import.meta.url),
        "utf8",
      );
      expect(source).toContain("PlatformOperationPage");
      expect(source).toContain(`section=\"${section}\"`);
      expect(source).toContain(`pathname=\"/platform/${section}\"`);
    }
  });

  it("checks the canonical platform guard before loading operation data", () => {
    const source = readFileSync(new URL("./PlatformOperationPage.tsx", import.meta.url), "utf8");
    expect(source.indexOf("await requirePlatformAccess(pathname)")).toBeGreaterThan(-1);
    expect(source.indexOf("await requirePlatformAccess(pathname)")).toBeLessThan(
      source.indexOf("await loadPlatformOperationSnapshot(section)"),
    );
    expect(source).toContain("관리자 모드는 회사 데이터 접근 권한을 새로 만들지 않아요.");
  });
});
