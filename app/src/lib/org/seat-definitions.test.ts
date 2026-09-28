import { describe, expect, it } from "vitest";
import {
  seatDefinitionDate,
  parseSeatDuties,
  parseSeatRules,
  seatDefinitionIsEmpty,
  toSeatDefinition,
  seatWriterNames,
  withSeatDefinitionNames,
} from "./seat-definitions";

/**
 * #683 — 역할 정의서를 화면이 «믿을 수 있는» 모양으로 줄인다.
 *
 * jsonb 는 무엇이든 담을 수 있다. 그대로 화면에 넘기면 사람이 적은 이상한 값이
 * 화면을 깨뜨리거나, 더 나쁘게는 «있는 척» 한다.
 */

describe("#683 할 일 읽기", () => {
  it("주기와 글을 갖춘 것만 남긴다", () => {
    expect(parseSeatDuties([
      { cycle: "daily", text: "아침에 뷰부터" },
      { cycle: "weekly", text: "주간 점검" },
    ])).toEqual([
      { cycle: "daily", text: "아침에 뷰부터" },
      { cycle: "weekly", text: "주간 점검" },
    ]);
  });

  it("★ 글이 비면 버린다 — 빈 줄이 「할 일」로 보이면 안 된다", () => {
    expect(parseSeatDuties([{ cycle: "daily", text: "   " }, { cycle: "daily" }])).toEqual([]);
  });

  it("모르는 주기는 «매일» 로 둔다 — 버리지 않는다. 글이 있으면 할 일이다", () => {
    expect(parseSeatDuties([{ cycle: "언젠가", text: "무언가" }])).toEqual([{ cycle: "daily", text: "무언가" }]);
  });

  it("배열이 아니면 빈 목록", () => {
    expect(parseSeatDuties(null)).toEqual([]);
    expect(parseSeatDuties("글자")).toEqual([]);
    expect(parseSeatDuties({ cycle: "daily", text: "객체" })).toEqual([]);
  });

  it("앞뒤 공백은 지운다", () => {
    expect(parseSeatDuties([{ cycle: "daily", text: "  전화  " }])).toEqual([{ cycle: "daily", text: "전화" }]);
  });
});

describe("#683 판단 기준 읽기", () => {
  it("세 갈래를 나눠 읽는다", () => {
    expect(parseSeatRules({ escalate: ["계약금 조정"], handle: ["재통화"], avoid: ["업체 지우기"] }))
      .toEqual({ escalate: ["계약금 조정"], handle: ["재통화"], avoid: ["업체 지우기"] });
  });

  it("빈 줄과 글자 아닌 것은 버린다", () => {
    expect(parseSeatRules({ escalate: ["", "  ", 3, null, "진짜"] }).escalate).toEqual(["진짜"]);
  });

  it("모양이 아니면 빈 목록 셋", () => {
    expect(parseSeatRules(null)).toEqual({ escalate: [], handle: [], avoid: [] });
    expect(parseSeatRules([1, 2])).toEqual({ escalate: [], handle: [], avoid: [] });
  });
});

describe("#683 «비었는가» 판정", () => {
  const base = {
    department_id: "d1",
    role: "team_lead" as const,
    summary: null,
    duties: [],
    rules: {},
    signals: null,
    handover: null,
    updated_at: null,
    updated_by: null,
  };

  it("★ 아무것도 안 쓰면 비었다 — 화면이 「아직 아무도 안 썼습니다」라고 말한다", () => {
    expect(seatDefinitionIsEmpty(toSeatDefinition(base))).toBe(true);
  });

  it("정의서 자체가 없어도 비었다", () => {
    expect(seatDefinitionIsEmpty(null)).toBe(true);
    expect(seatDefinitionIsEmpty(undefined)).toBe(true);
  });

  it("한 줄이라도 있으면 «있다»", () => {
    expect(seatDefinitionIsEmpty(toSeatDefinition({ ...base, summary: "3일 안에 첫 통화" }))).toBe(false);
    expect(seatDefinitionIsEmpty(toSeatDefinition({ ...base, duties: [{ cycle: "daily", text: "전화" }] }))).toBe(false);
    expect(seatDefinitionIsEmpty(toSeatDefinition({ ...base, rules: { avoid: ["지우기"] } }))).toBe(false);
    expect(seatDefinitionIsEmpty(toSeatDefinition({ ...base, handover: "인수인계" }))).toBe(false);
  });
});

