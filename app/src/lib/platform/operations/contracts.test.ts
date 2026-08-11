import { describe, expect, it } from "vitest";
import {
  PLATFORM_OPERATION_CONTRACTS,
  PLATFORM_OPERATION_SECTION_KEYS,
} from "./contracts";

describe("platform operations contracts", () => {
  it("covers the four BBE-13 sections exactly", () => {
    expect(Object.keys(PLATFORM_OPERATION_CONTRACTS)).toEqual([
      ...PLATFORM_OPERATION_SECTION_KEYS,
    ]);
  });

  it("exposes only real current readers and keeps all writes closed", () => {
    expect(PLATFORM_OPERATION_CONTRACTS.billing.currentRead).toMatchObject({
      availability: "contract-status",
      reader: "none",
    });
    expect(PLATFORM_OPERATION_CONTRACTS.access.currentRead).toMatchObject({
      availability: "contract-status",
      reader: "none",
    });
    expect(PLATFORM_OPERATION_CONTRACTS.support.currentRead).toMatchObject({
      availability: "self-scope",
      reader: "get_my_support_read_scope",
    });
    expect(PLATFORM_OPERATION_CONTRACTS.admins.currentRead).toMatchObject({
      availability: "self-scope",
      reader: "app_admin_role",
    });

    for (const contract of Object.values(PLATFORM_OPERATION_CONTRACTS)) {
      expect(contract.currentWrite).toEqual({
        enabled: false,
        policy: "separate-reviewed-contract-required",
      });
    }
  });

  it("never converts platform status into tenant access", () => {
    for (const contract of Object.values(PLATFORM_OPERATION_CONTRACTS)) {
      expect(contract.authorization).toMatchObject({
        principal: "canonical-platform-operator",
        guard: "loadPlatformActor/is_platform_admin",
        directTableAccess: false,
        platformRoleGrantsTenantAccess: false,
      });
      expect(contract.forbiddenData).toContain("활성 멤버십 없이 읽는 회사 데이터");
      expect(contract.forbiddenData).toContain("사용자 가장 또는 세션·쿠키·토큰");
    }
  });

  it("requires structured audit evidence without sensitive payloads", () => {
    for (const contract of Object.values(PLATFORM_OPERATION_CONTRACTS)) {
      expect(contract.audit.privilegedRead).toContain("탭·집계 범위·요청 시각");
      expect(contract.audit.futureMutation).toContain(
        "actor·대상 UUID·operation·before/after metadata",
      );
      expect(contract.audit.forbiddenPayload).toContain("비밀값·인증 헤더·쿠키");
      expect(contract.audit.forbiddenPayload).toContain("고객·세무 원문");
    }
  });
});
