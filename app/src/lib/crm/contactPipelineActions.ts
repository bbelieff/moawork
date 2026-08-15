"use server";

import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getCrmService } from "@/lib/crm";
import { executeContactPipelineTransition, type ContactPipelineRpcClient } from "./supabaseContactPipeline";
import type { ContactTransitionKind } from "./contactPipeline";
import { conditionFromTransitionBlockReason, type LockCondition } from "@/lib/automation/lock";

export type ContactPipelineActionState = Readonly<{
  ok: boolean;
  message: string;
  unmet?: readonly LockCondition[];
}>;

export async function mutateContactPipeline(
  _previous: ContactPipelineActionState,
  formData: FormData,
): Promise<ContactPipelineActionState> {
  void _previous;
  const kind = String(formData.get("kind") ?? "") as ContactTransitionKind;
  if (kind !== "lead_to_contact" && kind !== "contact_to_work")
    return { ok: false, message: "이동 요청이 올바르지 않습니다." };

  try {
    const ctx = await getSession();
    const dealId = String(formData.get("dealId") ?? "").trim() || null;
    const sourceItemId = String(formData.get("sourceItemId") ?? "").trim() || null;
    const requestId = String(formData.get("requestId") ?? "").trim();
    if ((!dealId && !sourceItemId) || !requestId) return { ok: false, message: "이동 요청을 다시 시작해 주세요." };
    const selectedCompanyId = String(formData.get("selectedCompanyId") ?? "").trim() || null;
    const requestedName = String(formData.get("companyName") ?? "").trim();
    const service = getCrmService();
    const deal = dealId ? await service.getDeal(ctx, dealId) : undefined;
    const selected = selectedCompanyId
      ? await service.getCompany(ctx, selectedCompanyId)
      : undefined;
    if (selectedCompanyId && !selected) {
      return { ok: false, message: "접근 가능한 업체를 다시 선택해 주세요." };
    }

    const custom = deal?.custom ?? {};
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
    const submitted = (key: string): string | null => {
      const value = String(formData.get(key) ?? "").trim();
      return value || null;
    };
    const result = await executeContactPipelineTransition(
      await createClient() as unknown as ContactPipelineRpcClient,
      {
        orgId: ctx.org.id, dealId, sourceItemId, requestId, kind,
        companyId: selected?.id ?? null,
        companyName: selected?.name ?? (requestedName || deal?.title || ""),
        bizNo: submitted("bizNo") ?? firstText("biz_no", "사업자등록번호", "사업자번호"),
        ownerName: selected?.owner_name ?? submitted("ceoName") ?? text("대표자명"),
        businessType: selected?.biz_type ?? submitted("bizType") ?? text("사업자유형"),
        industry: selected?.biz_type ?? submitted("industry") ?? text("업종/업태"),
        regionSido: submitted("regionSido") ?? firstText("sido", "시도"),
        regionSigungu: submitted("regionSigungu") ?? firstText("sigungu", "시군구"),
        phone: selected?.phone ?? submitted("phone") ?? text("연락처"),
        foundedOn: selected?.founded_on ?? submitted("foundedOn") ?? text("창업년도"),
        revenue: selected?.revenue == null ? submitted("revenue") ?? text("매출액") : String(selected.revenue),
      });
    if (result.status === "blocked") {
      const message = result.reason ?? "이동 조건을 확인해 주세요.";
      const condition = conditionFromTransitionBlockReason(message);
      return { ok: false, message, unmet: condition ? [condition] : [] };
    }
    return {
      ok: true,
      message: kind === "lead_to_contact" ? "리드컨택으로 이동했습니다." : "업체 마스터를 연결하고 업무관리로 이동했습니다.",
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "업체 연결에 실패했습니다." };
  }
}
