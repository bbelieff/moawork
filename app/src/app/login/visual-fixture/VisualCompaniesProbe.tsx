import { CompaniesWorkspace } from "@/components/companies/CompaniesWorkspace";
import type { CompaniesViewModel } from "@/lib/companies/server";

// Synthetic display-only data. Mutations retain the real server authorization.
export function VisualCompaniesProbe() {
  const model: CompaniesViewModel = {
    status: "ready",
    dealsStatus: "ready",
    companies: ["가상 회사 A", "가상 회사 B"].map((name, index) => {
      const companyId = `visual-company-${index}`;
      return {
        company: {
          id: companyId, org_id: "visual-org", name, biz_type: null, region: "서울",
          owner_name: "가상 대표", phone: null, email: null, revenue: null,
          founded_on: null, homepage: null, assigned_to: null, created_at: "2026-09-01",
        },
        deals: [{
          deal: {
            id: `visual-deal-${index}`, org_id: "visual-org", company_id: companyId,
            title: index === 0 ? "운전자금" : "시설자금", pipeline_id: null,
            stage_id: null, assigned_to: null, amount: null, custom: {},
            status_note: null, fee_terms: null, applied_on: "2026-09-01",
            created_at: "2026-09-01", updated_at: "2026-09-01",
          },
          ledger: { status: "ready", total: 0, received: 0, outstanding: 0, fee: 0 },
          money: { contractDeposit: null, contractDepositPaidOn: null, fee: null,
            feeBilledOn: null, feePaidOn: null, ledgerTotal: 0, outstanding: 0 },
          ownerName: null, statusLabel: "준비 중",
          boardFacts: { institution: "가상 기관", approvedOn: null },
        }],
      };
    }),
  };
  return <main className="min-h-screen min-w-0 bg-mw-bg p-4" data-visual-companies>
    <CompaniesWorkspace model={model} members={[{ id: "visual-user", label: "가상 담당자" }]} />
  </main>;
}
