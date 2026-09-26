import { describe, expect, it } from "vitest";
import {
  checkInviteCreate,
  inviteJoinPath,
  isInviteToken,
  joinTargetFromNext,
  parseInvitePeek,
  parseInviteRedeem,
  workspacePath,
} from "./invite-links";

/**
 * 화면 셋이 함께 쓰는 «말» 을 잰다.
 *
 * ★ joinTargetFromNext 가 이 파일에서 제일 중요하다 — 로그인 콜백이 그 값으로 «리다이렉트» 한다.
 *   여기가 새면 열린 리다이렉트(open redirect)가 된다.
 */

describe("joinTargetFromNext — 로그인하고 돌아올 자리", () => {
  it("초대 링크 경로는 그대로 돌려준다", () => {
    expect(joinTargetFromNext("/join/aBc123XyZ0kk")).toBe("/join/aBc123XyZ0kk");
  });

  it.each([
    ["다른 사이트", "https://evil.example/join/aBc123XyZ0kk"],
    ["프로토콜 상대 주소", "//evil.example/join/aBc123XyZ0kk"],
    ["역슬래시", "/join\\aBc123XyZ0kk"],
    ["상대 경로", "join/aBc123XyZ0kk"],
    ["다른 화면", "/settings/members"],
    ["회사 화면", "/w/alpha"],
    ["경로 거슬러 오르기", "/join/../settings/members"],
    ["질의 붙임", "/join/aBc123XyZ0kk?x=1"],
    ["조각 붙임", "/join/aBc123XyZ0kk#x"],
    ["한 겹 더", "/join/aBc123XyZ0kk/extra"],
    ["빈 토큰", "/join/"],
    ["짧은 토큰", "/join/abc"],
    ["이상한 글자", "/join/aBc123XyZ0k-"],
    ["인코딩된 슬래시", "/join/aBc%2F123XyZ0kk"],
    ["빈 문자열", ""],
    ["숫자", 42],
    ["없음", null],
  ])("%s 는 거절한다", (_label, value) => {
    expect(joinTargetFromNext(value)).toBeNull();
  });

  it("★ 통과한 값은 «항상» /join/ 으로 시작한다 — 콜백이 이 값으로 리다이렉트한다", () => {
    const passed = ["/join/aBc123XyZ0kk", "/join/" + "a".repeat(64)]
      .map(joinTargetFromNext)
      .filter((value): value is string => value !== null);
    expect(passed.length).toBe(2);
    for (const path of passed) expect(path.startsWith("/join/")).toBe(true);
  });
});

describe("토큰 모양", () => {
  it("147 이 만드는 모양(24글자 영숫자)을 받는다", () => {
    expect(isInviteToken("aBc123XyZ0kkQwErTyUiOp12")).toBe(true);
  });

  it.each([["짧다", "abc"], ["기호", "abc-123-xyz0"], ["빈칸", "abc 123 xyz0"], ["너무 길다", "a".repeat(65)]])(
    "%s 는 토큰이 아니다",
    (_label, value) => { expect(isInviteToken(value)).toBe(false); },
  );

  it("경로를 한 군데서만 만든다", () => {
    expect(inviteJoinPath("aBc123XyZ0kk")).toBe("/join/aBc123XyZ0kk");
    expect(workspacePath("alpha")).toBe("/w/alpha");
  });
});

describe("미리보기 읽기", () => {
  it("살아있는 링크", () => {
    expect(parseInvitePeek({ ok: true, name: "알파 회사", role: "team_lead", scope: "department" }))
      .toEqual({ kind: "usable", orgName: "알파 회사", role: "team_lead", scope: "department" });
  });

  it.each([
    ["죽은 링크", { ok: false, reason: "unusable" }],
    ["대표 자리(링크로 못 준다)", { ok: true, name: "알파 회사", role: "owner", scope: "all" }],
    ["이름 없음", { ok: true, name: "", role: "member", scope: "assigned" }],
    ["모르는 범위", { ok: true, name: "알파 회사", role: "member", scope: "everything" }],
    ["빈 값", null],
    ["문자열", "ok"],
  ])("%s 는 못 쓰는 것으로 읽는다", (_label, value) => {
    expect(parseInvitePeek(value)).toEqual({ kind: "unusable" });
  });
});

