import { describe, expect, it } from "vitest";
import {
  deriveSeats,
  findSeat,
  seatKeyEquals,
  seatKeyToId,
  seatName,
  seatSummary,
} from "./seats";
import type { OrgMemberView } from "./org-view";

/**
 * #683 — 「자리」를 부서 × 역할에서 읽는다.
 *
 * 여기서 막지 않으면 «없는 자리를 있다고 하거나», «있는 공석을 감추거나»,
 * «모르는 역할을 담당으로 단언하는» 화면이 된다.
 */

const person = (over: Partial<OrgMemberView> & { userId: string }): OrgMemberView => ({
  displayName: "예시",
  title: null,
  titleKnown: true,
  departmentIds: [],
  primaryDepartmentId: null,
  primaryDepartmentName: null,
  role: "member",
  scope: "assigned",
  reportsToUserId: null,
  reportsToName: null,
  isHeadOfPrimary: false,
  active: true,
  ...over,
});

const DEPTS = [
  { id: "d1", name: "영업1팀" },
  { id: "d2", name: "영업2팀" },
];

describe("#683 자리 열쇠", () => {
  it("부서와 역할 짝이 곧 자리다", () => {
    expect(seatKeyToId({ departmentId: "d1", role: "team_lead" })).toBe("d1:team_lead");
  });

  it("★ 부서가 없는 사람도 자리를 갖는다 — 미배정을 «자리 없음» 으로 떨어뜨리지 않는다", () => {
    expect(seatKeyToId({ departmentId: null, role: "member" })).toBe("-:member");
  });

  it("같은 짝은 같은 자리다", () => {
    expect(seatKeyEquals({ departmentId: "d1", role: "member" }, { departmentId: "d1", role: "member" })).toBe(true);
    expect(seatKeyEquals({ departmentId: "d1", role: "member" }, { departmentId: "d2", role: "member" })).toBe(false);
  });
});

describe("#683 자리 이름", () => {
  it("부서 + 역할로 읽힌다", () => {
    expect(seatName({ departmentName: "영업1팀", role: "team_lead" })).toBe("영업1팀 팀장");
    expect(seatName({ departmentName: "관리부", role: "member" })).toBe("관리부 담당");
  });

  it("부서가 없으면 역할만", () => {
    expect(seatName({ departmentName: null, role: "owner" })).toBe("대표");
  });
});

describe("#683 사람에서 자리를 읽는다", () => {
  it("같은 부서·같은 역할이면 한 자리에 여럿이 앉는다", () => {
    const { seats } = deriveSeats({
      departments: DEPTS,
      members: [
        person({ userId: "u1", displayName: "박실장", primaryDepartmentId: "d1", role: "member" }),
        person({ userId: "u2", displayName: "최주임", primaryDepartmentId: "d1", role: "member" }),
      ],
      expectVacant: [],
    });
    const seat = seats.find((s) => s.id === "d1:member")!;
    expect(seat.occupants.map((o) => o.displayName)).toEqual(["박실장", "최주임"]);
    expect(seat.vacant).toBe(false);
  });

  it("★ 역할을 모르는 사람은 자리를 «만들지 않는다» — 담당으로 단언하지 않는다", () => {
    const { seats, seatlessMembers } = deriveSeats({
      departments: DEPTS,
      members: [person({ userId: "u9", displayName: "확인중", primaryDepartmentId: "d1", role: null })],
      expectVacant: [],
    });
    expect(seats).toHaveLength(0);
    expect(seatlessMembers.map((m) => m.displayName)).toEqual(["확인중"]);
  });

  it("★ 사람이 없어도 «있어야 하는» 자리는 공석으로 남는다", () => {
    const { seats } = deriveSeats({ departments: DEPTS, members: [], expectVacant: ["team_lead"] });
    expect(seats.map((s) => s.id)).toEqual(["d1:team_lead", "d2:team_lead"]);
    expect(seats.every((s) => s.vacant)).toBe(true);
  });

  it("사람이 앉으면 그 자리는 더 이상 공석이 아니다", () => {
    const { seats } = deriveSeats({
      departments: DEPTS,
      members: [person({ userId: "u1", displayName: "김담당", primaryDepartmentId: "d1", role: "team_lead" })],
      expectVacant: ["team_lead"],
    });
    expect(seats.find((s) => s.id === "d1:team_lead")!.vacant).toBe(false);
    expect(seats.find((s) => s.id === "d2:team_lead")!.vacant).toBe(true);
  });

  it("비활성 구성원도 자리에서 사라지지 않는다 — 상태는 따로 말한다", () => {
    const { seats } = deriveSeats({
      departments: DEPTS,
      members: [person({ userId: "u3", displayName: "쉬는중", primaryDepartmentId: "d1", role: "member", active: false })],
      expectVacant: [],
    });
    const seat = seats.find((s) => s.id === "d1:member")!;
    expect(seat.occupants[0].active).toBe(false);
    expect(seat.vacant).toBe(false);
  });

  it("부서 → 역할 순으로 정렬하고, 미배정은 맨 뒤로 보낸다", () => {
    const { seats } = deriveSeats({
      departments: DEPTS,
      members: [
        person({ userId: "u0", displayName: "미배정", primaryDepartmentId: null, role: "member" }),
        person({ userId: "u1", displayName: "담당", primaryDepartmentId: "d1", role: "member" }),
        person({ userId: "u2", displayName: "팀장", primaryDepartmentId: "d1", role: "team_lead" }),
      ],
      expectVacant: [],
    });
    expect(seats.map((s) => s.id)).toEqual(["d1:team_lead", "d1:member", "-:member"]);
  });
});

describe("#683 머리에 적는 수", () => {
  it("자리 · 사람 · 공석을 센다", () => {
    const { seats } = deriveSeats({
      departments: DEPTS,
      members: [
        person({ userId: "u1", primaryDepartmentId: "d1", role: "team_lead" }),
        person({ userId: "u2", primaryDepartmentId: "d1", role: "member" }),
      ],
      expectVacant: ["team_lead"],
    });
    expect(seatSummary(seats)).toEqual({ seatCount: 3, peopleCount: 2, vacantCount: 1 });
  });

  it("★ 한 사람이 여러 자리에 있어도 사람은 한 번만 센다", () => {
    const seats = deriveSeats({
      departments: DEPTS,
      members: [person({ userId: "same", primaryDepartmentId: "d1", role: "member" })],
      expectVacant: [],
    }).seats;
    const doubled = [...seats, { ...seats[0], id: "d2:member", departmentId: "d2" }];
    expect(seatSummary(doubled).peopleCount).toBe(1);
  });
});

describe("#683 자리 고르기", () => {
  it("고른 자리를 찾는다", () => {
    const { seats } = deriveSeats({
      departments: DEPTS,
      members: [person({ userId: "u1", primaryDepartmentId: "d1", role: "team_lead" })],
      expectVacant: [],
    });
    expect(findSeat(seats, "d1:team_lead")?.role).toBe("team_lead");
  });

  it("아무것도 안 골랐거나 없는 것을 고르면 null", () => {
    expect(findSeat([], null)).toBeNull();
    expect(findSeat([], "없음")).toBeNull();
  });
});
