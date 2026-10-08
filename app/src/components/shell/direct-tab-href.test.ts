import { describe, expect, it } from "vitest";
import { directBoardHref } from "./direct-tab-href";

describe("Issue 857 — 기본 탭 메뉴는 보드가 딱 하나면 그 보드로 바로 간다", () => {
  const nav = { "board-new": "new", "board-contact": "contact", "board-work": "work", "board-user": "board:board-user" };

  it("신규리드·계약업체 실무는 그 보드 주소", () => {
    expect(directBoardHref("new", nav)).toBe("/boards/board-new");
    expect(directBoardHref("work", nav)).toBe("/boards/board-work");
  });

  it("상담 두 메뉴는 리드컨택 보드의 상담 보기", () => {
    expect(directBoardHref("consult-remote", nav)).toBe("/boards/board-contact?consultation=remote");
    expect(directBoardHref("consult-inperson", nav)).toBe("/boards/board-contact?consultation=inperson");
  });

  it("보드가 없거나 둘 이상이면 경유지에 맡긴다", () => {
    expect(directBoardHref("notice", nav)).toBeNull();
    expect(directBoardHref("new", { a: "new", b: "new" })).toBeNull();
    expect(directBoardHref("new", undefined)).toBeNull();
  });

  it("기본 탭이 아닌 메뉴는 바꾸지 않는다", () => {
    expect(directBoardHref("company", nav)).toBeNull();
    expect(directBoardHref("dash", nav)).toBeNull();
  });
});
