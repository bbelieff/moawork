import { describe, expect, it } from "vitest";
import { safeNextPath } from "./oauth";

describe("safeNextPath", () => {
  it("앱 내부 경로와 쿼리를 보존한다", () => {
    expect(safeNextPath("/deals/1?tab=files#top")).toBe(
      "/deals/1?tab=files#top",
    );
  });

  it("외부·프로토콜 상대·잘못된 경로는 홈으로 회수한다", () => {
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example/path")).toBe("/");
    expect(safeNextPath("javascript:alert(1)")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });
});
