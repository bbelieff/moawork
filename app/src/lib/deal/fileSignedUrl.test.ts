import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDownloadUrl, issueFileToken, verifyFileToken } from "./fileSignedUrl";

const ORIGINAL_ACTIONS_KEY = process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY;
const ACTIONS_KEY = Buffer.alloc(32, 7).toString("base64");

beforeEach(() => {
  process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY = ACTIONS_KEY;
});

afterEach(() => {
  if (ORIGINAL_ACTIONS_KEY === undefined) {
    delete process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY;
  } else {
    process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY = ORIGINAL_ACTIONS_KEY;
  }
  vi.useRealTimers();
});

describe("issueFileToken / verifyFileToken", () => {
  it("기본 다운로드 토큰은 정확히 5분 뒤 만료된다", () => {
    vi.useFakeTimers();
    const now = new Date("2026-09-08T00:00:00.000Z");
    vi.setSystemTime(now);

    const verified = verifyFileToken(issueFileToken("deal-1", "file-1"));

    expect(verified?.exp).toBe(now.getTime() + 5 * 60 * 1000);
  });

  it("정상 발급한 토큰은 검증을 통과하고 원래 값을 돌려준다", () => {
    const token = issueFileToken("deal-1", "file-1", 60_000);
    const verified = verifyFileToken(token);
    expect(verified).not.toBeNull();
    expect(verified!.dealId).toBe("deal-1");
    expect(verified!.fileId).toBe("file-1");
  });

  it("서명을 위조하면 거부된다", () => {
    const token = issueFileToken("deal-1", "file-1", 60_000);
    const tampered = token.slice(0, -1) + (token.at(-1) === "a" ? "b" : "a");
    expect(verifyFileToken(tampered)).toBeNull();
  });

  it("dealId/fileId 를 바꿔치기하면(서명은 그대로 옮겨붙여도) 거부된다", () => {
    const token = issueFileToken("deal-1", "file-1", 60_000);
    const [, fileId, exp, sig] = token.split(".");
    const forged = `deal-2.${fileId}.${exp}.${sig}`;
    expect(verifyFileToken(forged)).toBeNull();
  });

  it("만료 시각이 지나면 거부된다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const token = issueFileToken("deal-1", "file-1", 1_000);
    vi.setSystemTime(new Date("2026-01-01T00:00:02.000Z")); // 2초 후 — 만료
    expect(verifyFileToken(token)).toBeNull();
  });

  it("만료 전이면 통과한다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const token = issueFileToken("deal-1", "file-1", 60_000);
    vi.setSystemTime(new Date("2026-01-01T00:00:30.000Z"));
    expect(verifyFileToken(token)).not.toBeNull();
  });

  it("형식이 어긋난 토큰은 던지지 않고 null", () => {
    expect(verifyFileToken("")).toBeNull();
    expect(verifyFileToken("a.b.c")).toBeNull();
    expect(verifyFileToken("a.b.c.d.e")).toBeNull();
  });

  it("안정키가 다르면(다른 환경) 검증에 실패한다", () => {
    const token = issueFileToken("deal-1", "file-1", 60_000);
    process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64");
    expect(verifyFileToken(token)).toBeNull();
  });

  it("service_role 키가 같은 프로세스에 있어도 신규 토큰에 영향을 주지 않는다", () => {
    const token = issueFileToken("deal-1", "file-1", 60_000);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-must-not-sign");
    try {
      expect(verifyFileToken(token)).not.toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // 야간 배치(platform-metrics)가 같은 서버에서 돌면서 service_role 을 쓰더라도,
  // 그 키로 서명한 토큰이 다운로드에 통과하면 안 된다. 예전 Vercel 전환 호환 경로가
  // 정확히 그 구멍이었으므로 다시 생기지 않게 막는다.
  it("service_role 키로 서명한 토큰은 거부된다", () => {
    const serviceRole = "service-role-must-not-sign";
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", serviceRole);
    try {
      const payload = `deal-1.file-1.${Date.now() + 60_000}`;
      const forged = `${payload}.${createHmac("sha256", serviceRole).update(payload).digest("base64url")}`;
      expect(verifyFileToken(forged)).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("형식이 잘못된 안정키는 service-role로 조용히 폴백하지 않는다", () => {
    process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY = "not-canonical-base64";
    expect(() => issueFileToken("deal-1", "file-1")).toThrow(
      "파일 다운로드 안정키 설정이 올바르지 않습니다.",
    );
  });

  it("프로덕션에서 서버 서명 키가 없으면 고정 개발키로 폴백하지 않는다", () => {
    delete process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY;
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() => issueFileToken("deal-1", "file-1")).toThrow(
        "파일 다운로드 서명 설정이 없습니다.",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("buildDownloadUrl", () => {
  it("경로와 토큰 쿼리를 포함한다", () => {
    const url = buildDownloadUrl("deal-1", "file-1", 60_000);
    expect(url).toMatch(/^\/api\/deals\/deal-1\/files\/file-1\?token=/);

    const token = decodeURIComponent(url.split("token=")[1]);
    const verified = verifyFileToken(token);
    expect(verified?.dealId).toBe("deal-1");
    expect(verified?.fileId).toBe("file-1");
  });
});
