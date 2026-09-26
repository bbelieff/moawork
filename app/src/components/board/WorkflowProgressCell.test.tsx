// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/app/(app)/boards/actions", () => ({
  setCellAction: vi.fn(async () => undefined),
}));

import { WorkflowProgressCell } from "./WorkflowProgressCell";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

function options(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `단계${index + 1}`,
    label: `단계${index + 1}`,
    order: index,
  }));
}

function mount(optionCount: number) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const column = {
    id: "col-progress",
    key: "progress_status",
    label: "진행현황",
    type: "status",
    source: "in",
    options_jsonb: { options: options(optionCount) },
  } as unknown as BoardColumn;
  const row = {
    id: "row-1",
    title: "건1",
    values: { progress_status: "단계1" },
  } as unknown as ItemWithValues;
  return { host, column, row };
}

async function renderCell(host: HTMLElement, column: BoardColumn, row: ItemWithValues) {
  await act(async () => {
    root!.render(
      <WorkflowProgressCell
        boardId="b-1"
        row={row}
        column={column}
        kind="work"
        readOnly={false}
      />,
    );
  });
}

describe("WorkflowProgressCell 단계 검색", () => {
  it("단계가 많으면 검색칸이 좁히고 제출 계약은 그대로다", async () => {
    const { host, column, row } = mount(6);
    await renderCell(host, column, row);

    const search = host.querySelector('input[aria-label="진행 단계 검색"]') as HTMLInputElement;
    expect(search).not.toBeNull();
    // 제출 계약: 같은 폼·같은 select 이름·전이 선택지 유지.
    const select = host.querySelector('select[name="value"]') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect([...select.options].some((o) => o.value === "__workflow_transfer__")).toBe(true);

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(search, "단계5");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const visible = [...host.querySelectorAll('optgroup[label="보드 안 단계"] option')].map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(visible).toEqual(["단계5"]);
    // 전이 선택지는 검색과 무관하게 항상 있다.
    expect([...host.querySelectorAll("select option")].some((o) => o.textContent?.includes("업체관리 현황에서 보기"))).toBe(true);
  });

  it("단계가 적으면 검색칸이 없고 만들기는 없다", async () => {
    const { host, column, row } = mount(2);
    await renderCell(host, column, row);
    expect(host.querySelector('input[aria-label="진행 단계 검색"]')).toBeNull();
    expect(host.querySelector('select[name="value"]')).not.toBeNull();
  });
});
