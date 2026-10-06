// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";

const { action } = vi.hoisted(() => ({ action: vi.fn() }));
vi.mock("@/app/(app)/boards/pipeline-structure-actions", () => ({ pipelineStructureAction: action }));
vi.mock("@/app/(app)/boards/actions", () => ({ setCellAction: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
import { WorkflowProgressCell } from "./WorkflowProgressCell";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const stageError = "현재 단계에서는 이 관문을 넘을 수 없습니다.";
const column = { id: "col", key: "consult_status", type: "status", options_jsonb: { options: [] } } as unknown as BoardColumn;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () {
    this.open = false; this.dispatchEvent(new Event("close"));
  };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); document.body.replaceChildren(); action.mockReset(); vi.restoreAllMocks();
});
async function render(error: string | null, itemId = "row-a", readOnly = false) {
  const row = { id: itemId, title: "합성 테스트 행", values: { consult_status: "통화완료" } } as unknown as ItemWithValues;
  await act(async () => root.render(<WorkflowProgressCell boardId="board-a" row={row} column={column} kind="new-lead" readOnly={readOnly} error={error} />));
}
function button(label: string, container: ParentNode = host) {
  return [...container.querySelectorAll("button")].find((node) => node.textContent === label)!;
}
async function openTransition() {
  // #839 — 진행현황은 칩 + 팝오버다. 칩을 열고 «다음 업무로 이동» 선택지를 누른다.
  const trigger = host.querySelector<HTMLButtonElement>('button[role="combobox"][aria-label="진행현황"]')!;
  await act(async () => trigger.click());
  const transfer = document.querySelector<HTMLElement>('[data-stage-option="transfer"]')!;
  await act(async () => transfer.click());
}

describe("workflow dialog pipeline repair across server refresh", () => {
  it("retains an in-flight preview when the parent consumes its flash error", async () => {
    let finish!: (value: unknown) => void;
    action.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await render(stageError); await openTransition();
    await act(async () => button("단계 구성 확인").click());
    await render(null);
    await act(async () => finish({ ok: true, message: "확인", pipelineId: "pipeline-a", pipelineName: "합성 파이프라인", missing: ["work"] }));
    expect(host.textContent).toContain("합성 파이프라인 · 추가: 실무");
    expect(button("기본 상담·실무 단계 추가")).toBeDefined();
  });

  it("keeps the preview after the action clears the flash error, applies the same identity, and survives closing", async () => {
    let finish!: (value: unknown) => void;
    action.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce({ ok: true, message: "다시 실행해 주세요.", pipelineId: "pipeline-a", pipelineName: "합성 파이프라인", missing: [] });
    await render(null); await openTransition(); await render(stageError);
    const dialog = host.querySelector("dialog")!;
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('[role="alert"]')?.textContent).toBe(stageError);
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1);
    await act(async () => button("단계 구성 확인", dialog).click());
    expect(button("단계 구성 확인", dialog).disabled).toBe(true);
    // Next's server action response rerenders the parent without the consumed flash.
    await render(null);
    await act(async () => finish({ ok: true, message: "확인", pipelineId: "pipeline-a", pipelineName: "합성 파이프라인", missing: ["meeting", "work"] }));
    expect(dialog.textContent).toContain("합성 파이프라인 · 추가: 상담, 실무");
    expect(button("기본 상담·실무 단계 추가", dialog)).toBeDefined();
    await act(async () => dialog.close());
    await openTransition();
    expect(button("기본 상담·실무 단계 추가", dialog)).toBeDefined();
    await act(async () => button("기본 상담·실무 단계 추가", dialog).click());
    expect(action).toHaveBeenLastCalledWith({ itemId: "row-a", apply: true, pipelineId: "pipeline-a", missing: ["meeting", "work"] });
    expect(dialog.querySelector('[role="status"]')?.textContent).toContain("다시 실행");
  });

  it("offers no mutation after permission denial and resets the preview for another row", async () => {
    action.mockResolvedValueOnce({ ok: false, message: "관리자만 복구할 수 있습니다." })
      .mockResolvedValueOnce({ ok: true, message: "확인", pipelineId: "pipeline-a", pipelineName: "합성", missing: ["work"] });
    await render(stageError); await openTransition();
    const dialog = host.querySelector("dialog")!;
    await act(async () => button("단계 구성 확인", dialog).click()); await render(null);
    expect(dialog.textContent).toContain("관리자만 복구할 수 있습니다.");
    expect(button("기본 상담·실무 단계 추가", dialog)).toBeUndefined();
    await act(async () => button("단계 구성 확인", dialog).click());
    expect(button("기본 상담·실무 단계 추가", dialog)).toBeDefined();
    await render(null, "row-b");
    expect(button("기본 상담·실무 단계 추가", dialog)).toBeUndefined();
    await render(stageError, "row-b", true);
    expect(button("단계 구성 확인", dialog)).toBeUndefined();
  });
});
