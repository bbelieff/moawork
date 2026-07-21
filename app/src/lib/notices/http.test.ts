import { describe, expect, it } from "vitest";
import { NotFoundError, BoardRuleError } from "@/lib/boards";
import { UnauthorizedError } from "@/lib/crm/context";
import { NoticeRuleError } from "./service";
import {
  NoticeInputError,
  parseNewNotice,
  parseNoticePatch,
  toNoticeErrorResponse,
} from "./http";

describe("parseNewNotice", () => {
  it("제목만 있으면 통과한다", () => {
    expect(parseNewNotice({ title: "공지" }).title).toBe("공지");
  });

  it("제목이 없거나 공백이면 거부", () => {
    expect(() => parseNewNotice({})).toThrow(NoticeInputError);
    expect(() => parseNewNotice({ title: "   " })).toThrow(NoticeInputError);
  });

  it("객체가 아니면 거부", () => {
    expect(() => parseNewNotice("x")).toThrow(NoticeInputError);
    expect(() => parseNewNotice(null)).toThrow(NoticeInputError);
    expect(() => parseNewNotice([])).toThrow(NoticeInputError);
  });

  it("허용되지 않은 분류를 거부한다", () => {
    expect(() => parseNewNotice({ title: "t", categoryId: "없는분류" })).toThrow(
      NoticeInputError,
    );
  });

  it("빈 분류는 null 로 수렴", () => {
    expect(parseNewNotice({ title: "t", categoryId: "" }).categoryId).toBeNull();
  });

  it("날짜 형식을 강제한다", () => {
    expect(() => parseNewNotice({ title: "t", publishedAt: "2026/07/21" })).toThrow(
      NoticeInputError,
    );
    expect(parseNewNotice({ title: "t", publishedAt: "2026-07-21" }).publishedAt).toBe(
      "2026-07-21",
    );
  });

  it("pinned 는 boolean 만 받는다", () => {
    expect(() => parseNewNotice({ title: "t", pinned: "yes" })).toThrow(NoticeInputError);
    expect(parseNewNotice({ title: "t", pinned: true }).pinned).toBe(true);
  });
});

describe("parseNoticePatch", () => {
  it("전달된 키만 담는다", () => {
    const patch = parseNoticePatch({ pinned: true });
    expect(patch).toEqual({ pinned: true });
    expect("title" in patch).toBe(false);
    expect("body" in patch).toBe(false);
  });

  it("빈 패치는 거부한다", () => {
    expect(() => parseNoticePatch({})).toThrow(NoticeInputError);
  });

  it("제목을 빈 값으로 바꾸려 하면 거부", () => {
    expect(() => parseNoticePatch({ title: "  " })).toThrow(NoticeInputError);
  });

  it("body 를 빈 문자열로 비우는 것은 허용", () => {
    expect(parseNoticePatch({ body: "" })).toEqual({ body: "" });
  });

  it("publishedAt 을 null 로 비우는 것은 허용", () => {
    expect(parseNoticePatch({ publishedAt: null })).toEqual({ publishedAt: null });
  });
});

describe("toNoticeErrorResponse", () => {
  it("도메인 에러를 상태코드로 매핑한다", () => {
    expect(toNoticeErrorResponse(new UnauthorizedError()).status).toBe(401);
    expect(toNoticeErrorResponse(new NotFoundError()).status).toBe(404);
    expect(toNoticeErrorResponse(new NoticeInputError("x")).status).toBe(400);
    expect(toNoticeErrorResponse(new NoticeRuleError("x")).status).toBe(400);
    expect(toNoticeErrorResponse(new BoardRuleError("x")).status).toBe(400);
    expect(toNoticeErrorResponse(new Error("boom")).status).toBe(500);
  });

  it("보드 엔진 NotFound 가 500 으로 새지 않는다(crm 매퍼와의 차이)", () => {
    expect(toNoticeErrorResponse(new NotFoundError("공지 없음")).status).toBe(404);
  });
});
