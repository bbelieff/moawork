// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
const { setCellAction } = vi.hoisted(() => ({ setCellAction: vi.fn<(formData: FormData) => Promise<undefined>>(async () => undefined) }));
vi.mock("@/app/(app)/boards/actions", () => ({ setCellAction }));

import { WorkflowProgressCell } from "./WorkflowProgressCell";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import type { WorkflowStageMoveTargets } from "@/lib/workflow/progress";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event("close")); };
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  setCellAction.mockClear();
});

const STAGES = [
  { id: "대기중", label: "대기중", color: "#00c875" },
  { id: "심사 중", label: "심사 중", color: "#9cd326" },
  { id: "관리중", label: "관리중", color: "#ff5ac4" },
  { id: "📂소진공 혁신성장 대기", label: "📂소진공 혁신성장 대기", color: "#ffcb00" },
  { id: "업체관리", label: "업체관리" },
  { id: "해당연도 매출", label: "해당연도 매출" },
];

const MOVES: WorkflowStageMoveTargets = new Map([
  ["대기중", { groupId: "g-ready", groupName: "⏹️ 준비단계" }],
  ["심사 중", { groupId: "g-review", groupName: "🔂 심사 중" }],
]);

function column(options = STAGES) {
  return {
    id: "col-progress",
    key: "workflow_progress",
    label: "진행현황",
    type: "status",
    source: "in",
    options_jsonb: { options: options.map((option, order) => ({ ...option, order })) },
  } as unknown as BoardColumn;
}

function row(value: string) {
  return { id: "row-1", title: "건1", group_id: "g-review", values: { progress_status: value } } as unknown as ItemWithValues;
}

async function renderCell(props: Partial<React.ComponentProps<typeof WorkflowProgressCell>> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const element = (extra: Partial<React.ComponentProps<typeof WorkflowProgressCell>> = {}) => (
    <WorkflowProgressCell boardId="b-1" row={row("심사 중")} column={column()} kind="work" readOnly={false} moveTargets={MOVES} {...props} {...extra} />
  );
  await act(async () => root!.render(element()));
  return { host, rerender: async (extra: Partial<React.ComponentProps<typeof WorkflowProgressCell>>) => act(async () => root!.render(element(extra))) };
}

const trigger = (host: ParentNode) => host.querySelector<HTMLButtonElement>('button[role="combobox"][aria-label="진행현황"]')!;
const popover = () => document.querySelector<HTMLElement>("[data-stage-picker]");
// jsdom 에는 CSS.escape 가 없다 — 이모지·공백이 든 id 는 속성값을 직접 비교한다.
const option = (id: string) => [...document.querySelectorAll<HTMLElement>("[data-stage-option]")]
  .find((node) => node.getAttribute("data-stage-option") === id)!;
const groupTitles = () => [...(popover()?.querySelectorAll('[role="group"]') ?? [])].map((group) => group.querySelector('[role="presentation"]')?.textContent);

async function openPicker(host: HTMLElement) {
  await act(async () => trigger(host).click());
  await act(async () => new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); }));
}

async function type(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function key(target: HTMLElement, name: string) {
  await act(async () => target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true })));
}

