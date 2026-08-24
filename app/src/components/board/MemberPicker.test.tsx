// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { MemberPicker } from "./MemberPicker";

let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

async function mount() {
  const host = document.createElement("form");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<MemberPicker label="협업자" multiple members={[{ id: "a", label: "가람" }, { id: "b", label: "보라" }]} value={[]} />));
  return host;
}

describe("MemberPicker multiple search", () => {
  it("검색으로 먼저 고른 멤버가 숨겨져도 전체 선택을 직렬화하고 미배정은 모두 비운다", async () => {
    const form = await mount();
    const checks = () => [...form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    await act(async () => { checks()[1].click(); });
    const search = form.querySelector<HTMLInputElement>('[aria-label="협업자 멤버 검색"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(search, "보");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { checks()[1].click(); });
    expect(new FormData(form).getAll("value")).toEqual(["a", "b"]);
    await act(async () => { checks()[0].click(); });
    expect(new FormData(form).getAll("value")).toEqual([""]);
  });
});
