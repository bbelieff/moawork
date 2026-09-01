/**
 * 「자리」 — 사람이 아니라 «역할» 이 정본이다 (#683 · D안 1단계).
 *
 * ## 왜
 *
 * 총괄 지시 —
 *   「직원이 들어오면 그대로 오래 있는게 아니라 인원이 왔다갔다를 많이 한단 말이지?
 *    그래서 온보딩과 인수인계절차가 항상 복잡하고 귀찮은 일이야.
 *    사람보다 그 사람이 했던 역할이 중요하고 누가 들어와도 전에 내 역할을 맡은 사람이
 *    뭘 하고 있었는지 보고 똑같이 할 수 있게 만드는 게 중요해」
 *
 * 그래서 부서 · 권한 · 알림 · 담당 보드 · «해야 할 일» 을 사람이 아니라 **자리에** 매단다.
 * 사람이 바뀌어도 자리는 남고, 새 사람은 앉는 순간 그대로 이어받는다.
 *
 * ## ★ 1단계는 «새 엔티티를 만들지 않는다»
 *
 * 자리 = **(부서 × 역할) 조합**. 이미 있는 둘의 짝으로 «읽는다».
 *
 *     지금 있는 것   departments · org_members(role, scope) · department_members
 *     1단계가 더함   seat_definitions — 그 조합에 붙는 «정의서와 메모» 뿐
 *
 * 왜 이렇게 시작하나 — 조직관리는 실측 **조작 0건**이다(로고 0/5 · 부서 변경 0 · 권한 변경 0).
 * 크게 만들기 전에 «쓰이는지» 부터 확인한다. 겸직 · 복수 배치 · 자리 엔티티는 3단계(#685)다.
 *
 * ## 왜 화면 밖인가
 *
 * 안에 두면 검사할 자리가 없어진다(#638). 여기는 DOM 을 모른다.
 */

import type { MemberRole, MemberScope } from "@/lib/auth/roles";
import type { OrgMemberView } from "./org-view";

/**
 * 자리를 가리키는 열쇠.
 *
 * ★ 부서가 없는 사람(미배정)도 자리를 갖는다 — departmentId 가 null 인 자리다.
 *   그 사람들을 «자리 없음» 으로 떨어뜨리면 화면에서 사라진다.
 */
export type SeatKey = Readonly<{
  departmentId: string | null;
  role: MemberRole;
}>;

/** 저장·조회에 쓰는 한 줄짜리 열쇠. DB 의 (department_id, role) 짝과 같은 것을 가리킨다. */
export function seatKeyToId(key: SeatKey): string {
  return `${key.departmentId ?? "-"}:${key.role}`;
}

export function seatKeyEquals(a: SeatKey, b: SeatKey): boolean {
  return a.departmentId === b.departmentId && a.role === b.role;
}

export type SeatOccupant = Readonly<{
  userId: string;
  displayName: string;
  title: string | null;
  titleKnown: boolean;
  active: boolean;
  scope: MemberScope | null;
}>;

export type Seat = Readonly<{
  key: SeatKey;
  id: string;
  departmentId: string | null;
  departmentName: string | null;
  role: MemberRole;
  /** 이 자리에 앉아 있는 사람들. */
  occupants: readonly SeatOccupant[];
  /**
   * ★ «찼다 / 비었다» 두 값으로는 모자란다. 세 번째가 «모른다» 다.
   *
   *   전에는 `vacant: boolean` 이었다. 그런데 역할을 못 읽은 사람이 그 부서에 있으면
   *   그 사람이 팀장일 수도 있는데 화면은 사람이 0명인 것만 보고 **붉은 「공석」을 단언**했다.
   *   앉아 있는 사람을 두고 「이 자리는 비었다」고 말하는 것이다 (#683 검수 P0-1).
   *
   *   두 값짜리 참·거짓은 «모른다» 를 담을 곳이 없어서 반드시 한쪽으로 뭉갠다.
   *   그래서 상태를 셋으로 둔다 — 화면이 모르는 것을 단언할 수 «없게» 만든다.
   *
   *     occupied  사람이 있다
   *     vacant    사람이 없고, 그 부서에 역할 미상인 사람도 없다 → «비었다» 고 말해도 된다
   *     unknown   사람이 없지만 그 부서에 역할 미상인 사람이 있다 → 「확인 못 함」
   */
  status: "occupied" | "vacant" | "unknown";
  /** 그 부서에서 역할을 못 읽은 사람 수. status 가 unknown 인 이유를 화면이 설명할 수 있게. */
  unknownPeers: number;
}>;

const ROLE_ORDER: Record<MemberRole, number> = {
  owner: 0,
  admin: 1,
  team_lead: 2,
  member: 3,
};

const ROLE_LABEL: Record<MemberRole, string> = {
  owner: "대표",
  admin: "관리자",
  team_lead: "팀장",
  member: "담당",
};

/** 화면에 적는 자리 이름 — 「영업1팀 팀장」. 부서가 없으면 역할만. */
export function seatName(seat: Pick<Seat, "departmentName" | "role">): string {
  const role = ROLE_LABEL[seat.role] ?? seat.role;
  return seat.departmentName ? `${seat.departmentName} ${role}` : role;
}

/**
 * 사람들에서 자리를 «읽는다».
 *
 * ★ 역할을 모르는 사람(role === null)은 자리를 만들지 않는다.
 *   모르는 것을 「담당」으로 떨어뜨리면 없는 자리를 «단언» 하는 것이 된다 —
 *   org-view.ts 가 role 을 null 로 두는 이유와 같다.
 *   그 사람들은 seatlessMembers 로 따로 돌려주어 화면이 「확인 못 함」이라고 말하게 한다.
 *
 * ★ 「있어야 하는데 비어 있는 자리」도 만든다(expectVacant).
 *   부서마다 팀장 자리가 있어야 하는데 아무도 없으면 그 자리는 «공석» 이지 «없는 것» 이 아니다.
 *   그게 안 보이면 「우리 팀에 팀장이 없다」는 사실이 화면에서 사라진다.
 */
