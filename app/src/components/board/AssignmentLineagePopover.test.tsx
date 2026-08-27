// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  read: vi.fn(),
  reassign: vi.fn(),
  follower: vi.fn(),
  schedule: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("@/app/(app)/boards/assignment-lineage-actions", () => ({
  readAssignmentLineageAction: actions.read,
  reassignAssignmentAction: actions.reassign,
  setAssignmentFollowerAction: actions.follower,
  scheduleAssignmentHandoffAction: actions.schedule,
  cancelAssignmentHandoffAction: actions.cancel,
}));

import { AssignmentLineagePopover } from "./AssignmentLineagePopover";

let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const members = [
  { id: "member-a", label: "현재 담당", groupLabel: "영업" },
  { id: "member-b", label: "다음 담당", groupLabel: "영업" },
  { id: "member-c", label: "알림 담당", groupLabel: "지원" },
];
const ref = { boardId: "board-a", dealId: "deal-a", itemId: "item-a" };
const snapshot = {
  orgId: "org-a",
  ...ref,
  baselineAssigneeId: "member-b",
  currentAssigneeId: "member-a",
  version: 2,
  transitions: [{
    id: "transition-a", sequence: 1, fromUserId: "member-b", toUserId: "member-a",
    actorUserId: "member-a", requestId: "request-a", createdAt: "2026-08-27T00:00:00.000Z",
  }],
  followers: [{ userId: "member-c", addedBy: "member-a", createdAt: "2026-08-27T00:00:00.000Z" }],
  pendingHandoff: null,
};

async function flush() {
  await act(async () => { await Promise.resolve(); await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
}

async function mount(readOnly = false) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<AssignmentLineagePopover {...ref} currentAssigneeId="member-a" members={members} readOnly={readOnly} />));
  const trigger = host.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!;
  await act(async () => trigger.click());
  await flush();
  return { trigger, dialog: document.body.querySelector<HTMLElement>('[aria-label="담당자 흐름"]')! };
}