describe("#683 누가 언제 고쳤나", () => {
  it("이름을 찾아 준다 — 「누가 썼나」가 보여야 신뢰가 생긴다", () => {
    const def = toSeatDefinition(
      { department_id: null, role: "member", summary: "s", duties: [], rules: {}, signals: null, handover: null, updated_at: "2026-08-28T00:00:00Z", updated_by: "u1" },
      (id) => (id === "u1" ? "이대표" : null),
    );
    expect(def.updatedByName).toBe("이대표");
    expect(def.updatedAt).toBe("2026-08-28T00:00:00Z");
  });

  it("★ 이름을 못 찾으면 «모른다» 로 둔다 — 아이디를 화면에 노출하지 않는다", () => {
    const def = toSeatDefinition(
      { department_id: null, role: "member", summary: "s", duties: [], rules: {}, signals: null, handover: null, updated_at: null, updated_by: "unknown-uuid" },
      () => null,
    );
    expect(def.updatedByName).toBeNull();
  });
});

describe("#683 운영 확인 후속 — 「누군가가 씀」이라고 말하지 않는다", () => {
  /*
   * 운영 화면을 열어 실제로 저장해 보고 발견한 것 —
   * 「누가 언제 썼나」 줄이 항상 「누군가가 씀」이었다. updated_by 도 구성원 요약도
   * 같은 화면에 다 있었는데 이름을 «붙이는 단계» 가 없었다.
   * 아는 것을 모른다고 말하는 것이고, 이 PR 이 네 라운드 동안 고친 것과 같은 종류다.
   */
  const row = {
    department_id: null,
    role: "admin" as const,
    summary: "요약",
    duties: [],
    rules: {},
    signals: null,
    handover: null,
    updated_at: "2026-09-01T16:03:19Z",
    updated_by: "u-1",
  };

  it("★ 나중에 이름을 입힐 수 있게 id 를 들고 있는다", () => {
    expect(toSeatDefinition(row).updatedById).toBe("u-1");
  });

  it("★ 이름표가 온 뒤에 붙는다", () => {
    const before = new Map([["-:admin", toSeatDefinition(row)]]);
    expect(before.get("-:admin")!.updatedByName).toBeNull();

    const after = withSeatDefinitionNames(before, (id) => (id === "u-1" ? "카뮈" : null));
    expect(after!.get("-:admin")!.updatedByName).toBe("카뮈");
  });

  it("모르는 사람은 그대로 둔다 — 그때는 「누군가」가 «맞는» 말이다", () => {
    const map = new Map([["-:admin", toSeatDefinition(row)]]);
    expect(withSeatDefinitionNames(map, () => null)!.get("-:admin")!.updatedByName).toBeNull();
  });

  it("★ «못 읽음»(null)은 이름을 입혀도 여전히 «못 읽음» 이다 — 빈 Map 으로 바뀌지 않는다", () => {
    expect(withSeatDefinitionNames(null, () => "카뮈")).toBeNull();
  });

  it("쓴 사람이 없는 정의서는 건드리지 않는다", () => {
    const map = new Map([["-:admin", toSeatDefinition({ ...row, updated_by: null })]]);
    const after = withSeatDefinitionNames(map, () => "카뮈");
    expect(after!.get("-:admin")!.updatedByName).toBeNull();
  });

  it("★ 자리가 여럿이면 «전부» 돈다 — 첫 자리에만 붙이면 나머지는 계속 「누군가」다", () => {
    // 항목 하나짜리 Map 만 재면 「첫 것에만 붙인다」는 결함이 통과한다.
    // 실제 화면은 자리가 12개다.
    const map = new Map([
      ["d1:team_lead", toSeatDefinition({ ...row, updated_by: "u-1" })],
      ["d2:team_lead", toSeatDefinition({ ...row, updated_by: "u-2" })],
      ["-:member", toSeatDefinition({ ...row, updated_by: null })],
    ]);
    const names: Record<string, string> = { "u-1": "카뮈", "u-2": "데모 팀장" };
    const after = withSeatDefinitionNames(map, (id) => names[id] ?? null)!;
    expect([...after.values()].map((d) => d.updatedByName)).toEqual(["카뮈", "데모 팀장", null]);
  });
});