describe("들어가기 결과 읽기", () => {
  it("처음 들어왔다", () => {
    expect(parseInviteRedeem({ ok: true, already: false, slug: "alpha", name: "알파 회사" }))
      .toEqual({ kind: "joined", slug: "alpha", orgName: "알파 회사" });
  });

  it("이미 이 회사 사람이다", () => {
    expect(parseInviteRedeem({ ok: true, already: true, slug: "alpha", name: "알파 회사" }))
      .toEqual({ kind: "already", slug: "alpha", orgName: "알파 회사" });
  });

  /*
   * ★ 148 의 핵심. 나갔던 사람에게 「링크가 죽었다」고 하면 거짓말이 된다 —
   *   링크는 멀쩡하고, 그 사람이 못 들어가는 것이다. 화면이 할 말이 달라야 한다.
   */
  it("★ 나갔던 사람은 «죽은 링크» 와 다르게 읽는다", () => {
    expect(parseInviteRedeem({ ok: false, reason: "needs_approval", name: "알파 회사" }))
      .toEqual({ kind: "needs_approval", orgName: "알파 회사" });
  });

  it("회사 이름이 없어도 needs_approval 은 유지한다", () => {
    expect(parseInviteRedeem({ ok: false, reason: "needs_approval" }))
      .toEqual({ kind: "needs_approval", orgName: null });
  });

  it.each([
    ["죽은 링크", { ok: false, reason: "unusable" }],
    ["슬러그 없음", { ok: true, already: false, name: "알파 회사" }],
    ["이름 없음", { ok: true, already: false, slug: "alpha" }],
    ["빈 값", null],
  ])("%s 는 못 쓰는 것으로 읽는다", (_label, value) => {
    expect(parseInviteRedeem(value)).toEqual({ kind: "unusable" });
  });
});

describe("만들기 규칙 — 화면이 서버보다 관대하지 않다", () => {
  const base = { role: "member", scope: "assigned" } as const;

  it("기한만 정해도 된다", () => {
    expect(checkInviteCreate({ ...base, days: 30, maxUses: null })).toBeNull();
  });

  it("횟수만 정해도 된다", () => {
    expect(checkInviteCreate({ ...base, days: null, maxUses: 1 })).toBeNull();
  });

  it("★ 둘 다 비우면 막는다 — 끄기 전까지 영원히 사는 열쇠가 된다", () => {
    expect(checkInviteCreate({ ...base, days: null, maxUses: null })).toBe("needs_expiry_or_limit");
  });

  it("★ 큰 수로 «형식상 제한» 을 흉내 내지 못한다", () => {
    expect(checkInviteCreate({ ...base, days: null, maxUses: 2147483647 })).toBe("uses_range");
    expect(checkInviteCreate({ ...base, days: null, maxUses: 1001 })).toBe("uses_range");
    expect(checkInviteCreate({ ...base, days: null, maxUses: 1000 })).toBeNull();
  });

  it("기간 범위를 지킨다", () => {
    expect(checkInviteCreate({ ...base, days: 0, maxUses: null })).toBe("days_range");
    expect(checkInviteCreate({ ...base, days: 366, maxUses: null })).toBe("days_range");
    expect(checkInviteCreate({ ...base, days: 365, maxUses: null })).toBeNull();
  });

  it("★ 대표 자리는 고를 수 없다", () => {
    expect(checkInviteCreate({ role: "owner" as never, scope: "all", days: 7, maxUses: null })).toBe("role");
  });

  it("소수·NaN 은 거절한다", () => {
    expect(checkInviteCreate({ ...base, days: 1.5, maxUses: null })).toBe("days_range");
    expect(checkInviteCreate({ ...base, days: null, maxUses: Number.NaN })).toBe("uses_range");
  });
});
