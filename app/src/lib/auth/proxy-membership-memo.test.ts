import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetMembershipRows,
  recallMembershipRows,
  rememberMembershipRows,
  resetMembershipMemo,
} from "./proxy-membership-memo";

beforeEach(() => resetMembershipMemo());

describe("Issue 857 · 프록시 회사 목록 기억", () => {
  it("1분 동안만 기억하고, 지나면 버린다", () => {
    rememberMembershipRows("user-1", ["row"], 1_000);
    expect(recallMembershipRows("user-1", 1_000 + 59_000)).toEqual(["row"]);
    expect(recallMembershipRows("user-1", 1_000 + 60_000)).toBeUndefined();
    // 버린 뒤에는 시각을 되돌려도 없다(지웠다).
    expect(recallMembershipRows("user-1", 1_000)).toBeUndefined();
  });

  it("시계가 뒤로 가면 낡은 것으로 본다", () => {
    rememberMembershipRows("user-1", ["row"], 10_000);
    expect(recallMembershipRows("user-1", 9_000)).toBeUndefined();
  });

  it("사람마다 따로 기억하고, 잊으라면 잊는다", () => {
    rememberMembershipRows("user-1", ["a"], 0);
    rememberMembershipRows("user-2", ["b"], 0);
    forgetMembershipRows("user-1");
    expect(recallMembershipRows("user-1", 0)).toBeUndefined();
    expect(recallMembershipRows("user-2", 0)).toEqual(["b"]);
  });

  it("개수 상한을 넘으면 비우고 다시 시작한다(메모리가 끝없이 늘지 않는다)", () => {
    for (let index = 0; index < 2000; index += 1) rememberMembershipRows(`user-${index}`, [index], 0);
    expect(recallMembershipRows("user-0", 0)).toEqual([0]);
    rememberMembershipRows("user-new", ["new"], 0);
    expect(recallMembershipRows("user-0", 0)).toBeUndefined();
    expect(recallMembershipRows("user-new", 0)).toEqual(["new"]);
  });
});
