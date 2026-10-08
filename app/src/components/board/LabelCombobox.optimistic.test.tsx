// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LabelCombobox } from "./LabelCombobox";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

const OPTIONS = [
  { id: "진행중", label: "진행중" },
  { id: "심사 중", label: "심사 중" },
  { id: "승인", label: "승인" },
];

function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  return host;
}

// 직접 끝내는 Promise 를 돌려줘서 «저장 중» 을 재현한다 — 끝나기 전에는 pending 이 그대로다.
function pendingAction() {
  let finish!: () => void;
  let seen: FormData | null = null;
  const action = vi.fn((formData: FormData) => {
    seen = formData;
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  return { action, seen: () => seen as unknown as FormData, done: () => finish() };
}

type ComboProps = React.ComponentProps<typeof LabelCombobox>;

async function renderInForm(
  host: HTMLElement,
  action: (formData: FormData) => Promise<void>,
  props: Partial<ComboProps> = {},
) {
  await act(async () => {
    root!.render(
      <form action={action}>
        <LabelCombobox options={OPTIONS} value="진행중" label="진행상황" {...props} />
      </form>,
    );
  });
  return host.querySelector('input[role="combobox"]') as HTMLInputElement;
}

async function pick(host: HTMLElement, input: HTMLInputElement, label: string) {
  await act(async () => input.focus());
  const option = [...host.querySelectorAll('[role="option"] button')].find((button) =>
    button.textContent?.includes(label),
  ) as HTMLButtonElement;
  await act(async () => option.click());
}

function combobox(host: HTMLElement) {
  return host.querySelector('input[role="combobox"]') as HTMLInputElement;
}

describe("LabelCombobox — 단일 선택 즉시 표시", () => {
  it("고르면 저장 전에도 새 라벨이 보이고 저장 중 표시가 붙는다", async () => {
    const host = mount();
    const { action, done } = pendingAction();
    const input = await renderInForm(host, action);
    await pick(host, input, "승인");
    expect(input.placeholder).toBe("승인");
    expect(input.getAttribute("data-saving")).toBe("true");
    // 덜 끝난 저장은 다음 테스트의 폼까지 붙잡으므로 여기서 끝낸다.
    await act(async () => {
      done();
    });
  });

  it("부모 값이 그대로면(서버 거절) 원래 라벨로 돌아간다", async () => {
    const host = mount();
    const { action, done } = pendingAction();
    const input = await renderInForm(host, action);
    await pick(host, input, "승인");
    expect(input.placeholder).toBe("승인");
    await act(async () => {
      done();
    });
    expect(input.placeholder).toBe("진행중");
    expect(input.hasAttribute("data-saving")).toBe(false);
  });

  it("optimistic 을 끄면 고른 직후에도 원래 라벨이다", async () => {
    const host = mount();
    const { action, done } = pendingAction();
    const input = await renderInForm(host, action, { optimistic: false });
    await pick(host, input, "승인");
    expect(input.placeholder).toBe("진행중");
    // 덜 끝난 저장은 다음 테스트의 폼까지 붙잡으므로 여기서 끝낸다.
    await act(async () => {
      done();
    });
  });

  it("값이 있을 때만 data-has-value 가 붙는다", async () => {
    const host = mount();
    await act(async () => {
      root!.render(<LabelCombobox options={OPTIONS} value="진행중" label="진행상황" />);
    });
    expect(combobox(host).getAttribute("data-has-value")).toBe("true");
    await act(async () => {
      root!.render(<LabelCombobox options={OPTIONS} value="" label="진행상황" />);
    });
    expect(combobox(host).hasAttribute("data-has-value")).toBe(false);
  });

  it("고른 값이 hidden input 으로 제출된다", async () => {
    const host = mount();
    const { action, seen, done } = pendingAction();
    const input = await renderInForm(host, action, { value: "" });
    await pick(host, input, "승인");
    const hidden = host.querySelector('input[type="hidden"][name="value"]') as HTMLInputElement;
    expect(hidden?.value).toBe("승인");
    expect(action).toHaveBeenCalledTimes(1);
    expect(seen().get("value")).toBe("승인");
    // 덜 끝난 저장은 다음 테스트의 폼까지 붙잡으므로 여기서 끝낸다.
    await act(async () => {
      done();
    });
  });
});
