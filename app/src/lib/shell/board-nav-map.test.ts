import { describe, expect, it, vi } from "vitest";

import { boardNavKeysFrom, loadBoardNavKeys } from "./board-nav-map";
import { TAB_SOURCE_NAV_KEY } from "@/components/shell/active-nav";
import type { Board } from "@/lib/boards/types";
import type { Ctx } from "@/lib/types";

/**
 * 사이드바가 «지금 이 보드가 어느 탭인가» 를 아는 지도 (#588 ⑥).
 *
 * ★ 이 파일이 사이드바 활성 표시의 뿌리인데 검사가 0건이었다.
 *   특히 아래 세 번째 — 「못 읽어도 셸이 안 죽는다」는 주석에만 있고
 *   아무도 재지 않았다. 셸은 «모든 화면의 뼈대» 라 여기서 던지면 앱 전체가 500 이다.
 */
const ctx = { user: { id: "u" }, org: { id: "org-1" }, role: "owner", scope: "all" } as Ctx;

function board(id: string, source: string | null): Board {
  return { id, org_id: "org-1", name: id, source } as unknown as Board;
}

const NEW_LEAD_SOURCE = Object.keys(TAB_SOURCE_NAV_KEY)[0];

describe("보드 → 탭 지도", () => {
  it("기본 탭인 보드만 골라 id → 메뉴 키로 만든다", () => {
    const map = boardNavKeysFrom([board("b-1", NEW_LEAD_SOURCE)]);
    expect(map).toEqual({ "b-1": TAB_SOURCE_NAV_KEY[NEW_LEAD_SOURCE] });
  });

  it("★ 기본 탭이 아닌 보드는 안 넣는다 — 넣으면 아무 보드에서나 탭이 켜진 것처럼 보인다", () => {
    expect(boardNavKeysFrom([board("b-2", "custom.something")])).toEqual({});
    expect(boardNavKeysFrom([board("b-3", null)])).toEqual({});
    expect(boardNavKeysFrom([])).toEqual({});
  });

  it("네 기본 탭을 모두 담는다", () => {
    const boards = Object.keys(TAB_SOURCE_NAV_KEY).map((source, i) => board(`b-${i}`, source));
    expect(Object.keys(boardNavKeysFrom(boards))).toHaveLength(Object.keys(TAB_SOURCE_NAV_KEY).length);
  });

  it("보드를 읽어 지도를 만든다", async () => {
    const repo = { listBoards: vi.fn(async () => [board("b-1", NEW_LEAD_SOURCE)]) };
    await expect(loadBoardNavKeys(ctx, repo)).resolves.toEqual({
      "b-1": TAB_SOURCE_NAV_KEY[NEW_LEAD_SOURCE],
    });
  });

  /**
   * ★ 이것이 이 파일에서 제일 중요한 검사다.
   *   셸은 모든 화면의 뼈대라, 여기서 예외가 새면 «앱 전체가 500» 이 된다.
   *   활성 표시가 안 되는 것과 앱이 안 열리는 것은 비교할 수 없는 차이다.
   */
  it("★ 못 읽어도 던지지 않는다 — 빈 지도를 준다. 셸이 통째로 죽으면 안 된다", async () => {
    const repo = { listBoards: vi.fn(async () => { throw new Error("db down"); }) };
    await expect(loadBoardNavKeys(ctx, repo)).resolves.toEqual({});
  });
});
