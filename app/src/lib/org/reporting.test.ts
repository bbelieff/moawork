import { describe, expect, it } from "vitest";
import {
  notificationTargetsFor,
  reportingChainOf,
  resolveReportsTo,
  wouldCreateDepartmentCycle,
  wouldCreateReportingCycle,
  type DepartmentNode,
  type ReportingContext,
} from "./reporting";

// UI목업_워크스페이스_최종_v6.html §조직관리 의 DEPTS/PPL 표본과 동일한 트리.
// 영업2팀(s2)이 의도적으로 공석 — 카드 착수 체크리스트가 명시한 회귀 시나리오.
const DEPARTMENTS: DepartmentNode[] = [
  { id: "root", parentId: null, headUserId: "카뮈" },
  { id: "mgmt", parentId: "root", headUserId: "정하늘" },
  { id: "sales", parentId: "root", headUserId: "이대표" },
  { id: "s1", parentId: "sales", headUserId: "박정화" },
  { id: "s2", parentId: "sales", headUserId: null }, // 공석
  { id: "ops", parentId: "root", headUserId: "이혜진" },
];

const PRIMARY_DEPT = new Map<string, string | null>([
  ["카뮈", "root"],
  ["정하늘", "mgmt"],
  ["이대표", "sales"],
  ["박정화", "s1"],
  ["김수현", "s1"],
  ["이서준", "s1"],
  ["최민아", "s2"],
  ["이혜진", "ops"],
  ["박도윤", "ops"],
  ["한지우", "ops"],
  ["신규 담당자", null], // 미배정
]);

function ctxOf(exceptions: ReadonlyMap<string, string | null> = new Map()): ReportingContext {
  return {
    departments: DEPARTMENTS,
    primaryDeptOf: PRIMARY_DEPT,
    exceptionOf: exceptions,
    ownerUserId: "카뮈",
  };
}

describe("resolveReportsTo — 유도 규칙(설계 정본 §1-3)", () => {
  it("일반 팀원은 자기 부서장에게 보고한다", () => {
    expect(resolveReportsTo("김수현", ctxOf())).toBe("박정화");
    expect(resolveReportsTo("이서준", ctxOf())).toBe("박정화");
  });

  it("부서장은 «자기 부서»가 아니라 상위 부서장에게 보고한다(②)", () => {
    expect(resolveReportsTo("박정화", ctxOf())).toBe("이대표");
    expect(resolveReportsTo("정하늘", ctxOf())).toBe("카뮈");
    expect(resolveReportsTo("이혜진", ctxOf())).toBe("카뮈");
  });

  it("공석이면 한 단계 더 위로 건너뛴다(④) — 영업2팀 공석 시나리오", () => {
    // 최민아(s2, 공석 부서)는 s2 를 건너뛰어 상위 sales 의 장(이대표)에게 보고한다.
    expect(resolveReportsTo("최민아", ctxOf())).toBe("이대표");
  });

  it("최상위에 닿으면 소유자에게 보고한다(⑤)", () => {
    expect(resolveReportsTo("이대표", ctxOf())).toBe("카뮈");
  });

  it("소유자 본인은 아무에게도 보고하지 않는다(자기 자신 제외)", () => {
    expect(resolveReportsTo("카뮈", ctxOf())).toBeNull();
  });

  it("미배정자는 소유자에게 보고한다(§1-2 — 조용히 사라지지 않는다)", () => {
    expect(resolveReportsTo("신규 담당자", ctxOf())).toBe("카뮈");
  });

  it("예외 지정이 있으면 트리를 무시하고 그 사람에게 간다(①)", () => {
    const exceptions = new Map([["김수현", "이혜진"]]);
    expect(resolveReportsTo("김수현", ctxOf(exceptions))).toBe("이혜진");
  });

  it("예외 지정이 본인이면(비정상 값) 소유자로 안전 수렴한다", () => {
    const exceptions = new Map([["김수현", "김수현"]]);
    expect(resolveReportsTo("김수현", ctxOf(exceptions))).toBe("카뮈");
  });

  it("맵에 없는(존재 모르는) 사람은 미배정과 동일하게 소유자로 수렴한다", () => {
    expect(resolveReportsTo("유령", ctxOf())).toBe("카뮈");
  });
});

describe("reportingChainOf", () => {
  it("최상위까지 경로를 순서대로 반환한다", () => {
    expect(reportingChainOf("박정화", ctxOf())).toEqual(["이대표", "카뮈"]);
  });

  it("소유자는 빈 경로", () => {
    expect(reportingChainOf("카뮈", ctxOf())).toEqual([]);
  });

  it("순환이 섞여도 무한루프에 빠지지 않는다", () => {
    const exceptions = new Map([
      ["김수현", "박정화"],
      ["박정화", "김수현"],
    ]);
    const chain = reportingChainOf("김수현", ctxOf(exceptions), 50);
    expect(chain.length).toBeLessThan(50);
    expect(chain).toEqual(["박정화", "김수현"]);
  });
});

describe("notificationTargetsFor — D19: 담당자 + 직속 상사", () => {
  it("상사가 있으면 담당자와 상사 두 명", () => {
    expect(notificationTargetsFor("김수현", ctxOf())).toEqual(["김수현", "박정화"]);
  });

  it("더 이상 보고할 곳이 없으면(소유자 본인) 본인만", () => {
    expect(notificationTargetsFor("카뮈", ctxOf())).toEqual(["카뮈"]);
  });
});

describe("wouldCreateDepartmentCycle — §4-2 자기 자손 밑으로 이동 금지", () => {
  it("자기 자신 밑으로 이동은 순환", () => {
    expect(wouldCreateDepartmentCycle(DEPARTMENTS, "sales", "sales")).toBe(true);
  });

  it("자손 부서 밑으로 이동은 순환", () => {
    expect(wouldCreateDepartmentCycle(DEPARTMENTS, "sales", "s1")).toBe(true);
  });

  it("무관한 부서로 이동은 순환이 아니다", () => {
    expect(wouldCreateDepartmentCycle(DEPARTMENTS, "ops", "mgmt")).toBe(false);
  });

  it("최상위로 이동(부모 없음)은 항상 안전", () => {
    expect(wouldCreateDepartmentCycle(DEPARTMENTS, "s1", null)).toBe(false);
  });
});

describe("wouldCreateReportingCycle — 트리 경유까지 섞인 예외 순환 검사", () => {
  it("직접 자기참조는 순환", () => {
    expect(wouldCreateReportingCycle("김수현", "김수현", ctxOf())).toBe(true);
  });

  it("예외 한 단계 뒤 트리 경로로 돌아와도 잡아낸다", () => {
    // 박정화가 김수현에게 보고하도록 예외를 걸면, 김수현은 트리상 박정화에게
    // 보고하므로(순수 예외 체인이 아니라 트리로 넘어가는 지점에서) A→B→A 순환이 된다.
    expect(wouldCreateReportingCycle("박정화", "김수현", ctxOf())).toBe(true);
  });

  it("무관한 대상으로의 예외 지정은 순환이 아니다", () => {
    expect(wouldCreateReportingCycle("김수현", "이혜진", ctxOf())).toBe(false);
  });
});