async function submitReassignment(dialog: HTMLElement, targetLabel: string) {
  await act(async () => [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "담당자 변경")?.click());
  const picker = document.body.querySelector<HTMLElement>('[aria-label="현재 담당자 선택"]')!;
  const target = [...picker.querySelectorAll<HTMLLabelElement>("label")].find((label) => label.textContent?.includes(targetLabel))!;
  await act(async () => target.querySelector<HTMLInputElement>("input")?.click());
  await act(async () => [...picker.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "선택 저장")?.click());
  await flush();
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

beforeEach(() => {
  actions.read.mockReset().mockResolvedValue({ ok: true, data: snapshot });
  actions.reassign.mockReset().mockResolvedValue({ ok: true, data: { version: 3 } });
  actions.follower.mockReset().mockResolvedValue({ ok: true, data: { version: 2 } });
  actions.schedule.mockReset().mockResolvedValue({ ok: true, data: { version: 2, handoffId: "handoff-a" } });
  actions.cancel.mockReset().mockResolvedValue({ ok: true, data: { version: 2 } });
});

describe("#599 AssignmentLineagePopover", () => {
  it("loads only when opened and renders ordered history, current, pending, and split notification recipients", async () => {
    expect(actions.read).not.toHaveBeenCalled();
    const { dialog } = await mount();
    expect(actions.read).toHaveBeenCalledWith(ref);
    expect(dialog.textContent).toContain("이전 담당자");
    expect(dialog.textContent).toContain("다음 담당");
    expect(dialog.textContent).toContain("현재 담당");
    expect(dialog.textContent).toContain("알림 담당");
    expect(dialog.textContent).toContain("규칙 수신자");
    expect(dialog.querySelector('[aria-label="현재 담당님을 알림 대상에서만 제외"]')).toBeNull();
    expect(dialog.querySelector('[aria-label="알림 담당님을 알림 대상에서만 제외"]')).not.toBeNull();
  });

  it("releases a rejected reassignment and retries with the exact same request id and expected version", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("50000000-0000-4000-8000-000000000001");
    actions.reassign
      .mockRejectedValueOnce(new Error("transport unavailable"))
      .mockResolvedValueOnce({ ok: true, data: { version: 3 } });
    const { dialog } = await mount();
    await submitReassignment(dialog, "다음 담당");
    expect(actions.reassign).toHaveBeenCalledWith({ ...ref, assignedTo: "member-b", expectedAssignedTo: "member-a", expectedVersion: 2, requestId: "50000000-0000-4000-8000-000000000001" });
    const retry = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "같은 요청 다시 시도")!;
    expect(retry.disabled).toBe(false);
    expect(dialog.getAttribute("aria-busy")).toBeNull();
    expect(dialog.textContent).not.toContain("담당자 변경 중");
    await act(async () => retry.click());
    await flush();
    expect(actions.reassign).toHaveBeenCalledTimes(2);
    expect(actions.reassign.mock.calls[1][0]).toEqual(actions.reassign.mock.calls[0][0]);
  });

  it("offers exact same-request retry for a resolved unavailable result", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("50000000-0000-4000-8000-000000000002");
    actions.reassign
      .mockResolvedValueOnce({ ok: false, code: "unavailable", error: "일시 오류" })
      .mockResolvedValueOnce({ ok: true, data: { version: 3 } });
    const { dialog } = await mount();
    await submitReassignment(dialog, "다음 담당");
    const retry = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "같은 요청 다시 시도")!;
    expect(retry.disabled).toBe(false);
    await act(async () => retry.click());
    await flush();
    expect(actions.reassign.mock.calls[1][0]).toEqual(actions.reassign.mock.calls[0][0]);
  });

  it("refreshes a conflict and requires a new intent built from the refreshed version", async () => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("50000000-0000-4000-8000-000000000003")
      .mockReturnValueOnce("50000000-0000-4000-8000-000000000004");
    const refreshed = { ...snapshot, currentAssigneeId: "member-b", version: 3 };
    actions.read
      .mockResolvedValueOnce({ ok: true, data: snapshot })
      .mockResolvedValueOnce({ ok: true, data: refreshed });
    actions.reassign
      .mockResolvedValueOnce({ ok: false, code: "conflict", error: "먼저 변경되었습니다." })
      .mockResolvedValueOnce({ ok: true, data: { version: 4 } });
    const { dialog } = await mount();
    await submitReassignment(dialog, "다음 담당");
    expect(actions.read).toHaveBeenCalledTimes(2);
    expect(dialog.textContent).toContain("먼저 변경되었습니다.");
    expect(dialog.textContent).toContain("다음 담당");
    expect(dialog.textContent).not.toContain("같은 요청 다시 시도");
    expect(dialog.getAttribute("aria-busy")).toBeNull();
    await submitReassignment(dialog, "현재 담당");
    expect(actions.reassign).toHaveBeenCalledTimes(2);
    expect(actions.reassign.mock.calls[1][0]).toEqual({
      ...ref,
      assignedTo: "member-a",
      expectedAssignedTo: "member-b",
      expectedVersion: 3,
      requestId: "50000000-0000-4000-8000-000000000004",
    });
  });

  it.each([
    ["request_mismatch", "요청 내용이 다릅니다."],
    ["permission", "변경할 권한이 없습니다."],
  ])("does not offer exact retry for terminal %s failures", async (code, error) => {
    actions.reassign.mockResolvedValueOnce({ ok: false, code, error });
    const { dialog } = await mount();
    await submitReassignment(dialog, "다음 담당");
    expect(dialog.textContent).toContain(error);
    expect(dialog.textContent).not.toContain("같은 요청 다시 시도");
    expect(dialog.getAttribute("aria-busy")).toBeNull();
    expect(actions.read).toHaveBeenCalledTimes(1);
    expect(document.body.contains(dialog)).toBe(true);
  });

  it("keeps follower removal separate from history and returns focus on Escape", async () => {
    const { dialog, trigger } = await mount();
    await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="알림 담당님을 알림 대상에서만 제외"]')?.click());
    await flush();
    expect(actions.follower).toHaveBeenCalledWith(expect.objectContaining({ ...ref, userId: "member-c", follow: false }));
    expect(dialog.textContent).toContain("다음 담당");
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await flush();
    expect(document.body.querySelector('[aria-label="담당자 흐름"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("fails closed on read error and exposes no mutation controls", async () => {
    actions.read.mockResolvedValue({ ok: false, code: "permission", error: "볼 수 없습니다." });
    const { dialog } = await mount();
    expect(dialog.textContent).toContain("볼 수 없습니다.");
    expect(dialog.textContent).not.toContain("미배정");
    expect(dialog.textContent).not.toContain("도입 이후 담당 변경 이력이 없습니다.");
    expect(dialog.textContent).not.toContain("예정된 인계가 없습니다.");
    expect(dialog.textContent).not.toContain("알림 대상이 없습니다.");
    expect(dialog.textContent).not.toContain("담당자 변경");
    expect(dialog.textContent).not.toContain("알림 대상 추가");
  });

  it("turns a rejected read into a retryable error without false-empty content or a loading deadlock", async () => {
    actions.read
      .mockRejectedValueOnce(new Error("transport unavailable"))
      .mockResolvedValueOnce({ ok: true, data: snapshot });
    const { dialog } = await mount();
    expect(dialog.textContent).toContain("요청을 완료할 수 없습니다.");
    expect(dialog.textContent).not.toContain("미배정");
    expect(dialog.textContent).not.toContain("도입 이후 담당 변경 이력이 없습니다.");
    expect(dialog.textContent).not.toContain("예정된 인계가 없습니다.");
    expect(dialog.textContent).not.toContain("알림 대상이 없습니다.");
    expect(dialog.getAttribute("aria-busy")).toBeNull();
    const retry = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "다시 시도")!;
    await act(async () => retry.click());
    await flush();
    expect(actions.read).toHaveBeenCalledTimes(2);
    expect(dialog.textContent).toContain("현재 담당");
  });
});
