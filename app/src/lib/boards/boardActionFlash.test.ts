import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BOARD_ACTION_FLASH_COOKIE,
  classifyRowMoveFailure,
  decodeBoardActionFlash,
  encodeBoardActionFlash,
  findBoardActionError,
  ROW_MOVE_FAILURE_MESSAGES,
  UserFacingActionError,
  userFacingMessage,
} from "./boardActionFlash";

// BBE-201 — 플래시 자체의 성질 + «그 값이 화면까지 도달하는가».
//
// ★ 배선 검사를 함께 두는 이유: 이 저장소가 반복하는 병이 「부품은 만들어 놓고 배선을 안 한다」다.
//   오류를 쿠키에 담아 놓고 화면이 안 읽으면, 사용자에게는 «아무 일도 안 일어난» 것으로 보인다 —
//   전면 오류 화면보다 더 나쁘다. 그래서 «이름이 파일에 있는가» 가 아니라
//   «디코드한 값이 실제로 렌더까지 흘러가는가» 를 본다 (BBE-199 A9 에서 배운 것).

describe("boardActionFlash — 인코딩 성질", () => {
  it("왕복한다", () => {
    const encoded = encodeBoardActionFlash({ boardId: "board-1", message: "권한이 없어요." });
    expect(decodeBoardActionFlash(encoded)).toEqual({ boardId: "board-1", message: "권한이 없어요." });
  });

  it("다른 보드의 오류는 표시하지 않는다", () => {
    const flash = decodeBoardActionFlash(encodeBoardActionFlash({ boardId: "board-1", message: "실패" }));
    expect(findBoardActionError(flash, "board-1")).toBe("실패");
    expect(findBoardActionError(flash, "board-2")).toBeNull();
  });

  it("조작된 쿠키는 조용히 무시한다 — 구조를 신뢰하지 않는다", () => {
    for (const bad of ["", "not-json", encodeURIComponent('{"boardId":"b"}'), encodeURIComponent('["x"]')]) {
      expect(decodeBoardActionFlash(bad)).toBeNull();
    }
  });

  it("아주 긴 메시지도 버리지 않고 줄여서 담는다", () => {
    const encoded = encodeBoardActionFlash({ boardId: "board-1", message: "가".repeat(400) });
    const decoded = decodeBoardActionFlash(encoded);
    expect(decoded?.boardId).toBe("board-1");
    expect((decoded?.message.length ?? 0)).toBeGreaterThan(0);
  });
});

describe("배선 — 디코드한 값이 보드 화면까지 도달한다", () => {
  const pageSource = readFileSync(
    resolve(process.cwd(), "src", "app", "(app)", "boards", "[id]", "page.tsx"),
    "utf8",
  ).replace(/\r\n/gu, "\n");

  /** import 줄을 걷어낸 본문 — 이름이 import 에만 있어도 통과하는 일을 막는다. */
  const body = pageSource.split("\n").filter((line) => !/^\s*import\b/u.test(line)).join("\n");

  it("★ 쿠키를 실제로 디코드한다 (import 줄만으로는 통과하지 못한다)", () => {
    expect(body).toMatch(/decodeBoardActionFlash\s*\(/u);
    expect(body).toContain(BOARD_ACTION_FLASH_COOKIE.length > 0 ? "BOARD_ACTION_FLASH_COOKIE" : "");
  });

  it("★ 디코드 결과가 «이름에 묶이고» 그 이름이 렌더까지 간다", () => {
    const binding = body.match(/const\s+(\w+)\s*=\s*findBoardActionError\s*\(/u);
    expect(binding, "findBoardActionError 결과가 어떤 이름에도 묶여 있지 않다").not.toBeNull();
    const name = binding![1];

    // 그 이름이 JSX 안에서 실제로 «그려지는» 자리에 쓰여야 한다.
    expect(body, `${name} 이 렌더에 쓰이지 않는다`).toMatch(new RegExp(`\\{${name}\\s*\\?`, "u"));
    expect(body, `${name} 의 내용이 출력되지 않는다`).toMatch(new RegExp(`\\{${name}\\}`, "u"));
  });

  it("★ 실패는 alert 로 알린다 — 성공처럼 보이면 안 된다", () => {
    expect(body).toMatch(/role="alert"/u);
  });
});

describe("classifyRowMoveFailure — 값과 함께 옮기는 저장의 실패 종류 (2026-10-06)", () => {
  it("Supabase RPC 원문과 로컬 어댑터 원문을 같은 종류로 읽는다", () => {
    expect(classifyRowMoveFailure(new Error("row move stale version"))).toBe("stale");
    expect(classifyRowMoveFailure(new Error("행 순서가 변경되었습니다. 새로고침 후 다시 시도해 주세요."))).toBe("stale");
    expect(classifyRowMoveFailure(new Error("row move permission denied"))).toBe("permission");
    expect(classifyRowMoveFailure(new Error("전체 행을 볼 수 있는 사용자만 행 순서를 바꿀 수 있습니다."))).toBe("permission");
    expect(classifyRowMoveFailure(new Error("target group unavailable"))).toBe("target_missing");
    expect(classifyRowMoveFailure(new Error("대상 그룹을 찾을 수 없습니다."))).toBe("target_missing");
  });

  it("이미 사람 말로 바꾼 문장도 같은 종류다 — 상위 액션이 «낡음» 신호를 잃지 않는다", () => {
    expect(classifyRowMoveFailure(new UserFacingActionError(ROW_MOVE_FAILURE_MESSAGES.stale))).toBe("stale");
  });

  it("모르는 실패는 null — 추측으로 분류하지 않는다", () => {
    expect(classifyRowMoveFailure(new Error("value move replay conflict"))).toBeNull();
    expect(classifyRowMoveFailure(new Error("network lost"))).toBeNull();
    expect(classifyRowMoveFailure(null)).toBeNull();
  });

  it("사람 말로 바꾼 문장은 화면에 그대로 간다 — DB 원문은 아니다", () => {
    const mapped = new UserFacingActionError(ROW_MOVE_FAILURE_MESSAGES.permission);
    expect(userFacingMessage(mapped)).toBe(ROW_MOVE_FAILURE_MESSAGES.permission);
    expect(userFacingMessage(new Error("row move permission denied"))).not.toMatch(/row move/);
  });
});