describe("#683 검수 P2-1 — 쓴 사람이 퇴사해도 이름이 남는다", () => {
  /*
   * 요약(활성만)에서만 이름을 찾으면 «쓴 사람이 나가는 순간» 이름이 다시 사라진다.
   * 그런데 그 옆에는 「이 자리에 앉는 사람이 바뀌어도 남아요」라고 적혀 있다 —
   * 쓴 사람이 떠난 뒤가 이 기능의 «정상 상태» 인데 정확히 그때 이름이 없어지는 것이다.
   * 그 사람은 같은 화면 「자리를 못 정한 사람」 구역에 이름까지 떠 있다.
   */
  it("★ 요약에 없는 사람을 조직도에서 건진다", () => {
    const 요약 = [{ userId: "u-1", displayName: "남아있는사람" }];
    const 조직도 = [
      { userId: "u-1", displayName: "남아있는사람" },
      { userId: "u-2", displayName: "나간사람" },
    ];
    const names = seatWriterNames([요약, 조직도]);
    expect(names.get("u-2")).toBe("나간사람");
  });

  it("★ 앞 목록이 이긴다 — 진짜 이름만 있는 출처를 앞에 둔다", () => {
    const names = seatWriterNames([
      [{ userId: "u-1", displayName: "요약 이름" }],
      [{ userId: "u-1", displayName: "조직도 이름" }],
    ]);
    expect(names.get("u-1")).toBe("요약 이름");
  });

  it("빈 이름은 넣지 않는다 — 빈 글자를 이름으로 쓰면 「이름이 있다」는 거짓말이 된다", () => {
    const names = seatWriterNames([[{ userId: "u-1", displayName: "" }], [{ userId: "u-1", displayName: "진짜 이름" }]]);
    expect(names.get("u-1")).toBe("진짜 이름");
  });

  it("★ «자리표시» 는 이름이 아니다 — 「이름 없는 구성원가 씀」이 되면 안 된다", () => {
    /*
     * 조직도는 이름이 비면 「이름 없는 구성원」을, 요약은 「이름 미등록」을 채운다.
     * 그건 사람 이름이 아니라 «이름이 없다» 는 뜻의 시스템 문구다.
     * 그대로 이름 칸에 앉히면 ① 조사가 깨지고(자음 끝) ② 모른다는 뜻이 사라진다.
     * 「누군가」는 모른다는 뜻이 문장 안에 있다.
     */
    expect(seatWriterNames([[{ userId: "u-1", displayName: "이름 없는 구성원" }]]).get("u-1")).toBeUndefined();
    expect(seatWriterNames([[{ userId: "u-2", displayName: "이름 미등록" }]]).get("u-2")).toBeUndefined();
  });

  it("자리표시를 건너뛰고 «진짜 이름» 을 뒤에서 건진다", () => {
    const names = seatWriterNames([
      [{ userId: "u-1", displayName: "이름 없는 구성원" }],
      [{ userId: "u-1", displayName: "진짜 이름" }],
    ]);
    expect(names.get("u-1")).toBe("진짜 이름");
  });

  it("앞뒤 공백만 있는 이름도 이름이 아니다", () => {
    expect(seatWriterNames([[{ userId: "u-1", displayName: "   " }]]).get("u-1")).toBeUndefined();
  });

  it("아무 데도 없는 사람은 없는 채로 둔다 — 그때는 「누군가」가 맞다", () => {
    expect(seatWriterNames([[], []]).get("u-9")).toBeUndefined();
  });
});