describe("WorkflowProgressCell — 한 줄 진행현황 칩 (#839)", () => {
  it("칸에는 컨트롤이 칩 하나뿐이다 — 검색칸·native select 가 칸에 쌓이지 않는다", async () => {
    const { host } = await renderCell();
    expect(host.querySelectorAll("select")).toHaveLength(0);
    expect(host.querySelectorAll('input[type="search"]')).toHaveLength(0);
    expect(host.querySelectorAll('button[role="combobox"]')).toHaveLength(1);
    expect(trigger(host).textContent).toContain("심사 중");
    expect(trigger(host).getAttribute("aria-haspopup")).toBe("listbox");
    // 제출 계약: 같은 폼·같은 hidden 이름.
    const data = new FormData(trigger(host).form!);
    expect(data.get("columnKey")).toBe("progress_status");
    expect(data.get("value")).toBe("심사 중");
    expect(popover()).toBeNull();
  });

  it("팝오버 안 검색칸에 포커스가 가고, 이동 여부로 나눠 보여 주며 만들기 행은 없다", async () => {
    const { host } = await renderCell();
    await openPicker(host);
    const search = popover()!.querySelector<HTMLInputElement>('input[aria-label="진행 단계 검색"]')!;
    expect(search).not.toBeNull();
    expect(document.activeElement).toBe(search);
    expect(popover()!.parentElement).toBe(document.body);
    expect(groupTitles()).toEqual(["보드 이동", "상태만 바꾸기 (보드 그대로)", "다음 업무로 이동"]);
    expect(option("대기중").closest('[role="group"]')?.textContent).toContain("보드 이동");
    expect(option("대기중").textContent).toContain("→ 준비단계");
    expect(option("심사 중").textContent).toContain("지금 그룹");
    expect(option("관리중").closest('[role="group"]')?.textContent).toContain("상태만 바꾸기");
    expect(popover()!.textContent).not.toContain("새로 만들기");

    await type(search, "혁신");
    expect([...popover()!.querySelectorAll('[data-stage-option]')].map((node) => node.getAttribute("data-stage-option")))
      .toEqual(["📂소진공 혁신성장 대기", "transfer"]);
    // 전이 선택지는 검색과 무관하게 항상 있다.
    expect(option("transfer").textContent).toContain("업체관리 현황에서 보기");
    await type(search, "없는단계");
    expect(popover()!.textContent).toContain("「없는단계」 단계가 없어요");
  });

  it("이모지는 화면에서만 걷고 제출값은 원래 id 다", async () => {
    // 저장이 진행되는 동안(액션 수명 안)만 고른 값을 미리 보여 준다.
    // (끝에 반드시 풀어 준다 — React 는 겹친 비동기 전환을 한 묶음으로 기다리므로, 안 풀린 액션이
    //  남으면 뒤 테스트의 낙관값도 끝나지 않는다.)
    let release: () => void = () => {};
    setCellAction.mockImplementationOnce(() => new Promise<undefined>((resolve) => { release = () => resolve(undefined); }));
    const { host } = await renderCell();
    await openPicker(host);
    const emoji = option("📂소진공 혁신성장 대기");
    expect(emoji.textContent).toContain("소진공 혁신성장 대기");
    expect(emoji.textContent).not.toContain("📂");
    await act(async () => emoji.click());
    expect(popover()).toBeNull();
    expect(setCellAction).toHaveBeenCalledTimes(1);
    const submitted = setCellAction.mock.calls[0][0] as FormData;
    expect(submitted.get("columnKey")).toBe("progress_status");
    expect(submitted.get("value")).toBe("📂소진공 혁신성장 대기");
    expect(trigger(host).textContent).toContain("소진공 혁신성장 대기");
    expect(document.activeElement).toBe(trigger(host));
    // 저장이 끝났는데 재조회가 값을 바꾸지 않았으면(거절) 저장값으로 돌아간다.
    await act(async () => release());
    expect(trigger(host).textContent).toContain("심사 중");
  });

  it("↑↓·Enter 로 고르고 Esc 는 값을 바꾸지 않고 칩으로 돌아간다", async () => {
    const { host } = await renderCell();
    await openPicker(host);
    const search = popover()!.querySelector<HTMLInputElement>("input")!;
    await key(search, "Escape");
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(trigger(host));
    expect(setCellAction).not.toHaveBeenCalled();

    await openPicker(host);
    const reopened = popover()!.querySelector<HTMLInputElement>("input")!;
    // 열면 현재 값(심사 중)이 활성 — 아래로 한 칸은 «상태만 바꾸기» 의 첫 줄(관리중).
    expect(reopened.getAttribute("aria-activedescendant")).toBe(option("심사 중").id);
    await key(reopened, "ArrowDown");
    expect(reopened.getAttribute("aria-activedescendant")).toBe(option("관리중").id);
    await key(reopened, "Enter");
    expect((setCellAction.mock.calls[0][0] as FormData).get("value")).toBe("관리중");
  });

  it("다음 업무로 이동은 확인 대화를 열고 저장하지 않는다", async () => {
    const { host } = await renderCell();
    await openPicker(host);
    await act(async () => option("transfer").click());
    expect(host.querySelector("dialog")!.open).toBe(true);
    expect(setCellAction).not.toHaveBeenCalled();
    expect(trigger(host).textContent).toContain("심사 중");
  });

  it("여러 행 선택 중이면 일괄 흐름으로 넘기고 표시값을 되돌린다", async () => {
    const bulkIntercept = vi.fn(() => true);
    const { host } = await renderCell({ bulkIntercept });
    await openPicker(host);
    await act(async () => option("관리중").click());
    expect(bulkIntercept).toHaveBeenCalledWith("관리중");
    expect(setCellAction).not.toHaveBeenCalled();
    expect(trigger(host).textContent).toContain("심사 중");
  });

  it("낙관값은 액션 수명에 묶인다 — 저장 중에만 보이고, 끝나면 저장값(재조회 결과)을 보여 준다", async () => {
    const settle: Array<() => void> = [];
    const cellAction = vi.fn<(formData: FormData) => Promise<void>>(() => new Promise<void>((resolve) => { settle.push(resolve); }));
    const { host, rerender } = await renderCell({ cellAction });
    await openPicker(host);
    await act(async () => option("관리중").click());
    expect(cellAction).toHaveBeenCalledTimes(1);
    expect(trigger(host).textContent).toContain("관리중");
    // 성공: 같은 전환에서 서버 재조회가 저장값을 새 값으로 바꾼다.
    await act(async () => settle.shift()!());
    await rerender({ cellAction, row: { ...row("관리중") } });
    expect(trigger(host).textContent).toContain("관리중");
  });

  it("같은 문구로 두 번 연속 거절돼도 저장되지 않은 단계가 칩에 남지 않는다 (#845 검토 후속)", async () => {
    const settle: Array<() => void> = [];
    const cellAction = vi.fn<(formData: FormData) => Promise<void>>(() => new Promise<void>((resolve) => { settle.push(resolve); }));
    const rejected = "항목을 저장하지 못했어요.";
    const { host, rerender } = await renderCell({ cellAction });

    await openPicker(host);
    await act(async () => option("관리중").click());
    expect(trigger(host).textContent).toContain("관리중");
    await act(async () => settle.shift()!());
    await rerender({ cellAction, error: rejected });
    expect(trigger(host).textContent).toContain("심사 중");

    // 두 번째 거절 — 오류 문구가 «바뀌지 않아도» 액션이 끝나면 저장값으로 돌아간다.
    await openPicker(host);
    await act(async () => option("관리중").click());
    expect(cellAction).toHaveBeenCalledTimes(2);
    expect(trigger(host).textContent).toContain("관리중");
    await act(async () => settle.shift()!());
    await rerender({ cellAction, error: rejected });
    expect(trigger(host).textContent).toContain("심사 중");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(rejected);
    // 부모가 오류를 소비해도 낙관값이 되살아나지 않는다.
    await rerender({ cellAction, error: null });
    expect(trigger(host).textContent).toContain("심사 중");
  });

  it("행을 옮길 권한이 없으면 다른 그룹으로 옮기는 단계만 비활성이다 (#845)", async () => {
    const { host } = await renderCell({ canMoveRows: false });
    await openPicker(host);
    expect(option("대기중").getAttribute("aria-disabled")).toBe("true");
    expect(option("대기중").textContent).toContain("권한 없음");
    // 지금 그룹으로 가는 단계·값만 바뀌는 단계·다음 업무로 이동은 그대로 고를 수 있다.
    expect(option("심사 중").hasAttribute("aria-disabled")).toBe(false);
    expect(option("관리중").hasAttribute("aria-disabled")).toBe(false);
    expect(option("transfer").hasAttribute("aria-disabled")).toBe(false);
    await act(async () => option("대기중").click());
    expect(setCellAction).not.toHaveBeenCalled();
    expect(popover()).not.toBeNull();
  });

  it("이동 정보를 모르는 화면은 한 묶음(보드 안 단계)으로 보여 주고, 읽기 전용이면 열리지 않는다", async () => {
    const { host, rerender } = await renderCell({ moveTargets: null });
    await openPicker(host);
    expect(groupTitles()).toEqual(["보드 안 단계", "다음 업무로 이동"]);
    await key(popover()!.querySelector("input")!, "Escape");
    await rerender({ readOnly: true });
    expect(trigger(host).disabled).toBe(true);
    await act(async () => trigger(host).click());
    expect(popover()).toBeNull();
  });
});
