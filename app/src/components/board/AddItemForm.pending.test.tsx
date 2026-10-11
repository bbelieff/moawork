// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AddItemForm } from "./AddItemForm";
import { addItemAction } from "@/app/(app)/boards/actions";

vi.mock("@/app/(app)/boards/actions", () => ({ addItemAction: vi.fn() }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.clearAllMocks();
});

const mockedAddItem = vi.mocked(addItemAction);

function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  return host;
}

// 직접 끝내는 Promise 로 «저장 중» 을 재현한다 — 끝나기 전에는 pending 이 그대로다.
function pendingAddItem() {
  let finish!: () => void;
  mockedAddItem.mockImplementation(
    () =>
      new Promise<{ ok: boolean }>((resolve) => {
        finish = () => resolve({ ok: true });
      }),
  );
  return { done: () => finish() };
}

function type(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function renderForm(host: HTMLElement) {
  await act(async () => {
    root!.render(<AddItemForm boardId="합성-보드" variant="inline" />);
  });
  return {
    form: host.querySelector("form") as HTMLFormElement,
    input: host.querySelector('input[name="title"]') as HTMLInputElement,
  };
}

describe("AddItemForm — 저장 중 표시와 중복 제출 막기", () => {
  it("저장 중에는 안내가 바뀌었다가 끝나면 돌아온다", async () => {
    const host = mount();
    const { done } = pendingAddItem();
    const { form, input } = await renderForm(host);
    expect(host.textContent).toContain("이름만 입력하면 등록돼요.");
    await act(async () => type(input, "합성 항목"));
    await act(async () => form.requestSubmit());
    expect(host.textContent).toContain("추가하는 중…");
    await act(async () => {
      done();
    });
    expect(host.textContent).toContain("이름만 입력하면 등록돼요.");
    expect(host.textContent).not.toContain("추가하는 중…");
  });

  it("저장 중에 다시 제출해도 한 번만 저장한다", async () => {
    const host = mount();
    const { done } = pendingAddItem();
    const { form, input } = await renderForm(host);
    await act(async () => type(input, "합성 항목"));
    await act(async () => form.requestSubmit());
    await act(async () => form.requestSubmit());
    expect(mockedAddItem).toHaveBeenCalledTimes(1);
    await act(async () => {
      done();
    });
    expect(host.textContent).toContain("이름만 입력하면 등록돼요.");
  });
});

describe("QA #882 — 추가가 실패하면 입력한 이름을 남긴다", () => {
  it("실패하면 이름이 칸에 그대로 있고, 성공하면 비운다", async () => {
    const host = mount();
    const { form, input } = await renderForm(host);
    mockedAddItem.mockResolvedValueOnce({ ok: false });
    await act(async () => type(input, "실패할 항목"));
    await act(async () => form.requestSubmit());
    expect(input.value).toBe("실패할 항목");

    mockedAddItem.mockResolvedValueOnce({ ok: true });
    await act(async () => form.requestSubmit());
    expect(input.value).toBe("");
  });
});
