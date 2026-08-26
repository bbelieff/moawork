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

const members = [
  { id: "a", label: "가람", title: "팀장", groupId: "sales", groupLabel: "영업본부" },
  { id: "b", label: "보라", title: "매니저", groupId: "sales", groupLabel: "영업본부" },
  { id: "c", label: "초록", title: "실장", groupId: "ops", groupLabel: "심사실행팀" },
];

async function mount(multiple = true) {
  const form = document.createElement("form");
  form.addEventListener("submit", (event) => event.preventDefault());
  document.body.append(form);
  root = createRoot(form);
  await act(async () => root?.render(
    <MemberPicker
      label={multiple ? "연관담당" : "담당자"}
      multiple={multiple}
      members={members}
      value={multiple ? [] : "a"}
      ruleRecipients={multiple ? [members[0]] : []}
    />,
  ));
  return form;
}

async function open(form: HTMLFormElement) {
  const trigger = form.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!;
  await act(async () => trigger.click());
  return { trigger, dialog: document.body.querySelector<HTMLElement>('[role="dialog"]')! };
}

describe("MemberPicker 조직형 선택창", () => {
  it("검색으로 숨겨진 선택도 보존하고 부서를 누르면 현재 구성원을 함께 저장한다", async () => {
    const form = await mount();
    const { dialog } = await open(form);
    expect(dialog.textContent).toContain("규칙에 따라 받는 사람");
    expect(dialog.textContent).toContain("영업본부");
    expect(dialog.textContent).toContain("심사실행팀");

    const search = dialog.querySelector<HTMLInputElement>('[aria-label="연관담당 멤버 검색"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(search, "초록");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const visibleChecks = [...dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    await act(async () => visibleChecks.at(-1)?.click());

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(search, "");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const salesGroup = [...dialog.querySelectorAll("label")].find((label) => label.textContent?.includes("영업본부"))!;
    await act(async () => salesGroup.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click());
    await act(async () => [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "선택 저장")?.click());
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(new FormData(form).getAll("value").sort()).toEqual(["a", "b", "c"]);
  });

  it("Escape와 바깥 클릭으로 닫고 Escape는 열었던 버튼에 포커스를 돌린다", async () => {
    const form = await mount(false);
    const { trigger } = await open(form);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await open(form);
    await act(async () => document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("담당자는 radio 한 명만 직렬화하고 미배정을 선택할 수 있다", async () => {
    const form = await mount(false);
    const { dialog } = await open(form);
    const radios = [...dialog.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    await act(async () => radios.at(-1)?.click());
    await act(async () => [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "선택 저장")?.click());
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(new FormData(form).getAll("value")).toEqual(["c"]);
  });
});
