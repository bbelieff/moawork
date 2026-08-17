"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { LockBlockedDialog } from "@/components/automation-presets/lock";
import { requestSealApprovalAction, type SealApprovalRequestResult } from "@/lib/automation/lock/actions";
import { CompanyPickerPanel } from "@/components/company/CompanyPickerPanel";
import type { CompanyCandidate } from "@/lib/company/types";
import {
  mutateContactPipeline,
  type ContactPipelineActionState,
} from "@/lib/crm/contactPipelineActions";
import {
  CONTACT_MOVE_LABEL,
  WORK_MOVE_LABEL,
  type ContactTransitionKind,
} from "@/lib/crm/contactPipeline";

const INITIAL: ContactPipelineActionState = { ok: false, message: "" };

export function availableLockActions(key: string, dealId: string | null) {
  return {
    canNavigate: key !== "seal_approval" || dealId !== null,
    canRequestApproval: key === "seal_approval" && dealId !== null,
  };
}

export function companyRowsFromResponse(payload: unknown): Array<Record<string, unknown>> {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown }).data;
  return Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
}

export function ContactPipelineAction({
  dealId,
  kind,
  requestId,
  initialCompanyName = "",
  initialValues = {},
}: Readonly<{
  dealId: string | null;
  kind: ContactTransitionKind;
  requestId: string;
  initialCompanyName?: string;
  initialValues?: Readonly<Record<string, string>>;
}>) {
  const [state, action, pending] = useActionState(mutateContactPipeline, INITIAL);
  const [companies, setCompanies] = useState<CompanyCandidate[]>([]);
  const [query, setQuery] = useState(initialCompanyName);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null);
  const [approvalFeedback, setApprovalFeedback] = useState<SealApprovalRequestResult | null>(null);
  const [approvalPending, startApproval] = useTransition();
  const label = kind === "lead_to_contact" ? CONTACT_MOVE_LABEL : WORK_MOVE_LABEL;
  const blocked = !state.ok && state.unmet?.length && dismissedMessage !== state.message
    ? state.unmet
    : [];

  function goToCondition(key: string) {
    if (!availableLockActions(key, dealId).canNavigate) return;
    window.location.assign(key === "seal_approval" && dealId
      ? `/deals/${dealId}#deal-approval-actions`
      : "#contact-pipeline-action");
  }

  function requestApproval(key: string) {
    if (!dealId || !availableLockActions(key, dealId).canRequestApproval) return;
    setApprovalFeedback(null);
    startApproval(async () => setApprovalFeedback(await requestSealApprovalAction(dealId, requestId)));
  }

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
    <form id="contact-pipeline-action" action={action} className="mt-3 border-t border-neutral-100 pt-3" aria-busy={pending}>
      <input type="hidden" name="dealId" value={dealId ?? ""} />
      <input type="hidden" name="sourceItemId" value={dealId ? "" : requestId} />
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="operation" value="move" />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="selectedCompanyId" value={selectedCompanyId} />
      <input type="hidden" name="companyName" value={query} />
      {Object.entries(initialValues).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
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
          {pending ? (kind === "contact_to_work" ? "연결 중…" : "이동 중…") : label}
        </button>
      </div>
      {/* 판정 근거(state.ok)로 «시각과 role 을 함께» 분기한다 — 하나만 분기하면 거짓말이 된다.
          이동 실패를 role="status" 로 알리면 보조기술 사용자는 «옮겨졌다» 고 듣는다(BBE-193).
          같은 결론에 이미 도달한 곳: LockBlockedDialog:88 · AccountState:22. */}
      {state.message ? (
        <p
          role={state.ok ? "status" : "alert"}
          className={`mt-2 text-xs ${state.ok ? "text-[var(--mw-success)]" : "text-[var(--mw-error)]"}`}
        >
          {state.message}
        </p>
      ) : null}
      <LockBlockedDialog
        unmet={blocked}
        onNavigateToCondition={goToCondition}
        canNavigateToCondition={(key) => availableLockActions(key, dealId).canNavigate}
        onRequestApproval={blocked.some((condition) => availableLockActions(condition.key, dealId).canRequestApproval) ? requestApproval : undefined}
        approvalPending={approvalPending}
        approvalFeedback={approvalFeedback}
        onClose={() => setDismissedMessage(state.message)}
      />
    </form>
  );
}
