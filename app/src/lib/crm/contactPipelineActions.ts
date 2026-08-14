"use server";

import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getCrmService } from "@/lib/crm";
import {
  handoffCompanyWithSupabase,
  type CompanyHandoffRpcClient,
} from "@/lib/company/supabase-handoff";

export type ContactPipelineActionState = Readonly<{
  ok: boolean;
  message: string;
}>;

const CONTACT_PIPELINE_ROLLOUT_BLOCKED_MESSAGE =
  "이 이동 경로는 아직 사용할 수 없습니다.";

export async function mutateContactPipeline(
  _previous: ContactPipelineActionState,
  formData: FormData,
): Promise<ContactPipelineActionState> {
  void _previous;
  const kind = String(formData.get("kind") ?? "");
  if (kind !== "contact_to_work") {
    return { ok: false, message: CONTACT_PIPELINE_ROLLOUT_BLOCKED_MESSAGE };
  }

  try {
    const ctx = await getSession();
    const dealId = String(formData.get("dealId") ?? "").trim();
    const selectedCompanyId = String(formData.get("selectedCompanyId") ?? "").trim() || null;
    const requestedName = String(formData.get("companyName") ?? "").trim();
    if (!dealId) return { ok: false, message: "업무 건을 확인할 수 없습니다." };

    const service = getCrmService();
    const deal = await service.getDeal(ctx, dealId);
    const selected = selectedCompanyId
      ? await service.getCompany(ctx, selectedCompanyId)
      : undefined;
    if (selectedCompanyId && !selected) {
      return { ok: false, message: "접근 가능한 업체를 다시 선택해 주세요." };
    }

    const custom = deal.custom ?? {};
    const text = (key: string): string | null => {
      const value = custom[key];
      return typeof value === "string" && value.trim() ? value.trim() : null;
    };
    const firstText = (...keys: string[]): string | null => {
      for (const key of keys) {
        const value = text(key);
        if (value) return value;
      }
      return null;
    };
    const result = await handoffCompanyWithSupabase(
      await createClient() as unknown as CompanyHandoffRpcClient,
      ctx.org.id,
      {
        dealId,
        existingCompanyId: selected?.id ?? null,
        name: selected?.name ?? (requestedName || deal.title),
        bizNo: firstText("biz_no", "사업자등록번호", "사업자번호"),
        ceoName: selected?.owner_name ?? text("대표자명"),
        bizType: selected?.biz_type ?? text("사업자유형"),
        industry: selected?.biz_type ?? text("업종/업태"),
        regionSido: firstText("sido", "시도"),
        regionSigungu: firstText("sigungu", "시군구"),
        phone: selected?.phone ?? text("연락처"),
        foundedOn: selected?.founded_on ?? text("창업년도"),
        revenue: selected?.revenue === null || selected?.revenue === undefined
          ? text("매출액")
          : String(selected.revenue),
      },
    );
    return {
      ok: true,
      message: result.mode === "created_needs_review"
        ? "업체를 연결했고 중복 의심 검토 항목을 남겼습니다."
        : "업체 마스터와 업무 건을 연결했습니다.",
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "업체 연결에 실패했습니다." };
  }
}
