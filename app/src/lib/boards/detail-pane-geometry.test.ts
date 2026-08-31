import { describe, expect, it } from "vitest";
import {
  clampDetailInset,
  clampRailWidth,
  DETAIL_DEFAULT_INSET,
  DETAIL_MIN_WIDTH,
  railMaxWidth,
  RAIL_MIN_WIDTH,
} from "./detail-pane-geometry";

/**
 * #660 — 가장자리를 끌어 크기를 바꿀 때의 «못 넘는 선».
 *
 * 여기서 막지 않으면 사용자가 대화상자를 0px 로 만들거나 정보 칸으로 화면을 다 덮어서
 * 스스로 되돌릴 수 없는 상태를 만든다 — 되돌릴 길이 없는 조작은 만들지 않는다.
 */

describe("#660 전체 너비 — 왼쪽 여백", () => {
  it("0 아래로 안 간다 — 전체 화면이 한계다", () => {
    expect(clampDetailInset(-40, 1440)).toBe(0);
  });

  it("대화상자가 최소 너비보다 좁아지게 만들 수 없다", () => {
    // 1440 화면에서 여백이 1000 이면 대화상자는 440 — 최소(520)보다 좁다.
    expect(clampDetailInset(1000, 1440)).toBe(1440 - DETAIL_MIN_WIDTH);
  });

  it("좁은 화면에서는 여백 0 만 허용한다", () => {
    expect(clampDetailInset(200, 400)).toBe(0);
  });

  it("숫자가 아니면 기본값으로 닫는다", () => {
    expect(clampDetailInset(Number.NaN, 1440)).toBe(DETAIL_DEFAULT_INSET);
  });

  it("보통 값은 그대로 통과한다", () => {
    expect(clampDetailInset(96, 1440)).toBe(96);
  });
});

describe("#660 좌우 분할 — 정보 칸 너비", () => {
  it("최소 너비 아래로 안 간다 — 라벨과 값이 한 줄에 못 선다", () => {
    expect(clampRailWidth(80, 1200)).toBe(RAIL_MIN_WIDTH);
  });

  it("★ 전체의 62% 를 넘지 못한다 — 오른쪽 히스토리가 읽을 수 없게 좁아진다", () => {
    expect(railMaxWidth(1000)).toBe(620);
    expect(clampRailWidth(900, 1000)).toBe(620);
  });

  it("아주 좁은 화면에서도 최소 너비를 지킨다", () => {
    expect(railMaxWidth(300)).toBe(RAIL_MIN_WIDTH);
    expect(clampRailWidth(280, 300)).toBe(RAIL_MIN_WIDTH);
  });

  it("보통 값은 그대로 통과한다", () => {
    expect(clampRailWidth(400, 1200)).toBe(400);
  });
});
