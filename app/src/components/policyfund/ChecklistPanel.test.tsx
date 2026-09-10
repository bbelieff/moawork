// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ mutate: vi.fn(), preset: vi.fn() }));
vi.mock("@/lib/policyfund/checklist/actions", () => ({
  mutateChecklistAction: actions.mutate,
  saveChecklistAsPresetAction: actions.preset,
}));

import { ChecklistPanel } from "./ChecklistPanel";

let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialState = {
  caseId: "case-a",
  dealId: "case-a",
  productId: "상품",
  items: [{ id: "item-a", label: "서류", checked: false, order: 0 }],
  version: 3,
};

async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<ChecklistPanel dealId="case-a" initialState={initialState} canManagePresets />));
  return host;
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

beforeEach(() => {
  actions.mutate.mockReset().mockResolvedValue({ ...initialState, items: [{ ...initialState.items[0], checked: true }], version: 4 });
  actions.preset.mockReset().mockResolvedValue({ productId: "상품", items: [], updatedAt: "2026-08-31T00:00:00.000Z" });
});

describe("ChecklistPanel single Case mutation fence", () => {
  it("freezes the clicked snapshot and coalesces preset events while saving", async () => {
    let release!: () => void;
    actions.preset.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    const host = await mount();
    const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent === "프리셋으로 저장")!;
    await act(async () => { button.click(); button.click(); await Promise.resolve(); });
    expect(actions.preset).toHaveBeenCalledTimes(1);
    const sent = actions.preset.mock.calls[0][0] as FormData;
    expect(JSON.parse(String(sent.get("state")))).toEqual(initialState);
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true);
    await act(async () => release());
  });

  it("blocks preset save while a checklist mutation is pending", async () => {
    let release!: (value: typeof initialState) => void;
    actions.mutate.mockImplementation(() => new Promise<typeof initialState>((resolve) => { release = resolve; }));
    const host = await mount();
    const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => { checkbox.click(); await Promise.resolve(); });
    const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent === "프리셋으로 저장")!;
    expect(button.disabled).toBe(true);
    await act(async () => { button.click(); await Promise.resolve(); });
    expect(actions.preset).not.toHaveBeenCalled();
    await act(async () => release({ ...initialState, items: [{ ...initialState.items[0], checked: true }], version: 4 }));
  });

  it("retries a failed preset with the same frozen snapshot and keeps other mutations blocked", async () => {
    actions.preset.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ productId: "상품", items: [], updatedAt: "2026-08-31T00:00:00.000Z" });
    const host = await mount();
    const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent === "프리셋으로 저장")!;
    await act(async () => { button.click(); await Promise.resolve(); });
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true);
    const retry = [...host.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent === "같은 프리셋 다시 시도")!;
    await act(async () => { retry.click(); await Promise.resolve(); });
    const first = actions.preset.mock.calls[0][0] as FormData;
    const second = actions.preset.mock.calls[1][0] as FormData;
    expect(second.get("state")).toBe(first.get("state"));
  });

  it("unblocks checklist mutations after a terminal preset permission failure", async () => {
    actions.preset.mockRejectedValueOnce(new Error("서류 프리셋을 바꿀 권한이 없어요."));
    const host = await mount();
    const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent === "프리셋으로 저장")!;
    await act(async () => { button.click(); await Promise.resolve(); });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("권한");
    expect([...host.querySelectorAll("button")].some((candidate) => candidate.textContent === "같은 프리셋 다시 시도")).toBe(false);
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(false);
  });

  it("treats a malformed-product schema response as terminal and restores the prior state", async () => {
    actions.mutate.mockRejectedValueOnce(new Error("case checklist schema invalid"));
    const host = await mount();
    const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => { checkbox.click(); await Promise.resolve(); });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("schema invalid");
    expect([...host.querySelectorAll("button")].some((candidate) => candidate.textContent === "같은 요청 다시 시도")).toBe(false);
    expect(checkbox.checked).toBe(false);
    expect(checkbox.disabled).toBe(false);
  });
});
