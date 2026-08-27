// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyOtherInfoValue, type OtherInfoValue } from "@/lib/boards/structured-field";
import { OtherInfoEditor } from "./OtherInfoEditor";

let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

async function mountEditor(props: Partial<React.ComponentProps<typeof OtherInfoEditor>> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const onChange = vi.fn<(value: OtherInfoValue) => void>();
  const onCommit = vi.fn<(value: OtherInfoValue) => void>();
  const onCancel = vi.fn<() => void>();
  const initialValue = Object.prototype.hasOwnProperty.call(props, "value")
    ? props.value
    : emptyOtherInfoValue();
  function Harness() {
    const [value, setValue] = useState<unknown>(initialValue);
    return (
      <OtherInfoEditor
        {...props}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    );
  }
  root = createRoot(host);
  await act(async () => {
    root?.render(<Harness />);
  });
  return { host, onChange, onCommit, onCancel };
}

describe("Issue #601 other-info editor", () => {
  it("enables text only when checked and preserves it after uncheck", async () => {
    const { host, onChange } = await mountEditor();
    const checkbox = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[3];
    const text = host.querySelector<HTMLInputElement>('input[aria-label="보유인증 내용"]')!;

    expect(text.disabled).toBe(true);
    await act(async () => checkbox.click());
    expect(text.disabled).toBe(false);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(text, "벤처기업 인증");
      text.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => checkbox.click());

    const latest = onChange.mock.calls.at(-1)?.[0];
    expect(latest?.certifications).toEqual({ checked: false, text: "벤처기업 인증" });
    expect(text.value).toBe("벤처기업 인증");
    expect(text.disabled).toBe(true);
  });

  it("supports Escape cancellation and Ctrl+Enter commit", async () => {
    const { host, onCommit, onCancel } = await mountEditor();
    const fieldset = host.querySelector("fieldset")!;

    await act(async () => fieldset.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await act(async () => fieldset.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit.mock.calls[0][0].version).toBe(1);
  });

  it("renders errors accessibly and locks every control in read-only mode", async () => {
    const { host } = await mountEditor({ readOnly: true, error: "저장할 수 없습니다" });

    expect(host.querySelector('[role="alert"]')?.textContent).toBe("저장할 수 없습니다");
    expect(host.querySelector("fieldset")?.getAttribute("aria-readonly")).toBe("true");
    for (const control of host.querySelectorAll<HTMLInputElement>("input")) expect(control.disabled).toBe(true);
  });

  it("renders legacy projection without turning absent facets into false values", async () => {
    const { host } = await mountEditor({
      value: null,
      legacy: { closed_business: "폐업", export_status: "수출 없음" },
    });

    const checkboxes = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(false);
    expect(host.querySelector<HTMLInputElement>('input[aria-label="폐업이력 내용"]')?.value).toBe("폐업");
    expect(host.querySelector<HTMLInputElement>('input[aria-label="수출여부 내용"]')?.value).toBe("수출 없음");
  });
});
