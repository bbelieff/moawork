// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/boards/new-lead-actions", () => ({ createNewLeadAction: vi.fn() }));
import { NewLeadIntakeForm } from "./NewLeadIntakeForm";

let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("Issue #549 new lead header CTA", () => {
  it("일반 이름 한 칸이 아니라 전용 업체 등록 폼을 body portal로 연다", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <NewLeadIntakeForm
          variant="header"
          boardId="board-a"
          groupId="group-a"
          members={[{ id: "user-a", label: "김담당" }]}
          currentUserId="user-a"
        />,
      );
    });
    const opener = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("새 업체"))!;
    await act(async () => opener.click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="새 업체 등록"]')!;
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.querySelector('[name="title"]')).not.toBeNull();
    expect(dialog.querySelector('[name="business_registration_type"]')).not.toBeNull();
    expect(dialog.querySelector('[name="assigned_to"]')).not.toBeNull();
    expect(document.activeElement).toBe(dialog.querySelector('[name="title"]'));
    await act(async () => dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="dialog"][aria-label="새 업체 등록"]')).toBeNull();
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(document.activeElement).toBe(opener);
  });
});
