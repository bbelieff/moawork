"use client";

import { useActionState, useEffect, useState } from "react";
import { CompanyPickerPanel } from "@/components/company/CompanyPickerPanel";
import type { CompanyCandidate } from "@/lib/company/types";
import {
  mutateContactPipeline,
  type ContactPipelineActionState,
} from "@/lib/crm/contactPipelineActions";
import {
  CONTACT_MOVE_LABEL,
  type ContactTransitionKind,
} from "@/lib/crm/contactPipeline";

const INITIAL: ContactPipelineActionState = { ok: false, message: "" };

export function companyRowsFromResponse(payload: unknown): Array<Record<string, unknown>> {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown }).data;
  return Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
}

export function ContactPipelineAction({
  dealId,
  kind,
  requestId,
}: Readonly<{
  dealId: string;
  kind: ContactTransitionKind;
  requestId: string;
}>) {
  const [state, action, pending] = useActionState(mutateContactPipeline, INITIAL);
  const [companies, setCompanies] = useState<CompanyCandidate[]>([]);
  const [query, setQuery] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const label = kind === "lead_to_contact" ? CONTACT_MOVE_LABEL : "업체 연결";

  useEffect(() => {
    if (kind !== "contact_to_work") return;
    let active = true;
    void fetch("/api/companies", { cache: "no-store" })
      .then(async (response) => response.ok ? companyRowsFromResponse(await response.json()) : [])
      .then((rows) => {
        if (!active) return;
        setCompanies(rows.map((row) => ({
          id: String(row.id),
          bizNo: typeof row.biz_no === "string" ? row.biz_no : null,
          name: String(row.name ?? ""),
          ceoName: typeof row.owner_name === "string" ? row.owner_name : null,
          bizType: typeof row.business_type === "string" ? row.business_type : typeof row.biz_type === "string" ? row.biz_type : null,
          industry: typeof row.industry === "string" ? row.industry : typeof row.biz_type === "string" ? row.biz_type : null,
          regionSido: typeof row.region_sido === "string" ? row.region_sido : null,
          regionSigungu: typeof row.region_sigungu === "string" ? row.region_sigungu : null,
          phone: typeof row.phone === "string" ? row.phone : null,
          foundedOn: typeof row.founded_on === "string" ? row.founded_on : null,
          revenue: row.revenue === null || row.revenue === undefined ? null : String(row.revenue),
          dealCount: 0,
          lastActivity: null,
        })));
      })
      .catch(() => { if (active) setCompanies([]); });
    return () => { active = false; };
  }, [kind]);

  return (
    <form action={action} className="mt-3 border-t border-neutral-100 pt-3" aria-busy={pending}>
      <input type="hidden" name="dealId" value={dealId} />
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="operation" value="move" />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="selectedCompanyId" value={selectedCompanyId} />
      <input type="hidden" name="companyName" value={query} />
      {kind === "contact_to_work" ? (
        <CompanyPickerPanel
          companies={companies}
          query={query}
          onQueryChange={(value) => { setQuery(value); setSelectedCompanyId(""); }}
          onPick={(company) => { setQuery(company.name); setSelectedCompanyId(company.id); }}
          onCreateNew={(name) => { setQuery(name); setSelectedCompanyId(""); }}
        />
      ) : null}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending || (kind === "contact_to_work" && !selectedCompanyId && !query.trim())}
          className="min-h-11 rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? "이동 중…" : label}
        </button>
      </div>
      {state.message ? (
        <p role="status" className={`mt-2 text-xs ${state.ok ? "text-emerald-700" : "text-red-700"}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
