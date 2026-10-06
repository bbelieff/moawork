// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/w/sample-lab/boards/b-1" }));

import { ContractWorkIntakeForm, JUST_ADDED_HIGHLIGHT_MS } from "./ContractWorkIntakeForm";
import type { CompanyPickerRow } from "@/lib/companies/search";
import type { CompanyIntakeActionState } from "@/app/(app)/boards/[id]/company-intake-actions";

/**
 * #7 — 「＋ 업체 추가」 성공 뒤 패널이 열린 채 남던 결함, #6 — 그 열린 목록에서 같은 회사를
 * 다시 눌러 같은 회사 줄이 하나 더 생기던 경로. 둘 다 «실제로 액션이 받은 것» 과 화면으로 잰다.
 */
let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  vi.useRealTimers();
  document.body.replaceChildren();
});

function row(id: string, name: string, liveItemCount = 0): CompanyPickerRow {
  return {
    company: { id, org_id: "org-1", name } as unknown as CompanyPickerRow["company"],
    dealCount: liveItemCount,
    liveItemCount,
  };
}

type Seen = { companyId: string; requestId: string };

function mount(results: (seen: Seen[]) => CompanyIntakeActionState) {
  const seen: Seen[] = [];
  const action = vi.fn(async (_prev: CompanyIntakeActionState, form: FormData) => {
    seen.push({ companyId: String(form.get("companyId") ?? ""), requestId: String(form.get("requestId") ?? "") });
    return results(seen);
  });
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  return { seen, action, host };
}

async function render(host: HTMLElement, rows: readonly CompanyPickerRow[], action: never, newAction?: never) {
  await act(async () => {
    root!.render(
      <ContractWorkIntakeForm
        rows={rows}
        boardId="b-1"
        groupId="g-2"
        startWorkAction={action}
        startNewCompanyWorkAction={newAction}
        truncated={false}
      />,
    );
  });
}

const trigger = (host: HTMLElement) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("업체 추가"));
const button = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
const search = (host: HTMLElement) => host.querySelector<HTMLInputElement>('input[aria-label="업체 검색"]');
const liveRegion = (host: HTMLElement) => host.querySelector('[aria-live="polite"]');

async function open(host: HTMLElement) {
  await act(async () => trigger(host)?.click());
}

