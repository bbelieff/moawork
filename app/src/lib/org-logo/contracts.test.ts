import { describe, expect, it } from "vitest";
import {
  ORG_LOGO_ALLOWED_MIME,
  ORG_LOGO_MAX_BYTES,
  orgLogoFailureMessage,
  orgLogoObjectPath,
  orgLogoReasonFromRpcError,
  validateOrgLogoUpload,
} from "./contracts";

const ORG = "11111111-1111-4111-8111-111111111111";

describe("validateOrgLogoUpload", () => {
  it("허용 형식 3종을 통과시킨다", () => {
    for (const mime of ORG_LOGO_ALLOWED_MIME) {
      expect(validateOrgLogoUpload({ mime, bytes: 1000 })).toEqual({ ok: true, mime });
    }
  });

  it("사유를 뭉개지 않는다 — 빈파일·형식·용량이 각각 다르다", () => {
    expect(validateOrgLogoUpload({ mime: "image/png", bytes: 0 })).toEqual({ ok: false, reason: "empty" });
    expect(validateOrgLogoUpload({ mime: "image/gif", bytes: 10 })).toEqual({ ok: false, reason: "bad_format" });
    expect(validateOrgLogoUpload({ mime: "image/png", bytes: ORG_LOGO_MAX_BYTES + 1 })).toEqual({ ok: false, reason: "too_large" });
  });

  it("1 MiB 경계를 정확히 잡는다", () => {
    expect(validateOrgLogoUpload({ mime: "image/png", bytes: ORG_LOGO_MAX_BYTES }).ok).toBe(true);
    expect(validateOrgLogoUpload({ mime: "image/png", bytes: ORG_LOGO_MAX_BYTES + 1 }).ok).toBe(false);
    expect(ORG_LOGO_MAX_BYTES).toBe(1048576);
  });
});

describe("orgLogoObjectPath — 첫 폴더가 org_id 여야 한다", () => {
  it("확장자를 mime 에서 정한다", () => {
    expect(orgLogoObjectPath(ORG, "image/png", "abc")).toBe(`${ORG}/abc.png`);
    expect(orgLogoObjectPath(ORG, "image/jpeg", "abc")).toBe(`${ORG}/abc.jpg`);
    expect(orgLogoObjectPath(ORG, "image/svg+xml", "abc")).toBe(`${ORG}/abc.svg`);
  });

  it("★ 조직 id 가 uuid 가 아니면 경로를 만들지 않는다", () => {
    expect(() => orgLogoObjectPath("../other", "image/png", "abc")).toThrow();
    expect(() => orgLogoObjectPath("", "image/png", "abc")).toThrow();
  });

  it("★ 토큰으로 경로를 벗어날 수 없다", () => {
    expect(() => orgLogoObjectPath(ORG, "image/png", "../evil")).toThrow();
    expect(() => orgLogoObjectPath(ORG, "image/png", "a/b")).toThrow();
    expect(() => orgLogoObjectPath(ORG, "image/png", "")).toThrow();
  });
});

describe("orgLogoReasonFromRpcError — 권한과 장애를 구분한다 (BBE-90 규약)", () => {
  it("42501 은 권한", () => {
    expect(orgLogoReasonFromRpcError({ code: "42501" })).toBe("permission");
  });

  it("098 이 던지는 22023 사유를 각각 옮긴다", () => {
    expect(orgLogoReasonFromRpcError({ code: "22023", message: "org logo format rejected" })).toBe("bad_format");
    expect(orgLogoReasonFromRpcError({ code: "22023", message: "org logo size rejected" })).toBe("too_large");
  });

  it("모르는 오류는 «장애» 다 — 권한 문제로 위장하지 않는다", () => {
    expect(orgLogoReasonFromRpcError({ code: "XX000", message: "boom" })).toBe("unavailable");
    expect(orgLogoReasonFromRpcError(null)).toBe("unavailable");
  });
});

describe("orgLogoFailureMessage", () => {
  it("★ 모든 사유가 서로 다른 문구를 가진다 (BBE-193)", () => {
    const reasons = ["permission", "empty", "bad_format", "too_large", "upload_failed", "unavailable"] as const;
    const messages = reasons.map(orgLogoFailureMessage);
    expect(new Set(messages).size).toBe(reasons.length);
    for (const message of messages) expect(message.length).toBeGreaterThan(0);
  });
});
