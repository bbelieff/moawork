// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/w/sample-lab/boards/b-1" }));

import { ContractWorkIntakeForm } from "./ContractWorkIntakeForm";
import type { CompanyPickerRow } from "@/lib/companies/search";
import type { CompanyIntakeActionState } from "@/app/(app)/boards/[id]/company-intake-actions";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

function row(id: string, name: string): CompanyPickerRow {
  return {
    company: { id, org_id: "org-1", name } as unknown as CompanyPickerRow["company"],
    dealCount: 0,
  };
}

const ROWS = [row("c-1", "가나상사")];

function mountNewAction(behavior: (form: FormData) => CompanyIntakeActionState) {
  const seen: Record<string, string>[] = [];
  const newAction = vi.fn(async (_prev: CompanyIntakeActionState, form: FormData) => {
    const entry: Record<string, string> = {};
    for (const [key, value] of form.entries()) entry[key] = String(value);
    seen.push(entry);
    return behavior(form);
  });
  const existingAction = vi.fn(async () => ({ ok: true, message: "" }) as CompanyIntakeActionState);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  return { seen, newAction, existingAction, host };
}

async function renderForm(host: HTMLElement, actions: { newAction: never; existingAction: never }) {
  await act(async () => {
    root!.render(
      <ContractWorkIntakeForm
        rows={ROWS}
        boardId="b-1"
        groupId="g-2"
        startWorkAction={actions.existingAction as never}
        startNewCompanyWorkAction={actions.newAction as never}
        truncated={false}
      />,
    );
  });
  const trigger = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("업체 추가"));
  await act(async () => trigger?.click());
  const tab = [...host.querySelectorAll('[role="tab"]')].find((b) => b.textContent?.includes("새 회사"));
  await act(async () => (tab as HTMLElement)?.click());
}