function submitFor(host: HTMLElement, companyId: string) {
  const field = host.querySelector(`input[name="companyId"][value="${companyId}"]`);
  return field?.closest("form") as HTMLFormElement | undefined;
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** 보드의 한 줄 — GroupTable 이 그리는 것처럼 상세 트리거가 그 줄의 <tr> 안에 있다. */
function boardRow(itemId: string, wrap?: (table: HTMLElement) => HTMLElement): HTMLTableRowElement {
  const table = document.createElement("table");
  table.innerHTML = `<tbody><tr><td><button type="button" data-item-detail-trigger="${itemId}">열기</button></td></tr></tbody>`;
  document.body.append(wrap ? wrap(table) : table);
  return table.querySelector("tr")!;
}

const ROWS = [row("c-1", "가나상사"), row("c-2", "다라물산")];

describe("#7 확정 성공이면 닫는다", () => {
  it("패널을 닫고 트리거로 돌아가며 「○○ 추가했어요」 를 알린다", async () => {
    const { action, host } = mount(() => ({ ok: true, message: "업무를 시작했어요.", itemId: "item-9" }));
    await render(host, ROWS, action as never);
    await open(host);
    await act(async () => type(search(host)!, "가나"));
    await act(async () => submitFor(host, "c-1")?.requestSubmit());

    expect(action).toHaveBeenCalledTimes(1);
    expect(search(host)).toBeNull();
    expect(submitFor(host, "c-1")).toBeUndefined();
    expect(trigger(host)).toBeTruthy();
    expect(liveRegion(host)?.textContent).toBe("가나상사 추가했어요");
    // 패널이 사라지며 잃은 포커스는 트리거로 돌아온다.
    expect(document.activeElement).toBe(trigger(host));
  });

  it("다시 열면 지난 성공 문구도, 지난 검색어도 없다", async () => {
    const { action, host } = mount(() => ({ ok: true, message: "업무를 시작했어요.", itemId: "item-9" }));
    await render(host, ROWS, action as never);
    await open(host);
    await act(async () => type(search(host)!, "가나"));
    await act(async () => submitFor(host, "c-1")?.requestSubmit());
    await open(host);

    expect(host.textContent).not.toContain("업무를 시작했어요.");
    expect(search(host)?.value).toBe("");
    // 검색어가 비었으니 두 회사가 다 보인다.
    expect(submitFor(host, "c-2")).toBeTruthy();
    expect(liveRegion(host)?.textContent).toBe("");
    const selected = host.querySelector('[role="tab"][aria-selected="true"]');
    expect(selected?.textContent).toBe("기존 회사");
  });

  it("성공 «뒤에» 온 불확실 결과는 닫았다 다시 열어도 남는다 — 지난 성공까지만 가린다", async () => {
    const { action, host } = mount(() => ({ ok: true, message: "업무를 시작했어요.", itemId: "item-9" }));
    const newAction = vi.fn(async (): Promise<CompanyIntakeActionState> => {
      throw new Error("response lost");
    });
    await render(host, ROWS, action as never, newAction as never);
    await open(host);
    await act(async () => submitFor(host, "c-1")?.requestSubmit());
    await open(host);
    const newTab = () => [...host.querySelectorAll('[role="tab"]')].find((b) => b.textContent === "새 회사") as HTMLElement;
    await act(async () => newTab().click());
    await act(async () => type(host.querySelector<HTMLInputElement>('input[name="companyName"]')!, "새회사"));
    await act(async () => (host.querySelector('input[name="companyName"]')!.closest("form") as HTMLFormElement).requestSubmit());
    expect(host.textContent).toContain("저장 결과를 확인하지 못했어요. 입력을 유지했어요.");

    await act(async () => button(host, "닫기")?.click());
    expect(document.activeElement).toBe(trigger(host));
    await open(host);
    await act(async () => newTab().click());
    expect(host.textContent).toContain("저장 결과를 확인하지 못했어요. 입력을 유지했어요.");
    expect(host.textContent).not.toContain("업무를 시작했어요.");
  });

  it("결과를 모르는(uncertain)·거절된(rejected) 결과는 열어 둔다 — 재시도 규칙 그대로", async () => {
    const { action, seen, host } = mount((calls) => calls.length === 1
      ? { ok: false, outcome: "uncertain", message: "저장 결과를 확인하지 못했어요." }
      : { ok: false, outcome: "rejected", message: "권한을 확인해 주세요." });
    await render(host, ROWS, action as never);
    await open(host);
    await act(async () => submitFor(host, "c-1")?.requestSubmit());
    expect(search(host)).not.toBeNull();
    expect(host.textContent).toContain("저장 결과를 확인하지 못했어요.");
    await act(async () => submitFor(host, "c-1")?.requestSubmit());
    expect(seen[1].requestId).toBe(seen[0].requestId);
    expect(search(host)).not.toBeNull();
    expect(host.textContent).toContain("권한을 확인해 주세요.");
  });

  it("새 줄로 스크롤하고 data-just-added 를 잠깐 달았다가 지운다", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const tr = boardRow("item-9");
    const scrollIntoView = vi.fn();
    tr.scrollIntoView = scrollIntoView;
    const { action, host } = mount(() => ({ ok: true, message: "업무를 시작했어요.", itemId: "item-9" }));
    await render(host, ROWS, action as never);
    await open(host);
    await act(async () => submitFor(host, "c-1")?.requestSubmit());

    expect(tr.getAttribute("data-just-added")).toBe("true");
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "center" }));
    await act(async () => { vi.advanceTimersByTime(JUST_ADDED_HIGHLIGHT_MS); });
    expect(tr.hasAttribute("data-just-added")).toBe(false);
  });

  it("줄이 늦게 그려져도 잠깐 기다렸다가 찾는다", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { action, host } = mount(() => ({ ok: true, message: "업무를 시작했어요.", itemId: "item-late" }));
    await render(host, ROWS, action as never);
    await open(host);
    await act(async () => submitFor(host, "c-1")?.requestSubmit());
    const tr = boardRow("item-late");
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(tr.getAttribute("data-just-added")).toBe("true");
  });

  it("필터로 안 그려졌거나 접힌 그룹 안이면 조용히 그만둔다 — 안내는 남는다", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const folded = boardRow("item-folded", (table) => {
      const details = document.createElement("details");
      details.append(table);
      return details;
    });
    const scrollIntoView = vi.fn();
    folded.scrollIntoView = scrollIntoView;
    const { action, host } = mount((calls) => ({
      ok: true,
      message: "업무를 시작했어요.",
      itemId: calls.length === 1 ? "item-filtered-out" : "item-folded",
    }));
    await render(host, ROWS, action as never);
    await open(host);
    await act(async () => submitFor(host, "c-1")?.requestSubmit());
    await act(async () => { vi.advanceTimersByTime(5_000); });
    expect(document.querySelector("[data-just-added]")).toBeNull();
    expect(trigger(host)).toBeTruthy();

    await open(host);
    await act(async () => submitFor(host, "c-2")?.requestSubmit());
    expect(folded.hasAttribute("data-just-added")).toBe(false);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(liveRegion(host)?.textContent).toBe("다라물산 추가했어요");
  });
});

