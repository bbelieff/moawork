import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceLink } from "./WorkspaceLink";

let pathname = "/w/acme/boards/b1";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: React.ReactNode }) => <a href={href}>{children}</a>,
}));

function renderHref(href: string) {
  return renderToStaticMarkup(<WorkspaceLink href={href}>합성 보기</WorkspaceLink>);
}

describe("WorkspaceLink — 워크스페이스 뿌리 아래로 보낸다", () => {
  it("지금 주소의 뿌리를 앞에 붙인다", () => {
    pathname = "/w/acme/boards/b1";
    expect(renderHref("/boards/b2?view=kanban")).toContain('href="/w/acme/boards/b2?view=kanban"');
  });

  it("뿌리가 없으면 받은 주소 그대로 둔다", () => {
    pathname = "/boards/b1";
    expect(renderHref("/boards/b2?view=kanban")).toContain('href="/boards/b2?view=kanban"');
  });

  it("규칙에 맞지 않는 뿌리도 그대로 둔다", () => {
    pathname = "/w/UPPER/boards/b1";
    expect(renderHref("/boards/b2?view=kanban")).toContain('href="/boards/b2?view=kanban"');
  });

  it("이미 워크스페이스 주소면 뿌리를 두 번 붙이지 않는다", () => {
    pathname = "/w/acme/boards/b1";
    expect(renderHref("/w/acme/boards/b2")).toContain('href="/w/acme/boards/b2"');
  });
});
