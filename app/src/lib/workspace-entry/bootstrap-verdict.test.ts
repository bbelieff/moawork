import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ after: vi.fn() }));
vi.mock("next/server", () => ({ after: mocks.after }));

import {
  deferBootstrapCheck,
  forgetBootstrapOutcome,
  hasRecentCleanBootstrap,
  markBootstrapChecked,
} from "./bootstrap-verdict";

beforeEach(() => {
  mocks.after.mockReset();
});

describe("Issue 857 — 기본 탭 점검을 기다리지 않는 기억", () => {
  it("점검을 통과한 뒤 10분 동안만 «최근 통과» 다", () => {
    expect(hasRecentCleanBootstrap("org-a", "user-a", 1_000)).toBe(false);
    markBootstrapChecked("org-a", "user-a", 1_000);
    expect(hasRecentCleanBootstrap("org-a", "user-a", 1_000 + 9 * 60_000)).toBe(true);
    expect(hasRecentCleanBootstrap("org-a", "user-a", 1_000 + 11 * 60_000)).toBe(false);
    expect(hasRecentCleanBootstrap("org-a", "user-b", 1_000)).toBe(false);
  });

  it("방금 점검했으면 뒤 점검도 걸지 않고, 1분이 지나면 응답 뒤에 다시 점검한다", async () => {
    markBootstrapChecked("org-b", "user-b", 10_000);
    const check = vi.fn(async () => "clean" as const);
    expect(deferBootstrapCheck("org-b", "user-b", check, 10_000 + 30_000)).toBe(true);
    expect(mocks.after).not.toHaveBeenCalled();

    expect(deferBootstrapCheck("org-b", "user-b", check, 10_000 + 61_000)).toBe(true);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(check).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0][0]();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("뒤 점검이 실패하면 기억을 지워 다음 화면은 앞에서 점검한다", async () => {
    markBootstrapChecked("org-c", "user-c", 0);
    deferBootstrapCheck("org-c", "user-c", async () => { throw new Error("unavailable"); }, 120_000);
    // 같은 시각에서 보면 아직 «최근 통과» — 지운 것이 TTL 이 아니라 실패 처리임을 가른다.
    expect(hasRecentCleanBootstrap("org-c", "user-c", 120_000)).toBe(true);
    await mocks.after.mock.calls[0][0]();
    expect(hasRecentCleanBootstrap("org-c", "user-c", 120_000)).toBe(false);
  });

  it("뒤 점검이 도는 동안 들어온 요청은 같은 점검을 또 걸지 않는다", async () => {
    markBootstrapChecked("org-e", "user-e", 0);
    const check = vi.fn(async () => "clean" as const);
    expect(deferBootstrapCheck("org-e", "user-e", check, 61_000)).toBe(true);
    expect(deferBootstrapCheck("org-e", "user-e", check, 62_000)).toBe(true);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    await mocks.after.mock.calls[0][0]();
    // 끝난 뒤에는 다시 1분 간격 규칙만 남는다.
    expect(deferBootstrapCheck("org-e", "user-e", check, Date.now() + 61_000)).toBe(true);
    expect(mocks.after).toHaveBeenCalledTimes(2);
  });

  it("요청 밖이라 미룰 곳이 없으면 미루지 않는다(호출부가 지금 점검)", () => {
    mocks.after.mockImplementation(() => { throw new Error("outside a request scope"); });
    markBootstrapChecked("org-d", "user-d", 0);
    expect(deferBootstrapCheck("org-d", "user-d", async () => "clean", 120_000)).toBe(false);
    forgetBootstrapOutcome("org-d", "user-d");
  });
});
