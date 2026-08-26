// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckOption, FilterChip, RadioOption } from "./FilterChip";

let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

async function mountFilter() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <FilterChip label="상담상황" active={false} onClear={vi.fn()}>
        <button type="button">전체</button>
      </FilterChip>,
    );
  });
  const opener = document.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!;
  await act(async () => opener.click());
  await act(async () => Promise.resolve());
  return {
    opener,
    dialog: document.querySelector<HTMLElement>('[role="dialog"]')!,
    backdrop: document.querySelector<HTMLElement>(".mw-layer-page-popover")!,
  };
}

describe("Issue #542 filter portal", () => {
  it("body portal에서 열고 내부 클릭은 유지하며 Escape 뒤 opener로 돌아간다", async () => {
    const { opener, dialog } = await mountFilter();
    expect(dialog.parentElement).toBe(document.querySelector(".mw-layer-page-popover"));
    expect(dialog.closest("body")).toBe(document.body);
    expect(document.activeElement?.textContent).toBe("전체");
    await act(async () => dialog.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await act(async () => Promise.resolve());
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);
    expect(document.activeElement).toBe(opener);
  });

  it("backdrop 자체를 누르면 닫고 opener로 돌아간다", async () => {
    const { opener, backdrop } = await mountFilter();
    await act(async () => backdrop.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    await act(async () => Promise.resolve());
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);
    expect(document.activeElement).toBe(opener);
  });

  it("모바일 필터 선택 행은 44px 터치 높이를 유지한다", () => {
    const html = renderToStaticMarkup(
      <><CheckOption checked={false} label="선택" onToggle={vi.fn()} /><RadioOption checked={false} label="단일" onPick={vi.fn()} /></>,
    );
    expect(html.match(/min-h-11/g)).toHaveLength(2);
  });

  it("팝오버 안에 필터 이름·선택 해제·완료가 함께 보여 고립된 검색 상자가 되지 않는다", async () => {
    const { dialog } = await mountFilter();
    expect(dialog.textContent).toContain("상담상황");
    expect(dialog.textContent).toContain("원하는 값을 여러 개 고를 수 있어요");
    expect(dialog.textContent).toContain("선택 해제");
    const done = [...dialog.querySelectorAll("button")].find((button) => button.textContent === "완료")!;
    await act(async () => done.click());
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);
  });
});
