// @vitest-environment jsdom
/**
 * StagePicker — #845 검토 후속(접근성·이동 권한) + 단계 색 = 그룹 띠 톤.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StagePicker, STAGE_MOVE_LOCKED_HINT, type StageMoveTarget } from "./StagePicker";
import { resolveStatusColor } from "@/lib/boards/status-palette";
import type { FieldOption } from "@/lib/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

const OPTIONS: FieldOption[] = [
  { id: "준비", label: "준비", color: "#00c875", order: 0 },
  { id: "심사", label: "심사", color: "#9cd326", order: 1 },
  { id: "승인", label: "승인", color: "#cab641", order: 2 },
  { id: "메모만", label: "메모만", color: "#ff5ac4", order: 3 },
];

const TARGETS = new Map<string, StageMoveTarget>([
  ["준비", { groupId: "g-ready", groupName: "준비단계", accent: "var(--mw-tab-a-1)" }],
  ["심사", { groupId: "g-review", groupName: "심사 중", accent: "var(--mw-tab-a-4)" }],
  ["승인", { groupId: "g-ok", groupName: "승인", accent: "var(--mw-tab-a-5)" }],
]);

async function mount(props: Partial<React.ComponentProps<typeof StagePicker>> = {}) {
  const onSelect = vi.fn();
  const onTransfer = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(
    <StagePicker
      boardId="b"
      itemId="i"
      options={OPTIONS}
      value="심사"
      fallbackLabel="심사"
      moveTargets={TARGETS}
      currentGroupId="g-review"
      transitionLabel="업체관리 현황에서 보기"
      searchClassName=""
      onSelect={onSelect}
      onTransfer={onTransfer}
      {...props}
    />,
  ));
  const trigger = host.querySelector<HTMLButtonElement>('button[role="combobox"]')!;
  await act(async () => trigger.click());
  await act(async () => new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); }));
  const surface = document.querySelector<HTMLElement>("[data-stage-picker]")!;
  const search = surface.querySelector<HTMLInputElement>("input")!;
  return { host, trigger, surface, search, onSelect, onTransfer };
}

const option = (id: string) => [...document.querySelectorAll<HTMLElement>("[data-stage-option]")]
  .find((node) => node.getAttribute("data-stage-option") === id)!;
const activeId = (search: HTMLInputElement) => search.getAttribute("aria-activedescendant");

async function key(target: HTMLElement, name: string) {
  await act(async () => target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true })));
}

async function type(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("StagePicker 접근성 (#845 검토 후속)", () => {
  it("검색칸은 combobox 이고 결과 없음 안내는 listbox 밖의 status 다", async () => {
    const { surface, search } = await mount();
    const listbox = surface.querySelector<HTMLElement>('[role="listbox"]')!;
    expect(search.getAttribute("role")).toBe("combobox");
    expect(search.getAttribute("aria-expanded")).toBe("true");
    expect(search.getAttribute("aria-autocomplete")).toBe("list");
    expect(search.getAttribute("aria-controls")).toBe(listbox.id);
    // listbox 의 직속 자식은 group 뿐 — status 같은 다른 역할이 섞이지 않는다.
    expect([...listbox.children].every((child) => child.getAttribute("role") === "group")).toBe(true);

    await type(search, "없는단계");
    const status = surface.querySelector<HTMLElement>('[role="status"]')!;
    expect(status.textContent).toBe("「없는단계」 단계가 없어요");
    expect(listbox.contains(status)).toBe(false);
    expect(search.getAttribute("aria-describedby")).toBe(status.id);
  });

  it("활성 행이 없으면 Enter 는 아무것도 하지 않는다 — 검색 0건에서 전이 확인이 열리지 않는다", async () => {
    const { search, onSelect, onTransfer } = await mount();
    await type(search, "없는단계");
    expect(activeId(search)).toBeNull();
    await key(search, "Enter");
    expect(onTransfer).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(document.querySelector("[data-stage-picker]")).not.toBeNull();
    // 명시적으로 전이 행을 활성으로 만들면 그때 Enter 가 실행한다.
    await key(search, "ArrowDown");
    expect(activeId(search)).toBe(option("transfer").id);
    await key(search, "Enter");
    expect(onTransfer).toHaveBeenCalledTimes(1);
  });

  it("Home/End 는 처음·끝 선택지로 간다", async () => {
    const { search } = await mount();
    expect(activeId(search)).toBe(option("심사").id);
    await key(search, "End");
    expect(activeId(search)).toBe(option("transfer").id);
    await key(search, "Home");
    expect(activeId(search)).toBe(option("준비").id);
    await key(search, "ArrowUp");
    expect(activeId(search)).toBe(option("transfer").id);
  });
});

describe("StagePicker 이동 권한 (#845)", () => {
  it("행을 옮길 권한이 없으면 다른 그룹으로 옮기는 선택지는 비활성 — 클릭·키보드 모두 건너뛴다", async () => {
    const { search, onSelect } = await mount({ canMoveRows: false });
    for (const id of ["준비", "승인"]) {
      expect(option(id).getAttribute("aria-disabled")).toBe("true");
      expect(option(id).getAttribute("title")).toBe(STAGE_MOVE_LOCKED_HINT);
      expect(option(id).querySelector("[data-stage-locked]")?.textContent).toBe("권한 없음");
    }
    // 지금 그룹으로 가는 단계와 값만 바뀌는 단계는 그대로 고를 수 있다.
    expect(option("심사").hasAttribute("aria-disabled")).toBe(false);
    expect(option("메모만").hasAttribute("aria-disabled")).toBe(false);

    await act(async () => option("준비").click());
    expect(onSelect).not.toHaveBeenCalled();

    // 활성 = 지금 값(심사). 위로 가면 비활성 «준비» 를 건너뛰고 맨 끝(전이)으로 돈다.
    expect(activeId(search)).toBe(option("심사").id);
    await key(search, "ArrowUp");
    expect(activeId(search)).toBe(option("transfer").id);
    await key(search, "Home");
    expect(activeId(search)).toBe(option("심사").id);
    await key(search, "ArrowDown");
    expect(activeId(search)).toBe(option("메모만").id);
    await key(search, "Enter");
    expect(onSelect).toHaveBeenCalledWith("메모만");
  });

  it("권한이 있으면(기본) 모든 이동 선택지를 고를 수 있다", async () => {
    const { onSelect } = await mount();
    expect(document.querySelectorAll('[data-stage-option][aria-disabled="true"]')).toHaveLength(0);
    await act(async () => option("승인").click());
    expect(onSelect).toHaveBeenCalledWith("승인");
  });
});

describe("StagePicker 색 = 옮겨 갈 그룹의 톤 (#845)", () => {
  it("이동 선택지의 점과 칩은 그룹 톤, 값만 바뀌는 단계는 상태 팔레트 색", async () => {
    const { trigger } = await mount();
    const dot = (id: string) => option(id).querySelector<HTMLElement>("[data-mw-stage-dot]")!.style.backgroundColor;
    expect(dot("준비")).toBe("var(--mw-tab-a-1)");
    expect(dot("승인")).toBe("var(--mw-tab-a-5)");
    expect(dot("메모만")).not.toContain("--mw-tab");
    expect(resolveStatusColor(OPTIONS[3])).toBe("#ff5ac4");
    // 칩(현재 값 = 심사)도 같은 톤이다 — 그룹 띠와 같은 색.
    expect(trigger.querySelector<HTMLElement>("[data-mw-stage-dot]")!.style.backgroundColor).toBe("var(--mw-tab-a-4)");
    expect(trigger.getAttribute("style")).toContain("var(--mw-tab-a-4)");
  });
});