function setInput(host: HTMLElement, name: string, value: string) {
  const input = host.querySelector(`[name="${name}"]`) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function newCompanyForm(host: HTMLElement): HTMLFormElement {
  const input = host.querySelector('input[name="companyName"]') as HTMLInputElement;
  return input.closest("form") as HTMLFormElement;
}

describe("업체 추가 — 새 회사 탭", () => {
  it("같은 흐름 안에 기존/새 회사 탭이 있고 새 회사에 정본 입력칸이 있다", async () => {
    const { newAction, existingAction, host } = mountNewAction(() => ({ ok: true, message: "ok" }));
    await renderForm(host, { newAction: newAction as never, existingAction: existingAction as never });

    expect(host.querySelector('input[name="companyName"]')).not.toBeNull();
    // 사업자유형 — 신규리드 정본 3종(business-types). 정책자금 6종이 아니다.
    const businessType = host.querySelector('select[name="businessType"]') as HTMLSelectElement;
    expect([...businessType.options].map((o) => o.value)).toEqual(["", "개인사업자", "법인사업자", "그외"]);
    // 창업은 승인된 창업연월(month). date(창업년도)가 아니다.
    const foundedMonth = host.querySelector('input[name="foundedMonth"]') as HTMLInputElement;
    expect(foundedMonth).not.toBeNull();
    expect(foundedMonth.type).toBe("month");
    // 지역은 시도+시군구 정본 검색. 단일 자유입력이 아니다.
    expect(host.querySelector('input[name="regionSido"]')).not.toBeNull();
    expect(host.querySelector('input[name="regionSigungu"]')).not.toBeNull();
    expect(host.querySelector('input[name="region"]')).toBeNull();
    expect(host.querySelector('input[name="phone"]')).not.toBeNull();
    // 기존 회사 검색칸은 새 탭에서 안 보인다.
    expect(host.querySelector('input[aria-label="업체 검색"]')).toBeNull();
  });

  it("제출하면 회사 이름과 찍힌 열쇠·누른 그룹이 실려 간다", async () => {
    const { seen, newAction, existingAction, host } = mountNewAction(() => ({ ok: true, message: "ok" }));
    await renderForm(host, { newAction: newAction as never, existingAction: existingAction as never });
    await act(async () => setInput(host, "companyName", "새회사"));
    await act(async () => setInput(host, "regionSido", "서울"));
    await act(async () => newCompanyForm(host)?.requestSubmit());

    expect(seen).toHaveLength(1);
    expect(seen[0].companyName).toBe("새회사");
    expect(seen[0].workRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(seen[0].regionSido).toBe("서울");
    expect(seen[0].boardId).toBe("b-1");
    expect(seen[0].groupId).toBe("g-2");
  });

  it("시작만 실패하면 입력값이 남고 다시 시작이 같은 열쇠를 쓴다", async () => {
    const { newAction, existingAction, host } = mountNewAction(() => ({
      ok: false,
      message: "회사는 등록됐어요.",
      retryCompanyId: "company-new",
      retryRequestId: "work-req-keep",
      createdCompanyId: "company-new",
    }));
    await renderForm(host, { newAction: newAction as never, existingAction: existingAction as never });
    await act(async () => setInput(host, "companyName", "유지회사"));
    await act(async () => setInput(host, "regionSido", "서울"));
    await act(async () => setInput(host, "foundedMonth", "2024-03"));
    await act(async () => newCompanyForm(host)?.requestSubmit());

    // 입력값이 그대로 남는다 — 회사명·지역·창업연월 모두.
    expect((host.querySelector('input[name="companyName"]') as HTMLInputElement).value).toBe("유지회사");
    expect((host.querySelector('input[name="regionSido"]') as HTMLInputElement).value).toBe("서울");
    expect((host.querySelector('input[name="foundedMonth"]') as HTMLInputElement).value).toBe("2024-03");
    // 다시 시작 폼이 같은 회사 id 와 같은 열쇠를 들고 있다.
    const retry = host.querySelector('form[aria-label="등록된 회사로 다시 시작"]') as HTMLFormElement;
    expect(retry).not.toBeNull();
    expect((retry.querySelector('input[name="companyId"]') as HTMLInputElement).value).toBe("company-new");
    expect((retry.querySelector('input[name="requestId"]') as HTMLInputElement).value).toBe("work-req-keep");
  });

  it("새 회사 액션이 없으면 제출이 막히고 기존 회사 경로는 그대로다", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const existingAction = vi.fn(async () => ({ ok: true, message: "" }) as CompanyIntakeActionState);
    await act(async () => {
      root!.render(
        <ContractWorkIntakeForm rows={ROWS} boardId="b-1" groupId="g-2" startWorkAction={existingAction} truncated={false} />,
      );
    });
    const trigger = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("업체 추가"));
    await act(async () => trigger?.click());
    const tab = [...host.querySelectorAll('[role="tab"]')].find((b) => b.textContent?.includes("새 회사"));
    await act(async () => (tab as HTMLElement)?.click());
    const submit = [...host.querySelectorAll('button[type="submit"]')].find((b) =>
      b.textContent?.includes("새 회사 등록하고 업무 시작"),
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });
  it("React reset and tab remount retain the request after a lost response", async () => {
    let attempts = 0;
    const { seen, newAction, existingAction, host } = mountNewAction(() => {
      if (++attempts === 1) throw new Error("response lost");
      return { ok: true, message: "confirmed replay" };
    });
    await renderForm(host, { newAction: newAction as never, existingAction: existingAction as never });
    await act(async () => setInput(host, "companyName", "Replay company"));
    await act(async () => newCompanyForm(host).requestSubmit());
    expect(host.textContent).toContain("저장 결과를 확인하지 못했어요");
    // React 19 resets uncontrolled fields even when the action returns ok:false.
    expect((host.querySelector('[name="workRequestId"]') as HTMLInputElement).value).toBe("");
    const tabs = [...host.querySelectorAll('[role="tab"]')] as HTMLElement[];
    await act(async () => tabs[0].click());
    await act(async () => (host.querySelector('input[name="companyId"]')!.closest("form") as HTMLFormElement).requestSubmit());
    expect(existingAction).not.toHaveBeenCalled();
    expect(host.textContent).toContain("새 회사의 저장 결과를 먼저 확인");
    await act(async () => tabs[1].click());
    await act(async () => setInput(host, "companyName", "Changed while unknown"));
    await act(async () => newCompanyForm(host).requestSubmit());
    expect(seen).toHaveLength(1);
    await act(async () => setInput(host, "companyName", "Replay company"));
    await act(async () => newCompanyForm(host).requestSubmit());
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual(seen[0]);
    expect(seen[0].workRequestId).not.toBe("");
    // A repeated confirmed submit is still the same logical request.
    await act(async () => newCompanyForm(host).requestSubmit());
    expect(seen[2].workRequestId).toBe(seen[0].workRequestId);
    // Only a confirmed request with deliberately changed content starts a new one.
    await act(async () => setInput(host, "companyName", "Another company"));
    await act(async () => newCompanyForm(host).requestSubmit());
    expect(seen[3].workRequestId).not.toBe(seen[0].workRequestId);
  });

  it("resolved failure keeps the request through automatic form reset", async () => {
    const { seen, newAction, existingAction, host } = mountNewAction(() => ({ ok: false, message: "unknown" }));
    await renderForm(host, { newAction: newAction as never, existingAction: existingAction as never });
    await act(async () => setInput(host, "companyName", "Same company"));
    await act(async () => newCompanyForm(host).requestSubmit());
    await act(async () => newCompanyForm(host).requestSubmit());
    expect(seen[1]).toEqual(seen[0]);
  });

  it("correcting rejected input then replaying success does not rotate the key", async () => {
    let attempts = 0;
    const { seen, newAction, existingAction, host } = mountNewAction(() => ({ ok: ++attempts > 1, outcome: "rejected", message: "result" }));
    await renderForm(host, { newAction: newAction as never, existingAction: existingAction as never });
    await act(async () => setInput(host, "companyName", "Rejected name"));
    await act(async () => newCompanyForm(host).requestSubmit());
    await act(async () => setInput(host, "companyName", "Corrected name"));
    await act(async () => newCompanyForm(host).requestSubmit());
    await act(async () => newCompanyForm(host).requestSubmit());
    expect(seen[1].workRequestId).toBe(seen[0].workRequestId);
    expect(seen[2]).toEqual(seen[1]);
  });

});


it("duplicate candidate retry retains its ID after response loss and exposes the result", async () => {
  const { newAction, host } = mountNewAction(() => ({ ok: false, message: "후보 선택", conflictCandidates: [{ id: "c-1", name: "가나상사", detail: "" }] }));
  const requests: string[] = [];
  const existingAction = vi.fn(async (_previous: CompanyIntakeActionState, form: FormData): Promise<CompanyIntakeActionState> => {
    requests.push(String(form.get("requestId")));
    return requests.length === 1 ? { ok: false, outcome: "uncertain", message: "저장 결과 재확인" } : { ok: true, message: "확인 완료" };
  });
  await renderForm(host, { newAction: newAction as never, existingAction: existingAction as never });
  await act(async () => setInput(host, "companyName", "가나상사"));
  await act(async () => newCompanyForm(host).requestSubmit());
  const choose = () => [...host.querySelectorAll("button")].find(b => b.textContent === "이 회사로 진행")!;
  await act(async () => choose().click());
  expect(host.textContent).toContain("저장 결과 재확인");
  await act(async () => choose().click());
  expect(requests).toHaveLength(2);
  expect(requests[1]).toBe(requests[0]);
});
