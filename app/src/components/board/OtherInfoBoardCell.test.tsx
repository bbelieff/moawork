// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OtherInfoSaveState } from "@/app/(app)/boards/other-info-action-state";
import { emptyOtherInfoValue } from "@/lib/boards/structured-field";
import { OtherInfoBoardCell } from "./OtherInfoBoardCell";

let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

async function mount(saveAction: (previous: OtherInfoSaveState, formData: FormData) => Promise<OtherInfoSaveState>) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(
    <OtherInfoBoardCell
      boardId="board-a"
      itemId="item-a"
      fieldKey="custom_other_info"
      value={emptyOtherInfoValue()}
      readOnly={false}
      saveAction={saveAction}
    />,
  ));
  return host;
}

describe("Issue #601 actual other-info board consumer", () => {
  it("portals one modal, keeps the failed draft, retries the same intent, and restores focus", async () => {
    let attempt = 0;
    const seen: string[] = [];
    const saveAction = vi.fn(async (previous: OtherInfoSaveState, formData: FormData) => {
      seen.push(String(formData.get("value")));
      attempt += 1;
      return attempt === 1
        ? { ok: false, message: "일시 실패", requestId: String(formData.get("requestId")), attempt: previous.attempt + 1 }
        : { ok: true, message: "저장됨", requestId: String(formData.get("requestId")), attempt: previous.attempt + 1 };
    });
    const host = await mount(saveAction);
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
    trigger.focus();
    await act(async () => trigger.click());
    expect(document.body.querySelectorAll('[data-board-modal-layer]')).toHaveLength(1);
    expect(host.querySelector('[data-board-modal-layer]')).toBeNull();

    const certification = document.body.querySelector<HTMLInputElement>('input[aria-label="보유인증 내용"]')!;
    const certificationCheck = document.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[3];
    await act(async () => certificationCheck.click());
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(certification, "벤처기업");
      certification.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const form = document.body.querySelector<HTMLFormElement>('form')!;
    expect(new FormData(form).get("fieldKey")).toBe("custom_other_info");
    await act(async () => { form.requestSubmit(); await Promise.resolve(); });
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe("일시 실패");
    expect(document.body.querySelector<HTMLInputElement>('input[aria-label="보유인증 내용"]')?.value).toBe("벤처기업");
    await act(async () => { form.requestSubmit(); await Promise.resolve(); });
    expect(saveAction).toHaveBeenCalledTimes(2);
    expect(seen[1]).toBe(seen[0]);
    expect(document.body.querySelector('[data-board-modal-layer]')).toBeNull();
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(document.activeElement).toBe(trigger);
  });

  it("cancel performs no action", async () => {
    const saveAction = vi.fn(async (previous: OtherInfoSaveState, formData: FormData) => ({
      ok: true,
      message: "저장됨",
      requestId: String(formData.get("requestId")),
      attempt: previous.attempt + 1,
    }));
    const host = await mount(saveAction);
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.click());
    const cancel = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "취소")!;
    await act(async () => cancel.click());
    expect(saveAction).not.toHaveBeenCalled();
  });
});
