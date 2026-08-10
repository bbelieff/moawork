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

  it("역슬래시·제어문자·인코딩 및 이중 인코딩 우회를 거부한다", () => {
    for (const value of [
      "/w/team\\admin",
      "/w/team/%2f%2fevil.example",
      "/w/team/%5cadmin",
      "/w/team/%252fadmin",
      "/w/team/%252e%252e/admin",
      "/w/team/%25252e%25252e/admin",
      "/w/team/%25252fapi",
      "/w/team/%00admin",
      "/w/team/%E0%A4%A",
    ]) expect(safeNextPath(value, "/safe")).toBe("/safe");
  });
});