describe("#683 검수 후속 — 화면이 감당할 수 있는 만큼만 넘긴다", () => {
  it("★ 할 일이 아무리 많아도 상한에서 끊는다 — 거대한 배열을 화면이 그대로 다 그리지 않게", () => {
    const huge = Array.from({ length: 500 }, (_, index) => ({ cycle: "daily", text: `할일 ${index}` }));
    expect(parseSeatDuties(huge)).toHaveLength(50);
  });

  it("★ 한 줄이 너무 길면 자른다", () => {
    const long = "가".repeat(5000);
    expect(parseSeatDuties([{ cycle: "daily", text: long }])[0].text).toHaveLength(300);
    expect(parseSeatRules({ escalate: [long] }).escalate[0]).toHaveLength(300);
  });

  it("★ 판단 기준도 갈래마다 상한이 있다", () => {
    const many = Array.from({ length: 200 }, (_, index) => `줄 ${index}`);
    const rules = parseSeatRules({ escalate: many, handle: many, avoid: many });
    expect([rules.escalate.length, rules.handle.length, rules.avoid.length]).toEqual([30, 30, 30]);
  });
});

describe("#683 날짜 — 하이드레이션도 안전하고 값도 맞아야 한다", () => {
  /*
   * 두 번 틀렸던 자리다.
   *   ① 맨 toLocaleDateString  → 서버(UTC)와 브라우저(로컬)가 다른 날짜를 그려 하이드레이션 불일치
   *   ② UTC 로 못 박음         → 한국 00:00~09:00 저장분이 매일 «어제» 로 보임 (9시간 창)
   * timeZone 을 명시하면 둘 다 풀린다. 하나를 포기할 필요가 없었다.
   */
  it("★ 런타임이 timeZone 을 실제로 지킨다 — 안 지키면 이 수정이 «조용히» 안 먹는다", () => {
    /*
     * Node 를 축소 ICU(small-icu)로 빌드하면 `timeZone` 옵션이 무시된다.
     * 그러면 아래 날짜 시험들은 «실행 환경의 기본 시간대가 한국이라» 통과해 버린다 —
     * 통과하는데 고쳐진 게 아닌 상태다. Seoul 과 UTC 를 견주면 그 경우 두 값이 같아져 FAIL 한다.
     *
     * ★ 다만 이 시험이 재는 것은 **시험을 돌리는 런타임 하나**다.
     *   배포 서버와 사용자 브라우저는 다른 프로세스라 거기가 축소 ICU 여도 여기는 초록이다.
     *   즉 이 시험은 «회귀를 막는» 것이지 «배포 환경을 증명하는» 것이 아니다.
     *   그걸 증명하려면 배포 런타임에서 직접 재야 한다 — 안 한 것을 한 척하지 않는다.
     */
    const at = new Date("2026-08-31T23:00:00Z");
    expect(
      at.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }),
      "런타임이 timeZone 을 무시한다 — full-icu 가 아닌 환경이다",
    ).not.toBe(at.toLocaleDateString("ko-KR", { timeZone: "UTC" }));
  });

  it("★ 한국 이른 아침에 저장한 것이 «어제» 로 보이지 않는다", () => {
    expect(seatDefinitionDate("2026-08-31T23:00:00Z")).toBe("2026. 9. 1."); // 한국 9/1 08:00
    expect(seatDefinitionDate("2026-08-31T15:30:00Z")).toBe("2026. 9. 1."); // 한국 9/1 00:30
    expect(seatDefinitionDate("2026-09-01T00:01:00Z")).toBe("2026. 9. 1."); // 한국 9/1 09:01
  });

  it("★ 한국 자정 직전은 그날로 남는다 — 반대편으로 밀리지 않았는지", () => {
    expect(seatDefinitionDate("2026-08-31T14:59:00Z")).toBe("2026. 8. 31."); // 한국 8/31 23:59
  });

  it("못 읽는 값은 빈 글자다 — 「Invalid Date」를 화면에 뿌리지 않는다", () => {
    expect(seatDefinitionDate(null)).toBe("");
    expect(seatDefinitionDate("")).toBe("");
    expect(seatDefinitionDate("어제")).toBe("");
  });
});
