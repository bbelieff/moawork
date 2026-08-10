import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDownloadUrl, issueFileToken, verifyFileToken } from "./fileSignedUrl";

const ORIGINAL_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

beforeEach(() => {
  // 서명 키를 고정해 테스트 간 흔들리지 않게 한다.
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-secret-key";
});

afterEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_KEY;
  vi.useRealTimers();
});

describe("issueFileToken / verifyFileToken", () => {
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

  it("서명 키가 다르면(다른 환경) 검증에 실패한다", () => {
    const token = issueFileToken("deal-1", "file-1", 60_000);
    process.env.SUPABASE_SERVICE_ROLE_KEY = "different-secret";
    expect(verifyFileToken(token)).toBeNull();
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
