import { beforeEach, describe, expect, it, vi } from "vitest";

// ★ 이 테스트는 «실제 서버 액션» 을 부른다. 헬퍼 함수만 부르면 권한 검사·검증·배선을
//   지나지 않아 아무것도 증명하지 못한다 (이 저장소가 반복해 밟은 자리).
//   getSession / createClient / revalidatePath 만 가짜로 바꾸고 액션 본문은 진짜다.

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  revalidate: vi.fn(),
  rpc: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  maybeSingle: vi.fn(),
  createClient: vi.fn(),
  calls: [] as string[],
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import {
  removeOrgLogoAction,
  uploadOrgLogoAction,
} from "./logo-actions";
import { ORG_LOGO_IDLE } from "@/lib/org-logo/contracts";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";

function pngFile(bytes: number, type = "image/png", name = "logo.png") {
  return new File([new Uint8Array(bytes)], name, { type });
}

function formWith(file: unknown, extra: Record<string, string> = {}) {
  const form = new FormData();
  if (file !== undefined) form.set("logo", file as Blob);
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls.length = 0;
  mocks.session.mockResolvedValue({ org: { id: ORG, name: "샘플 회사" }, role: "owner", user: { id: "u1" } });
  mocks.maybeSingle.mockResolvedValue({ data: { logo_path: null }, error: null });
  mocks.upload.mockImplementation(async (path: string) => {
    mocks.calls.push(`upload:${path}`);
    return { data: { path }, error: null };
  });
  mocks.remove.mockImplementation(async (paths: string[]) => {
    mocks.calls.push(`remove:${paths.join(",")}`);
    return { data: null, error: null };
  });
  mocks.rpc.mockImplementation(async (name: string, params: Record<string, unknown>) => {
    mocks.calls.push(`rpc:${name}:${String(params.p_org_id)}:${String(params.p_path ?? "")}`);
    return { data: null, error: null };
  });
  mocks.createClient.mockResolvedValue({
    rpc: mocks.rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }),
    storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove }) },
  });
});