describe("#6 이미 이 탭에 줄이 있는 회사 — 한 번 묻는다 (막지는 않는다)", () => {
  const LIVE_ROWS = [row("c-1", "가나상사", 2), row("c-2", "다라물산", 0)];

  it("확인 전에는 보내지 않고, 「하나 더 시작」 을 눌러야 보낸다", async () => {
    const { action, seen, host } = mount(() => ({ ok: true, message: "업무를 시작했어요.", itemId: "item-9" }));
    await render(host, LIVE_ROWS, action as never);
    await open(host);

    await act(async () => submitFor(host, "c-1")?.requestSubmit());
    expect(action).not.toHaveBeenCalled();
    expect(host.textContent).toContain("이 업체는 이미 이 탭에 2건 있어요 · 하나 더 시작할까요?");

    // 같은 회사를 또 눌러도(연타) 확인 없이는 안 나간다.
    await act(async () => submitFor(host, "c-1")?.requestSubmit());
    expect(action).not.toHaveBeenCalled();

    await act(async () => button(host, "취소")?.click());
    expect(host.textContent).not.toContain("하나 더 시작할까요?");
    expect(action).not.toHaveBeenCalled();

    await act(async () => submitFor(host, "c-1")?.requestSubmit());
    await act(async () => button(host, "하나 더 시작")?.click());
    expect(seen.map((s) => s.companyId)).toEqual(["c-1"]);
    expect(seen[0].requestId).not.toBe("");
  });

  it("이 탭에 줄이 없는 회사는 묻지 않는다 — 1:N 흐름에 마찰을 더하지 않는다", async () => {
    const { action, seen, host } = mount(() => ({ ok: true, message: "", itemId: "item-9" }));
    await render(host, LIVE_ROWS, action as never);
    await open(host);
    await act(async () => submitFor(host, "c-2")?.requestSubmit());
    expect(seen.map((s) => s.companyId)).toEqual(["c-2"]);
    expect(host.textContent).not.toContain("하나 더 시작할까요?");
  });

  it("확인은 그 제출 한 번에만 쓴다 — 성공 뒤 다시 열어 같은 회사를 누르면 또 묻는다", async () => {
    const { action, host } = mount(() => ({ ok: true, message: "업무를 시작했어요.", itemId: "item-9" }));
    await render(host, LIVE_ROWS, action as never);
    await open(host);
    await act(async () => submitFor(host, "c-1")?.requestSubmit());
    await act(async () => button(host, "하나 더 시작")?.click());
    expect(action).toHaveBeenCalledTimes(1);

    await open(host);
    await act(async () => submitFor(host, "c-1")?.requestSubmit());
    expect(action).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("하나 더 시작할까요?");
  });

  it("확인한 요청의 결과를 모르면 재시도는 다시 묻지 않고 같은 열쇠로 간다", async () => {
    const { action, seen, host } = mount((calls) => calls.length === 1
      ? { ok: false, outcome: "uncertain", message: "저장 결과를 확인하지 못했어요." }
      : { ok: true, message: "업무를 시작했어요.", itemId: "item-9" });
    await render(host, LIVE_ROWS, action as never);
    await open(host);
    await act(async () => submitFor(host, "c-1")?.requestSubmit());
    await act(async () => button(host, "하나 더 시작")?.click());
    await act(async () => submitFor(host, "c-1")?.requestSubmit());

    expect(action).toHaveBeenCalledTimes(2);
    expect(seen[1].requestId).toBe(seen[0].requestId);
  });

  it("「하나 더 시작」 연타는 한 건이다", async () => {
    const { action, host } = mount(() => ({ ok: true, message: "", itemId: "item-9" }));
    await render(host, LIVE_ROWS, action as never);
    await open(host);
    await act(async () => submitFor(host, "c-1")?.requestSubmit());
    await act(async () => {
      const confirm = button(host, "하나 더 시작");
      confirm?.click();
      confirm?.click();
    });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("같은 이름 후보 「이 회사로 진행」 도 같은 규칙으로 묻는다", async () => {
    const { action, seen, host } = mount(() => ({ ok: true, message: "업무를 시작했어요.", itemId: "item-9" }));
    const newAction = vi.fn(async (): Promise<CompanyIntakeActionState> => ({
      ok: false,
      outcome: "rejected",
      message: "같은 이름의 회사가 이미 있어요.",
      conflictCandidates: [{ id: "c-1", name: "가나상사", detail: "" }],
    }));
    await render(host, LIVE_ROWS, action as never, newAction as never);
    await open(host);
    const newTab = [...host.querySelectorAll('[role="tab"]')].find((b) => b.textContent === "새 회사") as HTMLElement;
    await act(async () => newTab.click());
    await act(async () => type(host.querySelector<HTMLInputElement>('input[name="companyName"]')!, "가나상사"));
    await act(async () => (host.querySelector('input[name="companyName"]')!.closest("form") as HTMLFormElement).requestSubmit());

    await act(async () => button(host, "이 회사로 진행")?.click());
    expect(action).not.toHaveBeenCalled();
    expect(host.textContent).toContain("이 업체는 이미 이 탭에 2건 있어요 · 하나 더 시작할까요?");

    await act(async () => button(host, "하나 더 시작")?.click());
    expect(seen.map((s) => s.companyId)).toEqual(["c-1"]);
    // 후보로 시작해도 확정 성공이면 닫고, 다시 열면 지난 후보 목록이 남아 있지 않다.
    expect(trigger(host)).toBeTruthy();
    await open(host);
    await act(async () => ([...host.querySelectorAll('[role="tab"]')].find((b) => b.textContent === "새 회사") as HTMLElement).click());
    expect(button(host, "이 회사로 진행")).toBeUndefined();
    expect(host.textContent).not.toContain("같은 이름의 회사가 이미 있어요.");
    expect(host.querySelector<HTMLInputElement>('input[name="companyName"]')?.value).toBe("");
  });
});
