import { describe, expect, it } from "vitest";
import {
  clampComposerHeight,
  composerMaxHeight,
  continueList,
  COMPOSER_MIN_HEIGHT,
  indentLines,
  isListLine,
  outdentLines,
} from "./composer-editing";

/**
 * #660 — 메모 입력창의 계산부.
 *
 * 여기서 재는 것은 «커서가 어디로 가는가» 까지다. 값만 맞고 커서가 엉뚱한 곳에 있으면
 * 사용자는 다음 글자를 엉뚱한 자리에 적게 된다 — 화면에서만 보이는 종류의 결함이다.
 */

describe("#660 높이는 화면의 40% 를 넘지 않는다", () => {
  it("40% 로 자른다", () => {
    expect(composerMaxHeight(1000)).toBe(400);
    expect(clampComposerHeight(900, 1000)).toBe(400);
  });

  it("두 줄보다 작아지지 않는다 — 「적는 칸」으로 안 보인다", () => {
    expect(clampComposerHeight(0, 1000)).toBe(COMPOSER_MIN_HEIGHT);
    expect(clampComposerHeight(-50, 1000)).toBe(COMPOSER_MIN_HEIGHT);
  });

  it("화면이 아주 낮아도 최소 높이를 지킨다 — 40% 가 최소보다 작을 때", () => {
    expect(composerMaxHeight(60)).toBe(COMPOSER_MIN_HEIGHT);
    expect(clampComposerHeight(200, 60)).toBe(COMPOSER_MIN_HEIGHT);
  });

  it("숫자가 아니면 최소 높이로 닫는다", () => {
    expect(clampComposerHeight(Number.NaN, 1000)).toBe(COMPOSER_MIN_HEIGHT);
  });
});

describe("#660 탭으로 줄 수준을 올리고 내린다", () => {
  it("커서가 있는 줄을 두 칸 들여쓰고 커서도 같이 민다", () => {
    const next = indentLines({ value: "- 하나", selectionStart: 2, selectionEnd: 2 });
    expect(next.value).toBe("  - 하나");
    expect(next.selectionStart).toBe(4);
  });

  it("여러 줄을 고르면 그 줄 전부를 들여쓴다", () => {
    const next = indentLines({ value: "- 하나\n- 둘\n- 셋", selectionStart: 0, selectionEnd: 10 });
    expect(next.value).toBe("  - 하나\n  - 둘\n  - 셋");
  });

  it("시프트+탭은 두 칸까지만 뺀다", () => {
    const next = outdentLines({ value: "    - 하나", selectionStart: 6, selectionEnd: 6 });
    expect(next.value).toBe("  - 하나");
  });

  it("이미 왼쪽 끝이면 아무것도 안 뺀다 — 음수 커서를 만들지 않는다", () => {
    const next = outdentLines({ value: "- 하나", selectionStart: 0, selectionEnd: 0 });
    expect(next.value).toBe("- 하나");
    expect(next.selectionStart).toBe(0);
  });

  it("공백이 한 칸뿐이면 한 칸만 뺀다", () => {
    expect(outdentLines({ value: " - 하나", selectionStart: 3, selectionEnd: 3 }).value).toBe("- 하나");
  });
});

describe("#660 엔터가 목록을 이어 준다", () => {
  it("표식과 들여쓰기를 그대로 물려준다", () => {
    const next = continueList({ value: "  - 하나", selectionStart: 6, selectionEnd: 6 });
    expect(next?.value).toBe("  - 하나\n  - ");
    expect(next?.selectionStart).toBe(next?.value.length);
  });

  it("번호 목록은 다음 번호로 이어 준다", () => {
    expect(continueList({ value: "1. 하나", selectionStart: 5, selectionEnd: 5 })?.value).toBe("1. 하나\n2. ");
  });

  it("★ 빈 항목에서 엔터를 치면 표식을 지운다 — 목록에서 빠져나온다", () => {
    // "- 하나\n- " 은 길이 7 이고 커서는 맨 끝(7). 지워진 줄의 시작(5)에 커서가 남아야 한다.
    const value = "- 하나\n- ";
    const next = continueList({ value, selectionStart: value.length, selectionEnd: value.length });
    expect(next?.value).toBe("- 하나\n");
    expect(next?.selectionStart).toBe(5);
  });

  it("목록이 아니면 null 이다 — 브라우저 기본 동작을 그대로 둔다(실행 취소 보존)", () => {
    expect(continueList({ value: "그냥 메모", selectionStart: 5, selectionEnd: 5 })).toBeNull();
  });

  it("범위를 고른 상태면 손대지 않는다", () => {
    expect(continueList({ value: "- 하나", selectionStart: 0, selectionEnd: 4 })).toBeNull();
  });

  it("인용(>)도 이어 준다", () => {
    expect(continueList({ value: "> 인용", selectionStart: 4, selectionEnd: 4 })?.value).toBe("> 인용\n> ");
  });
});

describe("#660 목록 줄인지 알아본다", () => {
  it("「- 」까지 쳤으면 목록이다", () => {
    expect(isListLine("- ", 2)).toBe(true);
    expect(isListLine("  * ", 4)).toBe(true);
    expect(isListLine("1. ", 3)).toBe(true);
  });

  it("「-」만 치고 스페이스 전이면 아직 목록이 아니다", () => {
    expect(isListLine("-", 1)).toBe(false);
  });
});
