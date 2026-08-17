import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  select: vi.fn(),
  createSignedUrls: vi.fn(),
  createSignedUrl: vi.fn(),
  storageFrom: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { loadOrgLogoSignedUrls, loadOrgLogoView, ORG_LOGO_SIGNED_URL_TTL_SECONDS } from "./server";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

type Row = { id: string; logo_path: string | null };
type Signed = { path: string; signedUrl: string | null; error?: string };
type ClientOptions = {
  rows?: Row[];
  selectError?: unknown;
  signed?: Signed[];
  signError?: unknown;
};

/** orgs 조회 결과와 서명 결과를 주입해 «실제 로더» 를 돌린다. */
function client({ rows = [], selectError = null, signed = [], signError = null }: ClientOptions) {
  mocks.select.mockReturnValue({
    in: () => Promise.resolve({ data: selectError ? null : rows, error: selectError }),
    eq: () => ({ maybeSingle: () => Promise.resolve({ data: selectError ? null : rows[0] ?? null, error: selectError }) }),
  });
  mocks.createSignedUrls.mockResolvedValue({ data: signError ? null : signed, error: signError });
  mocks.createSignedUrl.mockResolvedValue({
    data: signError ? null : { signedUrl: signed[0]?.signedUrl ?? null },
    error: signError,
  });
  mocks.storageFrom.mockReturnValue({
    createSignedUrls: mocks.createSignedUrls,
    createSignedUrl: mocks.createSignedUrl,
  });
  return { from: () => ({ select: mocks.select }), storage: { from: mocks.storageFrom } };
}

beforeEach(() => vi.clearAllMocks());

describe("loadOrgLogoSignedUrls", () => {
  it("★ 로고가 하나도 없으면 Storage 를 아예 부르지 않는다 (왕복 0)", async () => {
    mocks.createClient.mockResolvedValue(client({ rows: [{ id: ORG_A, logo_path: null }, { id: ORG_B, logo_path: null }] }));
    const result = await loadOrgLogoSignedUrls([ORG_A, ORG_B]);
    expect(result.size).toBe(0);
    expect(mocks.storageFrom).not.toHaveBeenCalled();
    expect(mocks.createSignedUrls).not.toHaveBeenCalled();
  });

  it("★ 조직이 여럿이어도 서명 왕복은 «한 번» 이다", async () => {
    mocks.createClient.mockResolvedValue(client({
      rows: [{ id: ORG_A, logo_path: `${ORG_A}/a.png` }, { id: ORG_B, logo_path: `${ORG_B}/b.png` }],
      signed: [
        { path: `${ORG_A}/a.png`, signedUrl: "https://s.invalid/a" },
        { path: `${ORG_B}/b.png`, signedUrl: "https://s.invalid/b" },
      ],
    }));
    const result = await loadOrgLogoSignedUrls([ORG_A, ORG_B]);
    expect(mocks.createSignedUrls).toHaveBeenCalledTimes(1);
    expect(mocks.createSignedUrls).toHaveBeenCalledWith(
      [`${ORG_A}/a.png`, `${ORG_B}/b.png`],
      ORG_LOGO_SIGNED_URL_TTL_SECONDS,
    );
    expect(result.get(ORG_A)).toBe("https://s.invalid/a");
    expect(result.get(ORG_B)).toBe("https://s.invalid/b");
  });

  it("★ 마이그레이션 적용 전(컬럼 없음)에도 화면이 깨지지 않는다 — 이니셜로 떨어진다", async () => {
    mocks.createClient.mockResolvedValue(client({
      selectError: { code: "42703", message: 'column orgs.logo_path does not exist' },
    }));
    const result = await loadOrgLogoSignedUrls([ORG_A]);
    expect(result.size).toBe(0);
    expect(mocks.createSignedUrls).not.toHaveBeenCalled();
  });

  it("서명이 실패한 항목은 빼고 준다 — 깨진 URL 을 내려보내지 않는다", async () => {
    mocks.createClient.mockResolvedValue(client({
      rows: [{ id: ORG_A, logo_path: `${ORG_A}/a.png` }, { id: ORG_B, logo_path: `${ORG_B}/b.png` }],
      signed: [
        { path: `${ORG_A}/a.png`, signedUrl: "https://s.invalid/a" },
        { path: `${ORG_B}/b.png`, signedUrl: null, error: "not found" },
      ],
    }));
    const result = await loadOrgLogoSignedUrls([ORG_A, ORG_B]);
    expect(result.get(ORG_A)).toBe("https://s.invalid/a");
    expect(result.has(ORG_B)).toBe(false);
  });

  it("빈 목록이면 Supabase 자체를 부르지 않는다", async () => {
    expect((await loadOrgLogoSignedUrls([])).size).toBe(0);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

describe("loadOrgLogoView — 「아직 없음」과 「불러오지 못함」을 구분한다", () => {
  it("로고가 없으면 none 이다 (장애가 아니다)", async () => {
    mocks.createClient.mockResolvedValue(client({ rows: [{ id: ORG_A, logo_path: null }] }));
    expect(await loadOrgLogoView(ORG_A)).toEqual({ kind: "none" });
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
  });

  it("로고가 있으면 서명 URL 을 준다", async () => {
    mocks.createClient.mockResolvedValue(client({
      rows: [{ id: ORG_A, logo_path: `${ORG_A}/a.png` }],
      signed: [{ path: `${ORG_A}/a.png`, signedUrl: "https://s.invalid/a" }],
    }));
    expect(await loadOrgLogoView(ORG_A)).toEqual({ kind: "ready", signedUrl: "https://s.invalid/a" });
  });

  it("★ 조회가 실패하면 «없음» 으로 위장하지 않는다", async () => {
    mocks.createClient.mockResolvedValue(client({ selectError: { code: "42703", message: "no column" } }));
    expect(await loadOrgLogoView(ORG_A)).toEqual({ kind: "unavailable" });
  });

  it("★ 서명에 실패해도 «없음» 으로 위장하지 않는다", async () => {
    mocks.createClient.mockResolvedValue(client({
      rows: [{ id: ORG_A, logo_path: `${ORG_A}/a.png` }],
      signError: { message: "denied" },
    }));
    expect(await loadOrgLogoView(ORG_A)).toEqual({ kind: "unavailable" });
  });
});
