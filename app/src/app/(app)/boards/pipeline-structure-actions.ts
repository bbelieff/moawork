"use server";

import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type PipelineStructureResult = {
  ok: boolean; message: string;
  pipelineId?: string; pipelineName?: string; missing?: string[];
};

export async function pipelineStructureAction(input: {
  itemId: string; apply?: boolean; pipelineId?: string; missing?: string[];
}): Promise<PipelineStructureResult> {
  try {
    const ctx = await getSession();
    const client = await createClient();
    if (!client) return { ok: false, message: "연결된 워크스페이스가 필요합니다." };
    // The RPC rechecks current tenant, administrator role, permissions and row lineage.
    const result = await client.rpc("repair_new_lead_pipeline_structure", {
      p_org_id: ctx.org.id, p_item_id: input.itemId, p_apply: input.apply === true,
      p_expected_pipeline_id: input.pipelineId ?? null,
      p_expected_missing: input.missing ?? null,
    });
    if (result.error) {
      const message = result.error.code === "42501" ? "단계 구성은 워크스페이스 관리자만 복구할 수 있습니다."
        : result.error.code === "40001" ? "단계 구성이 바뀌었습니다. 다시 확인해 주세요."
        : result.error.code === "22023" ? "현재 행 또는 단계 구성이 중복되거나 달라 복구할 수 없습니다."
        : "단계 구성 결과를 확인하지 못했습니다. 다시 조회해 주세요.";
      return { ok: false, message };
    }
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!row || typeof row.pipeline_id !== "string" || typeof row.pipeline_name !== "string"
      || !Array.isArray(row.missing_kinds) || !row.missing_kinds.every((v: unknown) => v === "meeting" || v === "work")) {
      return { ok: false, message: "단계 구성 결과를 확인하지 못했습니다. 다시 조회해 주세요." };
    }
    return {
      ok: true, pipelineId: row.pipeline_id, pipelineName: row.pipeline_name, missing: row.missing_kinds,
      message: input.apply ? "단계 구성을 확인했습니다. 비대면 상담으로 넘기기를 다시 실행해 주세요."
        : row.missing_kinds.length ? "추가할 단계를 확인해 주세요." : "누락된 상담·실무 단계가 없습니다. 이동 조건을 다시 확인해 주세요.",
    };
  } catch {
    return { ok: false, message: "단계 구성 결과를 확인하지 못했습니다. 다시 조회해 주세요." };
  }
}
