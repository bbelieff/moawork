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
    expect(seat.status).toBe("occupied");
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
    expect(seats.every((s) => s.status === "vacant")).toBe(true);
  });

  it("사람이 앉으면 그 자리는 더 이상 공석이 아니다", () => {
    const { seats } = deriveSeats({
      departments: DEPTS,
      members: [person({ userId: "u1", displayName: "김담당", primaryDepartmentId: "d1", role: "team_lead" })],
      expectVacant: ["team_lead"],
    });
    expect(seats.find((s) => s.id === "d1:team_lead")!.status).toBe("occupied");
    expect(seats.find((s) => s.id === "d2:team_lead")!.status).toBe("vacant");
  });

  it("비활성 구성원도 자리에서 사라지지 않는다 — 상태는 따로 말한다", () => {
    const { seats } = deriveSeats({
      departments: DEPTS,
      members: [person({ userId: "u3", displayName: "쉬는중", primaryDepartmentId: "d1", role: "member", active: false })],
      expectVacant: [],
    });
    const seat = seats.find((s) => s.id === "d1:member")!;
    expect(seat.occupants[0].active).toBe(false);
    expect(seat.status).toBe("occupied");
  });

  /*
   * ★ 여기부터는 «화면이 부르는 그대로» 부른다 — expectVacant 를 넘기지 않는다.
   *
   *   위의 시험들은 대부분 expectVacant: [] 를 넘겨서 공석 생성을 꺼 놓고 쟀다.
   *   그런데 화면(OrgViewTabs)은 그 인자를 안 넘긴다 → 기본값 ["team_lead"] 로 돈다.
   *   즉 «프로덕션 호출 모양» 에 시험이 하나도 없었고, 그래서 아래 P0 가 초록으로 통과했다.
   *   시험은 «되는 걸 확인하는 것» 이 아니라 «틀린 걸 잡는 것» 이라 호출 모양이 같아야 한다.
   */
  it("★ 역할을 못 읽은 사람이 그 부서에 있으면 팀장 자리를 «공석» 이라 단언하지 않는다", () => {
    // 실제로 있었던 일 — isRole 가드가 team_lead 를 빠뜨려 팀장 행이 role: null 로 들어왔다.
    // 그때 화면은 「d1 팀장 = 공석」을 붉게 단언했다. 팀장이 앉아 있는데도.
    const { seats, seatlessMembers } = deriveSeats({
      departments: DEPTS,
      members: [
        person({ userId: "u1", displayName: "김팀장", primaryDepartmentId: "d1", role: null }),
        person({ userId: "u2", displayName: "박담당", primaryDepartmentId: "d1", role: "member" }),
      ],
    });

    const d1 = seats.find((s) => s.id === "d1:team_lead")!;
    expect(d1.status).toBe("unknown");
    expect(d1.unknownPeers).toBe(1);

    // 미상인 사람이 없는 부서는 그대로 «공석» 이라고 말해도 된다 — 과보호로 사실을 숨기지 않는다.
    expect(seats.find((s) => s.id === "d2:team_lead")!.status).toBe("vacant");

    // 그리고 그 사람은 사라지지 않는다.
    expect(seatlessMembers.map((m) => m.displayName)).toEqual(["김팀장"]);
  });

  it("★ 퇴사자가 «진짜 공석» 을 덮지 않는다 — 팀장이 나간 바로 그 순간이 가장 중요하다", () => {
    /*
     * 실제로 있었던 회귀 — unknownPeers 가 «비활성인» 사람까지 세는 바람에,
     * 팀장이 퇴사한 직후 그 자리가 「공석」이 아니라 「확인 못 함」이 됐다.
     * 퇴사해도 department_members 행은 안 지워져서 퇴사자는 주부서를 유지한 채 남는다.
     * 「인원이 왔다갔다 많이 한다」가 전제인 기능이 그 이동의 순간에 신호를 끄는 것이다.
     */
    const { seats } = deriveSeats({
      departments: DEPTS,
      members: [
        person({ userId: "u1", displayName: "박담당", primaryDepartmentId: "d1", role: "member" }),
        person({ userId: "u2", displayName: "나간팀장", primaryDepartmentId: "d1", role: null, active: false }),
      ],
    });
    const d1 = seats.find((s) => s.id === "d1:team_lead")!;
    expect(d1.status).toBe("vacant"); // 「확인 못 함」이 아니다 — 우리는 왜 없는지 «안다»
    expect(d1.unknownPeers).toBe(0);
  });

  it("활성인데 역할을 못 읽은 사람은 여전히 «모른다» 다 — 과교정하지 않는다", () => {
    const { seats } = deriveSeats({
      departments: DEPTS,
      members: [person({ userId: "u3", displayName: "확인중", primaryDepartmentId: "d1", role: null, active: true })],
    });
    expect(seats.find((s) => s.id === "d1:team_lead")!.status).toBe("unknown");
  });

  it("★ 퇴사자를 「사람」에 합치지 않는다 — 전원 퇴사한 회사가 「사람 3」으로 보이면 안 된다", () => {
    const { seats, seatlessMembers } = deriveSeats({
      departments: DEPTS,
      members: [
        person({ userId: "u1", displayName: "나간사람1", primaryDepartmentId: "d1", role: null, active: false }),
        person({ userId: "u2", displayName: "나간사람2", primaryDepartmentId: "d1", role: null, active: false }),
        person({ userId: "u3", displayName: "나간사람3", primaryDepartmentId: null, role: null, active: false }),
      ],
    });
    const counts = seatSummary(seats, seatlessMembers);
    expect(counts.peopleCount).toBe(0); // 지금 일하는 사람은 0명이다
    expect(counts.inactiveCount).toBe(3); // 숨기지 않는다 — 따로 센다
    expect(counts.vacantCount).toBe(2); // 두 부서의 팀장 자리는 «진짜» 공석이다
  });

  it("★ 자리에 못 앉힌 사람도 머릿수에 센다 — 사람이 사라지면 안 된다", () => {
    const { seats, seatlessMembers } = deriveSeats({
      departments: DEPTS,
      members: [
        person({ userId: "u1", displayName: "김팀장", primaryDepartmentId: "d1", role: null }),
        person({ userId: "u2", displayName: "박담당", primaryDepartmentId: "d1", role: "member" }),
      ],
    });
    // seatlessMembers 를 안 넘기면 1명으로 세어진다 — 실제로 그렇게 틀렸었다.
    expect(seatSummary(seats, seatlessMembers).peopleCount).toBe(2);
    expect(seatSummary(seats, seatlessMembers).unknownCount).toBe(1);
    expect(seatSummary(seats, seatlessMembers).vacantCount).toBe(1); // d2 팀장만
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
    expect(seatSummary(seats)).toEqual({
      seatCount: 3,
      peopleCount: 2,
      inactiveCount: 0,
      vacantCount: 1,
      unknownCount: 0,
    });
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
