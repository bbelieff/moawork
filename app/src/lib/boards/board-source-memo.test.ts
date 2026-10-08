import { beforeEach, describe, expect, it } from "vitest";
import { recallBoardSource, rememberBoardSource, resetBoardSourceMemo } from "./board-source-memo";

beforeEach(() => resetBoardSourceMemo());

describe("Issue 857 · 보드 종류 기억", () => {
  it("본 적 없는 보드는 모른다(undefined), 종류 없음은 null 로 기억한다", () => {
    expect(recallBoardSource("board-a")).toBeUndefined();
    rememberBoardSource("board-a", "core.default-tab/contract-work");
    rememberBoardSource("board-b", undefined);
    expect(recallBoardSource("board-a")).toBe("core.default-tab/contract-work");
    expect(recallBoardSource("board-b")).toBeNull();
  });

  it("새 값으로 바로잡히고, 개수 상한을 넘으면 비우고 다시 시작한다", () => {
    rememberBoardSource("board-a", "core.default-tab/new-lead");
    rememberBoardSource("board-a", "core.default-tab/contact");
    expect(recallBoardSource("board-a")).toBe("core.default-tab/contact");
    for (let index = 0; index < 5000; index += 1) rememberBoardSource(`board-${index}`, null);
    rememberBoardSource("board-new", "x");
    expect(recallBoardSource("board-1")).toBeUndefined();
    expect(recallBoardSource("board-new")).toBe("x");
  });
});
