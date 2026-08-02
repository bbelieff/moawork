import { describe, it, expect } from "vitest";
import {
  EMPTY,
  atLeast,
  can,
  canEnterConsole,
  decideDataAccess,
  maskBizRegNo,
  maskEmail,
  maskName,
  maskPhone,
  parseAdminLevel,
} from "./access";
import { ADMIN_LEVELS, type AdminLevel } from "./types";

describe("parseAdminLevel", () => {
  it("알려진 등급만 통과시킨다", () => {
    expect(parseAdminLevel("super")).toBe("super");
    expect(parseAdminLevel("operator")).toBe("operator");
    expect(parseAdminLevel("viewer")).toBe("viewer");
  });

  it("알 수 없는 값·null 은 null 이다 (관리자로 오인 금지)", () => {
    expect(parseAdminLevel("admin")).toBeNull();
    expect(parseAdminLevel(null)).toBeNull();
    expect(parseAdminLevel(undefined)).toBeNull();
    expect(parseAdminLevel(true)).toBeNull();
    expect(parseAdminLevel({ level: "super" })).toBeNull();
  });
});

describe("atLeast — 008 platform_admin_at_least() 와 동일 규칙", () => {
  it("super > operator > viewer 서열을 지킨다", () => {
    expect(atLeast("super", "operator")).toBe(true);
    expect(atLeast("operator", "operator")).toBe(true);
    expect(atLeast("viewer", "operator")).toBe(false);
    expect(atLeast("viewer", "viewer")).toBe(true);
    expect(atLeast("operator", "super")).toBe(false);
  });

  it("관리자가 아니면 어떤 등급도 충족하지 못한다", () => {
    for (const level of ADMIN_LEVELS) {
      expect(atLeast(null, level)).toBe(false);
    }
  });
});

describe("canEnterConsole — 조회는 전 등급 동일", () => {
  it("등급이 있으면 누구나 진입한다", () => {
    for (const level of ADMIN_LEVELS) {
      expect(canEnterConsole(level)).toBe(true);
    }
  });

  it("관리자가 아니면 진입할 수 없다", () => {
    expect(canEnterConsole(null)).toBe(false);
  });
});

describe("can — 실행 권한만 등급으로 가른다", () => {
  it("viewer 는 조회만 되고 실행은 전부 막힌다", () => {
    expect(can("viewer", "resolveRequest")).toBe(false);
    expect(can("viewer", "setOrgInternal")).toBe(false);
    expect(can("viewer", "manageAdmins")).toBe(false);
    expect(can("viewer", "exportBilling")).toBe(false);
  });

  it("operator 는 운영 실행은 되지만 관리자 편집은 못 한다", () => {
    expect(can("operator", "resolveRequest")).toBe(true);
    expect(can("operator", "setOrgInternal")).toBe(true);
    expect(can("operator", "exportBilling")).toBe(true);
    expect(can("operator", "manageAdmins")).toBe(false);
  });

  it("super 는 전부 가능하다", () => {
    expect(can("super", "manageAdmins")).toBe(true);
    expect(can("super", "resolveRequest")).toBe(true);
  });

  it("비관리자는 전부 불가", () => {
    expect(can(null, "resolveRequest")).toBe(false);
    expect(can(null, "manageAdmins")).toBe(false);
  });
});

describe("마스킹 — 어깨너머 방지", () => {
  it("전화번호는 앞 3자리·끝 4자리만 남긴다", () => {
    expect(maskPhone("010-1234-5678")).toBe("010-****-5678");
    expect(maskPhone("01012345678")).toBe("010-****-5678");
  });

  it("사업자등록번호는 앞 3자리만 남긴다", () => {
    expect(maskBizRegNo("123-45-67890")).toBe("123-**-*****");
  });

  it("이메일은 로컬파트 첫 글자만 남기고 도메인은 보존한다", () => {
    expect(maskEmail("person@example.invalid")).toBe("p***@example.invalid");
  });

  it("이름은 가운데를 가린다", () => {
    expect(maskName("홍길동")).toBe("홍*동");
    expect(maskName("김철")).toBe("김*");
    expect(maskName("김")).toBe("김");
  });

  it("값이 없으면 '—' 이고 원문을 흘리지 않는다", () => {
    expect(maskPhone(null)).toBe(EMPTY);
    expect(maskBizRegNo(undefined)).toBe(EMPTY);
    expect(maskEmail("")).toBe(EMPTY);
    expect(maskName(null)).toBe(EMPTY);
  });

  it("짧은 값도 원문을 그대로 노출하지 않는다", () => {
    expect(maskPhone("123")).not.toContain("123");
    expect(maskBizRegNo("12")).not.toContain("12");
  });
});

describe("decideDataAccess — 고객 데이터 열람 게이트", () => {
  it("홈택스는 super 라도 항상 차단이다", () => {
    for (const level of [...ADMIN_LEVELS, null] as (AdminLevel | null)[]) {
      const d = decideDataAccess(level, "hometax");
      expect(d.allowed).toBe(false);
      expect(d.requiresGrant).toBe(false);
    }
  });

  it("고객의 고객 데이터는 P0에서 차단하되 '권한 필요'로 표시한다", () => {
    const d = decideDataAccess("super", "customerRecords");
    expect(d.allowed).toBe(false);
    expect(d.requiresGrant).toBe(true);
  });

  it("계약 상대 정보는 운영자면 열람 가능하다", () => {
    expect(decideDataAccess("viewer", "contract").allowed).toBe(true);
    expect(decideDataAccess("super", "contract").allowed).toBe(true);
  });

  it("비관리자는 계약 정보도 볼 수 없다", () => {
    const d = decideDataAccess(null, "contract");
    expect(d.allowed).toBe(false);
    expect(d.requiresGrant).toBe(false);
  });
});
