import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "./nav-items";
import { workspaceHref } from "./workspace-href";

describe("workspaceHref", () => {
  it("keeps every product tab inside the verified workspace namespace", () => {
    const links = NAV_ITEMS.flatMap((item) => item.href ? [workspaceHref("/w/test", item.href)] : []);
    expect(links).toContain("/w/test");
    expect(links).toContain("/w/test/notices");
    expect(links).toContain("/w/test/companies");
    expect(links).toContain("/w/test/contract");
    expect(links.every((href) => href === "/w/test" || href.startsWith("/w/test/"))).toBe(true);
  });

  it("fails closed for an unverified base and never accepts protocol-relative hrefs", () => {
    expect(workspaceHref("/w/test/../other", "/notices")).toBe("/notices");
    expect(workspaceHref("/w/test", "//evil.invalid/path")).toBe("//evil.invalid/path");
  });
});
