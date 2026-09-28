import { describe, expect, it } from "vitest";
import { relativeRedirect } from "./relative-redirect";

describe("app-relative redirect", () => {
  it("retains the browser origin and supports cookie mutations", () => {
    const response = relativeRedirect("/mode?next=%2Faccount#tab");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/mode?next=%2Faccount#tab");
    for (const origin of ["https://www.moa-work.com", "http://localhost:3000", "http://127.0.0.1:13100"]) {
      expect(new URL(response.headers.get("location")!, origin).origin).toBe(origin);
    }
    response.cookies.set("fixture", "value");
    expect(response.headers.get("set-cookie")).toContain("fixture=value");
    expect(relativeRedirect("/login", 303).status).toBe(303);
  });
  it("rejects external, scheme-relative, backslash, control and normalized authority escapes", () => {
    for (const value of ["https://evil.example/", "//evil.example/", "/\\evil.example",
      "/a/..//evil.example", "/%2e%2e//evil.example", "/%5cevil", "/\r\nLocation:bad", "/%0d%0aevil", " /login"]) {
      expect(() => relativeRedirect(value), value).toThrow("Unsafe relative redirect");
    }
  });
});
