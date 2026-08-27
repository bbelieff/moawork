// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssignmentFlowPopover, type AssignmentFlowPopoverProps } from "./AssignmentFlowPopover";

let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const previousA = { id: "previous-a", label: "이전 하나", title: "매니저" };
const previousB = { id: "previous-b", label: "이전 둘", active: false };
const current = { id: "current", label: "현재 담당", title: "팀장" };
const next = { id: "next", label: "다음 담당" };
const direct = { id: "direct", label: "직접 알림" };

const defaults: AssignmentFlowPopoverProps = {
  current,
  history: [
    { id: "history-2", member: previousB, sequence: 2, unassignedAt: "2026-08-20T09:00:00.000Z" },
    { id: "history-1", member: previousA, sequence: 1, unassignedAt: "2026-08-10T09:00:00.000Z" },
  ],
  nextHandoff: { id: "handoff", member: next, scheduledFor: "2026-09-01T09:00:00.000Z" },
  ruleRecipients: [current],
  followers: [{ id: "follower", member: direct }],
};

async function mount(props: Partial<AssignmentFlowPopoverProps> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<AssignmentFlowPopover {...defaults} {...props} />));
  const trigger = host.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!;
  await act(async () => trigger.click());
  await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  return { host, trigger, dialog: document.body.querySelector<HTMLElement>('[role="dialog"]')! };
}

describe("AssignmentFlowPopover", () => {
  it("renders previous assignees in sequence, current, pending handoff, and split recipients", async () => {
    const { dialog } = await mount();
    const text = dialog.textContent || "";
    expect(text.indexOf("이전 하나")).toBeLessThan(text.indexOf("이전 둘"));
    const sections = [...dialog.querySelectorAll("section")];
    expect(sections.find((section) => section.querySelector("h3")?.textContent === "현재 담당자")?.textContent).toContain("현재 담당");
    expect(sections.find((section) => section.querySelector("h3")?.textContent === "다음 인계 예정")?.textContent).toContain("다음 담당");
    expect(text).toContain("규칙 수신자");
    expect(text).toContain("직접 추가");
    expect(text).toContain("비활성 멤버");
  });

  it("removes only a direct follower through the callback and keeps history visible", async () => {
    const onRemoveFollower = vi.fn().mockResolvedValue({ ok: true });
    const { dialog } = await mount({ onRemoveFollower });
    const remove = dialog.querySelector<HTMLButtonElement>('[aria-label="직접 알림님을 알림 대상에서만 제외"]')!;
    expect(remove.title).toBe("알림 대상에서만 제외 · 담당 이력은 유지");
    await act(async () => remove.click());
    expect(onRemoveFollower).toHaveBeenCalledWith("follower");
    expect(dialog.textContent).toContain("이전 하나");
  });

  it("preserves the follower and shows an inline error when removal fails", async () => {
    const { dialog } = await mount({ onRemoveFollower: async () => ({ ok: false, error: "제외 권한이 없습니다." }) });
    const remove = dialog.querySelector<HTMLButtonElement>('[aria-label="직접 알림님을 알림 대상에서만 제외"]')!;
    await act(async () => remove.click());
    expect(dialog.textContent).toContain("직접 알림");
    expect(dialog.textContent).toContain("제외 권한이 없습니다.");
  });

  it("covers empty, loading, source error, and read-only states without inventing persistence", async () => {
    const retry = vi.fn();
    const { dialog } = await mount({
      current: null,
      history: [],
      nextHandoff: null,
      ruleRecipients: [],
      followers: [],
      loading: false,
      error: "네트워크 오류",
      readOnly: true,
      onRetry: retry,
      onRemoveFollower: vi.fn(),
    });
    expect(dialog.textContent).toContain("이전 담당 이력이 없습니다.");
    expect(dialog.textContent).toContain("미배정");
    expect(dialog.textContent).toContain("예정된 인계가 없습니다.");
    expect(dialog.textContent).toContain("알림 대상이 없습니다.");
    expect(dialog.textContent).toContain("보기만 가능합니다");
    expect(dialog.querySelector("[aria-label$='알림 대상에서만 제외']")).toBeNull();
    await act(async () => [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "다시 시도")?.click());
    expect(retry).toHaveBeenCalledOnce();
  });

  it("uses aria-busy skeletons while loading", async () => {
    const { dialog } = await mount({ loading: true });
    expect(dialog.getAttribute("aria-busy")).toBe("true");
    expect(dialog.querySelector('[aria-label="담당자 흐름 불러오는 중"]')).not.toBeNull();
    expect(dialog.textContent).not.toContain("이전 하나");
  });

  it("closes on Escape and returns focus to the current-assignee trigger", async () => {
    const { trigger } = await mount();
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("clamps a 1440 anchored portal inside the viewport", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<AssignmentFlowPopover {...defaults} />));
    const trigger = host.querySelector<HTMLButtonElement>('button')!;
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      x: 1390, y: 850, left: 1390, top: 850, right: 1430, bottom: 880, width: 40, height: 30, toJSON: () => ({}),
    });
    await act(async () => trigger.click());
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.style.left).toBe("1000px");
    expect(Number.parseFloat(dialog.style.top)).toBeGreaterThanOrEqual(8);
    expect(Number.parseFloat(dialog.style.left) + Number.parseFloat(dialog.style.width)).toBeLessThanOrEqual(1432);
  });
});
