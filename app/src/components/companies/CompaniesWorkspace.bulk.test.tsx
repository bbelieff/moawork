// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { CompaniesWorkspace } from "./CompaniesWorkspace";
import type { CompaniesViewModel } from "@/lib/companies/server";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.replaceChildren();
});

const companyA = {
  id: "company-1", org_id: "org-1", name: "가나상사", biz_type: null, region: "서울",
  owner_name: "대표", phone: null, email: null, revenue: null, founded_on: null,
  homepage: null, assigned_to: null, created_at: "2026-01-01T00:00:00.000Z",
};
const companyB = {
  id: "company-2", org_id: "org-1", name: "다라상사", biz_type: null, region: "부산",
  owner_name: "대표2", phone: null, email: null, revenue: null, founded_on: null,
  homepage: null, assigned_to: null, created_at: "2026-01-01T00:00:00.000Z",
};
const dealA = {
  id: "deal-1", org_id: "org-1", company_id: "company-1", title: "운전자금",
  pipeline_id: null, stage_id: "stage-1", assigned_to: "user-1", amount: 10_000_000,
  custom: {}, status_note: null, fee_terms: null,
  applied_on: "2026-03-04", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
};
const dealB = {
  id: "deal-2", org_id: "org-1", company_id: "company-2", title: "시설자금",
  pipeline_id: null, stage_id: "stage-1", assigned_to: "user-1", amount: 20_000_000,
  custom: {}, status_note: null, fee_terms: null,
  applied_on: "2026-03-05", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
};

function model(): CompaniesViewModel {
  return {
    status: "ready",
    dealsStatus: "ready",
    companies: [
      {
        company: companyA,
        deals: [
          {
            deal: dealA,
            ledger: { status: "ready", total: 0, received: 0, outstanding: 0, fee: 0 },
            money: {
              contractDeposit: null, contractDepositPaidOn: null, fee: null,
              feeBilledOn: null, feePaidOn: null, ledgerTotal: 0, outstanding: 0,
            },
            ownerName: "담당A",
            statusLabel: "진행 중",
            boardFacts: { institution: null, approvedOn: null },
          },
        ],
      },
      {
        company: companyB,
        deals: [
          {
            deal: dealB,
            ledger: { status: "ready", total: 0, received: 0, outstanding: 0, fee: 0 },
            money: {
              contractDeposit: null, contractDepositPaidOn: null, fee: null,
              feeBilledOn: null, feePaidOn: null, ledgerTotal: 0, outstanding: 0,
            },
            ownerName: "담당B",
            statusLabel: "진행 중",
            boardFacts: { institution: null, approvedOn: null },
          },
        ],
      },
    ],
  } as CompaniesViewModel;
}

describe("CompaniesWorkspace 일괄 선택 체크박스", () => {
  it("모든 업체·펼쳐진 딜 행 첫 열에 체크박스를 그린다", () => {
    const html = renderToStaticMarkup(<CompaniesWorkspace model={model()} />);
    expect(html).toContain('aria-label="업체·자금 건 전체 선택"');
    expect(html).toContain('aria-label="가나상사 선택"');
    expect(html).toContain('aria-label="다라상사 선택"');
    // 접혀 있어도 딜 행은 문서에 남고 체크박스를 갖는다.
    expect(html).toContain('aria-label="운전자금 선택"');
    expect(html).toContain('aria-label="시설자금 선택"');
  });

  it("company:/deal: 구분 — 업체 선택이 하위 딜을 암묵 선택하지 않음(순수 계약은 bulk.test가 잰다)", () => {
    const html = renderToStaticMarkup(<CompaniesWorkspace model={model()} />);
    // 회사와 딜이 같은 id를 공유해도 bulk id는 접두로 갈린다 — 화면에 같은 이름이 두 번 나와도 체크박스 라벨이 다르다.
    expect(html.indexOf('aria-label="가나상사 선택"')).toBeGreaterThan(-1);
    expect(html.indexOf('aria-label="운전자금 선택"')).toBeGreaterThan(-1);
  });

  it("선택 전에는 일괄 바를 그리지 않는다 — 집계 직접수정 버튼을 노출하지 않음", () => {
    const html = renderToStaticMarkup(<CompaniesWorkspace model={model()} />);
    expect(html).not.toContain("선택 작업");
    expect(html).not.toContain("회사 필드");
    expect(html).not.toContain("담당 변경");
  });
});

describe("CompaniesWorkspace 일괄 선택 상호작용", () => {
  it("업체 1개를 고르면 대상 종류와 수를 분명히 보인다", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<CompaniesWorkspace model={model()} />);
    });
    const companyBox = host.querySelector<HTMLInputElement>('input[aria-label="가나상사 선택"]')!;
    await act(async () => {
      companyBox.click();
    });
    const bar = host.querySelector('[aria-label="선택 작업"]')!;
    expect(bar.textContent).toContain("회사 1개");
    expect(bar.textContent).toContain("보기 내 1개 대상");
    expect(bar.textContent).toContain("회사 필드");
    // 딜이 선택되지 않았으므로 자금 필드·담당 변경은 나오지 않는다.
    expect(bar.textContent).not.toContain("자금 필드");
    expect(bar.textContent).not.toContain("담당 변경");
    await act(async () => root.unmount());
  });

  it("마스터는 보이는 행만 건드리고 선택 해제로 비운다", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<CompaniesWorkspace model={model()} />);
    });
    const master = host.querySelector<HTMLInputElement>('input[aria-label="업체·자금 건 전체 선택"]')!;
    await act(async () => {
      master.click();
    });
    // 접힌 상태에서는 회사 2개만 대상이다 — 하위 딜은 제외된다.
    const bar = host.querySelector('[aria-label="선택 작업"]')!;
    expect(bar.textContent).toContain("회사 2개");
    expect(bar.textContent).not.toContain("자금 건");

    const clear = [...host.querySelectorAll("button")].find((button) => button.textContent === "선택 해제")!;
    await act(async () => {
      clear.click();
    });
    expect(host.querySelector('[aria-label="선택 작업"]')).toBeNull();
    await act(async () => root.unmount());
  });
});