export function deriveSeats(input: {
  departments: readonly { id: string; name: string }[];
  members: readonly OrgMemberView[];
  /** 부서마다 «있어야 한다» 고 볼 역할. 기본은 팀장 — 공석이 보여야 하는 자리다. */
  expectVacant?: readonly MemberRole[];
}): { seats: Seat[]; seatlessMembers: OrgMemberView[] } {
  const departmentName = new Map(input.departments.map((row) => [row.id, row.name]));
  const bucket = new Map<string, { key: SeatKey; occupants: SeatOccupant[] }>();
  const seatless: OrgMemberView[] = [];

  const put = (key: SeatKey, occupant: SeatOccupant | null) => {
    const id = seatKeyToId(key);
    const found = bucket.get(id) ?? { key, occupants: [] };
    if (occupant) found.occupants.push(occupant);
    bucket.set(id, found);
  };

  for (const member of input.members) {
    if (member.role === null) {
      seatless.push(member);
      continue;
    }
    put(
      { departmentId: member.primaryDepartmentId, role: member.role },
      {
        userId: member.userId,
        displayName: member.displayName,
        title: member.title,
        titleKnown: member.titleKnown,
        active: member.active,
        scope: member.scope,
      },
    );
  }

  // 비어 있어도 보여야 하는 자리를 채운다.
  for (const department of input.departments) {
    for (const role of input.expectVacant ?? ["team_lead"]) {
      put({ departmentId: department.id, role }, null);
    }
  }

  const seats = [...bucket.values()].map<Seat>((entry) => {
    /*
     * ★ 그 «부서» 에 역할 미상인 사람이 있으면 그 부서의 빈 자리는 «비었다» 고 단언할 수 없다.
     *   그 사람이 바로 그 자리의 주인일 수 있다.
     *
     * ★★ 단 «활성인» 사람만 센다. 이걸 빼면 반대편으로 거짓말을 한다.
     *
     *   자리 없는 사람이 생기는 지배적인 이유는 «역할을 모른다» 가 아니라 **«활성이 아니다»** 다
     *   (퇴사·정지·초대중). 그리고 그건 **아는 사실**이지 모르는 것이 아니다.
     *   퇴사해도 department_members 행은 아무 데서도 지워지지 않아서, 퇴사자는 주부서를 유지한 채 남는다.
     *
     *   그래서 활성 여부를 안 보면 — **팀장이 나간 바로 그 순간** 그 자리가 「확인 못 함」이 되어
     *   공석 신호가 꺼진다. 「인원이 왔다갔다 많이 한다」가 이 기능의 전제인데,
     *   그 이동이 일어난 순간에 정확히 꺼지는 것이다 (#683 재검수 P1-A).
     *
     *   좁은 가드가 «사람» 을 지웠고, 넓은 추론이 «사실» 을 지운다. 같은 병의 반대편이다.
     */
    const unknownPeers = seatless.filter(
      (member) => member.active && member.primaryDepartmentId === entry.key.departmentId,
    ).length;
    return {
      key: entry.key,
      id: seatKeyToId(entry.key),
      departmentId: entry.key.departmentId,
      departmentName: entry.key.departmentId ? departmentName.get(entry.key.departmentId) ?? null : null,
      role: entry.key.role,
      occupants: entry.occupants,
      status: entry.occupants.length > 0 ? "occupied" : unknownPeers > 0 ? "unknown" : "vacant",
      unknownPeers,
    };
  });

  seats.sort((left, right) => {
    // 부서 순 → 역할 순 → 이름 순. 미배정(부서 없음)은 맨 뒤로.
    const leftDept = left.departmentName ?? "￿";
    const rightDept = right.departmentName ?? "￿";
    if (leftDept !== rightDept) return leftDept.localeCompare(rightDept, "ko");
    const order = (ROLE_ORDER[left.role] ?? 9) - (ROLE_ORDER[right.role] ?? 9);
    if (order !== 0) return order;
    return left.id.localeCompare(right.id);
  });

  return { seats, seatlessMembers: seatless };
}

/**
 * 화면 머리에 적는 수. 「자리 9 · 사람 14 · 공석 1 · 확인 못 함 2」
 *
 * ★ 자리에 못 앉힌 사람도 «사람» 이다. 두 번째 인자를 빼면 머릿수가 실제보다 적게 나온다 —
 *   전에 그랬고, 팀장이 빠진 회사는 「사람 1」로 보였다(실제 2). 사람이 세어지지도 않았다.
 */
export function seatSummary(
  seats: readonly Seat[],
  seatlessMembers: readonly OrgMemberView[] = [],
): {
  seatCount: number;
  peopleCount: number;
  vacantCount: number;
  unknownCount: number;
} {
  const people = new Set<string>();
  let vacant = 0;
  let unknown = 0;
  for (const seat of seats) {
    if (seat.status === "vacant") vacant += 1;
    if (seat.status === "unknown") unknown += 1;
    for (const occupant of seat.occupants) people.add(occupant.userId);
  }
  for (const member of seatlessMembers) people.add(member.userId);
  return { seatCount: seats.length, peopleCount: people.size, vacantCount: vacant, unknownCount: unknown };
}

export function findSeat(seats: readonly Seat[], id: string | null): Seat | null {
  if (!id) return null;
  return seats.find((seat) => seat.id === id) ?? null;
}

export { ROLE_LABEL as SEAT_ROLE_LABEL };
