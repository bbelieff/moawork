import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getSession,
  createClient,
  getDeal,
  getCompany,
  handoffCompanyWithSupabase,
} = vi.hoisted(() => ({
  getSession: vi.fn(),
  createClient: vi.fn(),
  getDeal: vi.fn(),
  getCompany: vi.fn(),
  handoffCompanyWithSupabase: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/crm", () => ({
  getCrmService: () => ({ getDeal, getCompany }),
}));
vi.mock("@/lib/company/supabase-handoff", () => ({ handoffCompanyWithSupabase }));

import { mutateContactPipeline } from "./contactPipelineActions";

describe("contact pipeline company handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ org: { id: "org-1" } });
    createClient.mockResolvedValue({ rpc: vi.fn() });
    getDeal.mockResolvedValue({
      id: "deal-1",
      pipeline_id: "pipeline-1",
      title: "새봄상사",
      custom: {
        대표자명: "김대표",
        사업자등록번호: "123-45-67890",
        시도: "서울",
        시군구: "강남구",
      },
    });
    getCompany.mockResolvedValue(undefined);
    handoffCompanyWithSupabase.mockResolvedValue({
      dealId: "deal-1",
      companyId: "company-1",
      mode: "created",
      duplicateCandidateIds: [],
    });
  });

  it("keeps lead-to-contact closed outside the BBE-125 handoff", async () => {
    const form = new FormData();
    form.set("kind", "lead_to_contact");

    await expect(mutateContactPipeline({ ok: false, message: "" }, form)).resolves.toEqual({
      ok: false,
      message: "이 이동 경로는 아직 사용할 수 없습니다.",
    });
    expect(handoffCompanyWithSupabase).not.toHaveBeenCalled();
  });

  it("links a contact-to-work move through the atomic company handoff", async () => {
    const form = new FormData();
    form.set("kind", "contact_to_work");
    form.set("dealId", "deal-1");
    form.set("companyName", "새봄상사");

    await expect(mutateContactPipeline({ ok: false, message: "" }, form)).resolves.toEqual({
      ok: true,
      message: "업체 마스터와 업무 건을 연결했습니다.",
    });
    expect(handoffCompanyWithSupabase).toHaveBeenCalledWith(
      expect.anything(),
      "org-1",
      expect.objectContaining({
        dealId: "deal-1",
        existingCompanyId: null,
        name: "새봄상사",
        bizNo: "123-45-67890",
        ceoName: "김대표",
        regionSido: "서울",
        regionSigungu: "강남구",
      }),
    );
  });

  it("rejects a selected company that is outside the visible scope", async () => {
    const form = new FormData();
    form.set("kind", "contact_to_work");
    form.set("dealId", "deal-1");
    form.set("selectedCompanyId", "hidden-company");

    await expect(mutateContactPipeline({ ok: false, message: "" }, form)).resolves.toEqual({
      ok: false,
      message: "접근 가능한 업체를 다시 선택해 주세요.",
    });
    expect(handoffCompanyWithSupabase).not.toHaveBeenCalled();
  });
});
