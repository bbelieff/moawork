// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  applyProductAction: vi.fn(),
  addChecklistItemAction: vi.fn(),
  removeChecklistItemAction: vi.fn(),
  saveChecklistAsPresetAction: vi.fn(),
  toggleChecklistItemAction: vi.fn(),
}));
vi.mock("@/lib/policyfund/checklist/actions", () => actions);

import { ChecklistPanel } from "./ChecklistPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const category = { key: "product", label: "진행 상품", options: [{ label: "운전자금" }, { label: "시설자금" }] } as never;

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  actions.applyProductAction.mockReset().mockResolvedValue({ dealId: "d1", productId: "시설자금", items: [] });
});
afterEach(() => host.remove());

async function render(items: { id: string; label: string; checked: boolean }[]) {
  const root = createRoot(host);
  await act(async () => {
    root.render(<ChecklistPanel dealId="d1" productCategory={category} initialState={{ dealId: "d1", productId: "운전자금", items } as never} />);
  });
  return root;
}

async function choose(label: string) {
  const input = host.querySelector("input:not([type=checkbox])") as HTMLInputElement;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(input, label);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const apply = [...host.querySelectorAll("button")].find((b) => b.textContent === "적용") as HTMLButtonElement;
  await act(async () => { apply.click(); });
}

describe("ChecklistPanel 상품 바꾸기 확인 (QA #885)", () => {
  it("항목이 있으면 바로 바꾸지 않고 묻는다 — «그대로 두기» 면 서버를 부르지 않는다", async () => {
    await render([{ id: "i1", label: "사업자등록증", checked: true }]);
    await choose("시설자금");
    expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain("체크 1/1");
    expect(actions.applyProductAction).not.toHaveBeenCalled();
    const keep = [...host.querySelectorAll("button")].find((b) => b.textContent === "그대로 두기") as HTMLButtonElement;
    await act(async () => { keep.click(); });
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(actions.applyProductAction).not.toHaveBeenCalled();
  });

  it("«바꾸기» 를 누르면 그때 적용한다", async () => {
    await render([{ id: "i1", label: "사업자등록증", checked: false }]);
    await choose("시설자금");
    const change = [...host.querySelectorAll("button")].find((b) => b.textContent === "바꾸기") as HTMLButtonElement;
    await act(async () => { change.click(); });
    expect(actions.applyProductAction).toHaveBeenCalledTimes(1);
  });

  it("같은 상품을 다시 골라도 체크가 풀리지 않게 아무것도 하지 않는다", async () => {
    await render([{ id: "i1", label: "사업자등록증", checked: true }]);
    await choose("운전자금");
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(actions.applyProductAction).not.toHaveBeenCalled();
  });
});