describe("uploadOrgLogoAction — 권한", () => {
  it("★ member 는 거부된다. Storage 도 RPC 도 부르지 않는다", async () => {
    mocks.session.mockResolvedValue({ org: { id: ORG, name: "샘플" }, role: "member", user: { id: "u2" } });
    const result = await uploadOrgLogoAction(ORG_LOGO_IDLE, formWith(pngFile(1000)));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("permission");
    expect(result.message).toContain("대표와 관리자만");
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("★ team_lead 도 거부된다", async () => {
    mocks.session.mockResolvedValue({ org: { id: ORG, name: "샘플" }, role: "team_lead", user: { id: "u3" } });
    const result = await uploadOrgLogoAction(ORG_LOGO_IDLE, formWith(pngFile(1000)));
    expect(result.reason).toBe("permission");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("owner 와 admin 은 통과한다", async () => {
    for (const role of ["owner", "admin"]) {
      vi.clearAllMocks();
      mocks.session.mockResolvedValue({ org: { id: ORG, name: "샘플" }, role, user: { id: "u1" } });
      mocks.maybeSingle.mockResolvedValue({ data: { logo_path: null }, error: null });
      mocks.upload.mockResolvedValue({ data: {}, error: null });
      mocks.rpc.mockResolvedValue({ data: null, error: null });
      const result = await uploadOrgLogoAction(ORG_LOGO_IDLE, formWith(pngFile(1000)));
      expect(result.ok, role).toBe(true);
      expect(result.message).toContain("저장했어요");
    }
  });
});

describe("uploadOrgLogoAction — 서버측 검증 (화면 제한을 믿지 않는다)", () => {
  it("★ 용량 초과를 서버가 거부한다 — 1MiB 경계", async () => {
    const result = await uploadOrgLogoAction(ORG_LOGO_IDLE, formWith(pngFile(1048577)));
    expect(result.reason).toBe("too_large");
    expect(result.message).toContain("1MB");
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("정확히 1MiB 는 통과한다", async () => {
    const result = await uploadOrgLogoAction(ORG_LOGO_IDLE, formWith(pngFile(1048576)));
    expect(result.ok).toBe(true);
  });

  it("★ 허용되지 않은 형식을 서버가 거부한다", async () => {
    for (const mime of ["image/gif", "text/html", "application/pdf", ""]) {
      const result = await uploadOrgLogoAction(ORG_LOGO_IDLE, formWith(pngFile(500, mime)));
      expect(result.reason, mime).toBe("bad_format");
      expect(result.message).toContain("PNG");
    }
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("빈 파일과 파일 없음은 형식·용량과 다른 사유다", async () => {
    expect((await uploadOrgLogoAction(ORG_LOGO_IDLE, formWith(pngFile(0)))).reason).toBe("empty");
    expect((await uploadOrgLogoAction(ORG_LOGO_IDLE, formWith(undefined))).reason).toBe("empty");
  });

  it("★ 실패 사유마다 문구가 서로 다르다 (BBE-193)", async () => {
    const messages = new Set<string>();
    mocks.session.mockResolvedValue({ org: { id: ORG, name: "샘플" }, role: "member", user: { id: "u2" } });
    messages.add((await uploadOrgLogoAction(ORG_LOGO_IDLE, formWith(pngFile(10)))).message);
    mocks.session.mockResolvedValue({ org: { id: ORG, name: "샘플" }, role: "owner", user: { id: "u1" } });
    messages.add((await uploadOrgLogoAction(ORG_LOGO_IDLE, formWith(pngFile(0)))).message);
    messages.add((await uploadOrgLogoAction(ORG_LOGO_IDLE, formWith(pngFile(10, "image/gif")))).message);
    messages.add((await uploadOrgLogoAction(ORG_LOGO_IDLE, formWith(pngFile(1048577)))).message);
    mocks.upload.mockResolvedValue({ data: null, error: { message: "boom" } });
    messages.add((await uploadOrgLogoAction(ORG_LOGO_IDLE, formWith(pngFile(10)))).message);
    // 권한 · 빈파일 · 형식 · 용량 · 업로드실패 = 5가지가 전부 다른 문구여야 한다.
    expect(messages.size).toBe(5);
  });
});

describe("uploadOrgLogoAction — 조직 필터", () => {
  it("★ 경로는 서버가 세션의 org 로 조립한다. formData 로 org 를 바꿀 수 없다", async () => {
    await uploadOrgLogoAction(ORG_LOGO_IDLE, formWith(pngFile(10), { orgId: OTHER_ORG, path: `${OTHER_ORG}/evil.png` }));
    const uploadCall = mocks.calls.find((c) => c.startsWith("upload:"));
    const rpcCall = mocks.calls.find((c) => c.startsWith("rpc:set_org_logo"));
    expect(uploadCall).toContain(`upload:${ORG}/`);
    expect(uploadCall).not.toContain(OTHER_ORG);
    expect(rpcCall).toContain(`:${ORG}:`);
    expect(rpcCall).not.toContain(OTHER_ORG);
  });

  it("업로드 경로와 RPC 에 넘기는 경로가 같다", async () => {
    await uploadOrgLogoAction(ORG_LOGO_IDLE, formWith(pngFile(10)));
    const uploaded = mocks.calls.find((c) => c.startsWith("upload:"))?.slice("upload:".length);
    expect(mocks.rpc).toHaveBeenCalledWith("set_org_logo", expect.objectContaining({ p_org_id: ORG, p_path: uploaded }));
  });
});

describe("uploadOrgLogoAction — 실패 경로", () => {
  it("★ Storage 업로드가 실패하면 실패로 알리고 RPC 를 부르지 않는다", async () => {
    mocks.upload.mockResolvedValue({ data: null, error: { message: "network" } });
    const result = await uploadOrgLogoAction(ORG_LOGO_IDLE, formWith(pngFile(10)));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("upload_failed");
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("★ RPC 가 거부하면 방금 올린 파일을 지우고 실패로 알린다", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "org logo denied" } });
    const result = await uploadOrgLogoAction(ORG_LOGO_IDLE, formWith(pngFile(10)));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("permission");
    const uploaded = mocks.calls.find((c) => c.startsWith("upload:"))?.slice("upload:".length);
    expect(mocks.remove).toHaveBeenCalledWith([uploaded]);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("★ RPC 의 22023 사유를 형식·용량으로 구분해 옮긴다", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "org logo size rejected" } });
    expect((await uploadOrgLogoAction(ORG_LOGO_IDLE, formWith(pngFile(10)))).reason).toBe("too_large");
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "org logo format rejected" } });
    expect((await uploadOrgLogoAction(ORG_LOGO_IDLE, formWith(pngFile(10)))).reason).toBe("bad_format");
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    expect((await uploadOrgLogoAction(ORG_LOGO_IDLE, formWith(pngFile(10)))).reason).toBe("unavailable");
  });

  it("성공했을 때만 화면을 갱신한다", async () => {
    await uploadOrgLogoAction(ORG_LOGO_IDLE, formWith(pngFile(10)));
    expect(mocks.revalidate).toHaveBeenCalledWith("/settings/members");
    expect(mocks.revalidate).toHaveBeenCalledWith("/", "layout");
  });

  it("로고를 바꾸면 이전 파일을 지운다", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { logo_path: `${ORG}/old.png` }, error: null });
    await uploadOrgLogoAction(ORG_LOGO_IDLE, formWith(pngFile(10)));
    expect(mocks.remove).toHaveBeenCalledWith([`${ORG}/old.png`]);
  });
});

describe("removeOrgLogoAction", () => {
  it("★ member 는 거부된다", async () => {
    mocks.session.mockResolvedValue({ org: { id: ORG, name: "샘플" }, role: "member", user: { id: "u2" } });
    const result = await removeOrgLogoAction(ORG_LOGO_IDLE, new FormData());
    expect(result.reason).toBe("permission");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("owner 는 지우고 파일도 치운다", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { logo_path: `${ORG}/old.png` }, error: null });
    const result = await removeOrgLogoAction(ORG_LOGO_IDLE, new FormData());
    expect(result.ok).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("clear_org_logo", { p_org_id: ORG });
    expect(mocks.remove).toHaveBeenCalledWith([`${ORG}/old.png`]);
  });

  it("★ RPC 가 실패하면 성공으로 위장하지 않는다", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "org logo denied" } });
    const result = await removeOrgLogoAction(ORG_LOGO_IDLE, new FormData());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("permission");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
