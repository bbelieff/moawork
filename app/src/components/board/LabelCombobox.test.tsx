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

async function renderCombo(host: HTMLElement, props: Partial<React.ComponentProps<typeof LabelCombobox>> = {}) {
  await act(async () => {
    root!.render(<LabelCombobox options={OPTIONS} value="" label="진행상황" {...props} />);
  });
  return host.querySelector('input[role="combobox"]') as HTMLInputElement;
}

function type(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function key(input: HTMLElement, keyName: string) {
  input.dispatchEvent(new KeyboardEvent("keydown", { key: keyName, bubbles: true, cancelable: true }));
}

describe("LabelCombobox — 검색·키보드", () => {
  it("포커스하면 목록이 열리고 입력하면 좁혀진다", async () => {
    const host = mount();
    const input = await renderCombo(host);
    await act(async () => input.focus());
    expect(host.querySelector('[role="listbox"]')).not.toBeNull();
    await act(async () => type(input, "심사"));
    expect([...host.querySelectorAll('[role="option"]')].map((o) => o.textContent)).toEqual(["심사 중"]);
  });

  it("↓ + Enter 로 키보드 선택한다", async () => {
    const host = mount();
    const onSelect = vi.fn();
    const input = await renderCombo(host, { onSelect });
    await act(async () => input.focus());
    await act(async () => type(input, "승"));
    await act(async () => key(input, "ArrowDown"));
    await act(async () => key(input, "Enter"));
    expect(onSelect).toHaveBeenCalledWith("승인");
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });

  it("Esc 는 닫기만 하고 입력값을 버리지 않는다", async () => {
    const host = mount();
    const input = await renderCombo(host, { onSelect: vi.fn() });
    await act(async () => input.focus());
    await act(async () => type(input, "승인"));
    await act(async () => key(input, "Escape"));
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(input.value).toBe("승인");
  });
});

describe("LabelCombobox — 만들기", () => {
  it("없는 값 + 만들 권한이면 만들기 행이 보인다", async () => {
    const host = mount();
    const input = await renderCombo(host, { canCreate: true, createLabel: vi.fn(async () => ({ ok: true, message: "ok" })) });
    await act(async () => input.focus());
    await act(async () => type(input, "새 라벨"));
    expect(host.textContent).toContain("「새 라벨」 새로 만들기");
  });

  it("만들기 권한이 없으면 만들기 행이 없다 — 검색·선택만 된다", async () => {
    const host = mount();
    const input = await renderCombo(host, {});
    await act(async () => input.focus());
    await act(async () => type(input, "새 라벨"));
    expect(host.textContent).not.toContain("새로 만들기");
    expect(host.textContent).toContain("찾은 값이 없습니다");
  });

  it("만들기 성공하면 선택하고 부모에 알린다", async () => {
    const host = mount();
    const onSelect = vi.fn();
    const onCreated = vi.fn();
    const createLabel = vi.fn(async () => ({ ok: true, optionId: "새 라벨", message: "만들었어요." }));
    const input = await renderCombo(host, { canCreate: true, createLabel, onSelect, onCreated });
    await act(async () => input.focus());
    await act(async () => type(input, "새 라벨"));
    const createButton = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("새로 만들기"))!;
    await act(async () => createButton.click());
    expect(createLabel).toHaveBeenCalledWith("새 라벨");
    expect(onSelect).toHaveBeenCalledWith("새 라벨");
    expect(onCreated).toHaveBeenCalledWith("새 라벨");
  });

  it("충돌하면 쿼리를 지우지 않고 기존값을 고른다", async () => {
    // 화면 목록은 낡았는데(«진행중» 없음) 서버에는 이미 있는 경우 — 경합 재현.
    const host = mount();
    const onSelect = vi.fn();
    const createLabel = vi.fn(async () => ({
      ok: false,
      conflict: true,
      optionId: "진행중",
      message: "«진행중»(으)로 이미 있어요. 그대로 씁니다.",
    }));
    await act(async () => {
      root!.render(
        <LabelCombobox
          options={[{ id: "심사 중", label: "심사 중" }]}
          value=""
          label="진행상황"
          canCreate
          createLabel={createLabel}
          onSelect={onSelect}
        />,
      );
    });
    const input = host.querySelector('input[role="combobox"]') as HTMLInputElement;
    await act(async () => input.focus());
    await act(async () => type(input, "진행중"));
    const createButton = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("새로 만들기"))!;
    await act(async () => createButton.click());
    expect(createLabel).toHaveBeenCalledWith("진행중");
    expect(onSelect).toHaveBeenCalledWith("진행중");
    // 쿼리가 사라지지 않는다.
    expect(input.value).toBe("진행중");
    expect(host.textContent).toContain("이미 있어요");
  });

  it("실패해도 쿼리가 남는다", async () => {
    const host = mount();
    const onSelect = vi.fn();
    const createLabel = vi.fn(async () => ({ ok: false, message: "라벨을 만들지 못했어요." }));
    const input = await renderCombo(host, { canCreate: true, createLabel, onSelect });
    await act(async () => input.focus());
    await act(async () => type(input, "새 라벨"));
    const createButton = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("새로 만들기"))!;
    await act(async () => createButton.click());
    expect(onSelect).not.toHaveBeenCalled();
    expect(input.value).toBe("새 라벨");
    expect(host.textContent).toContain("만들지 못했어요");
  });
});

describe("LabelCombobox — 복수·폼 계약", () => {
  it("복수 토글이 칩과 hidden input 에 반영된다", async () => {
    const host = mount();
    const input = await renderCombo(host, { multiple: true, value: [], name: "value" });
    await act(async () => input.focus());
    await act(async () => type(input, "진행"));
    const optionButton = [...host.querySelectorAll('[role="option"] button')][0];
    await act(async () => (optionButton as HTMLElement).click());
    expect(host.textContent).toContain("진행중");
    const hidden = host.querySelector('input[type="hidden"][name="value"]') as HTMLInputElement;
    expect(hidden?.value).toBe("진행중");
  });

  it("단일 폼 경로 — 선택하면 hidden 값으로 제출된다", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    let submitted = "";
    await act(async () => {
      root!.render(
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitted = new FormData(event.currentTarget).get("value") as string;
          }}
        >
          <LabelCombobox options={OPTIONS} value="" label="진행상황" />
        </form>,
      );
    });
    const input = host.querySelector('input[role="combobox"]') as HTMLInputElement;
    await act(async () => input.focus());
    await act(async () => type(input, "승인"));
    const optionButton = [...host.querySelectorAll('[role="option"] button')][0];
    await act(async () => (optionButton as HTMLElement).click());
    expect(submitted).toBe("승인");
  });
});


describe("LabelCombobox canonical refresh and empty keyboard selection", () => {
  it("does not resurrect a removed server label after props refresh", async () => {
    const host = mount();
    const input = await renderCombo(host);
    await act(async () => input.focus());
    expect(host.textContent).toContain("승인");
    await renderCombo(host, { options: OPTIONS.slice(0, 2) });
    expect([...host.querySelectorAll('[role="option"]')].map(o => o.textContent)).toEqual(["진행중", "심사 중"]);
  });

  it("clears optimistic created options when a fresh server definition arrives", async () => {
    const host = mount();
    const onSelect = vi.fn();
    const input = await renderCombo(host, { canCreate: true, onSelect, createLabel: vi.fn(async () => ({ ok: true, optionId: "새 라벨", message: "ok" })) });
    await act(async () => input.focus());
    await act(async () => type(input, "새 라벨"));
    await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent?.includes("새로 만들기"))!.click());
    await renderCombo(host, { options: [...OPTIONS, { id: "새 라벨", label: "새 라벨" }], onSelect });
    await renderCombo(host, { options: [...OPTIONS], onSelect });
    await act(async () => input.focus());
    expect([...host.querySelectorAll('[role="option"]')].some(o => o.textContent === "새 라벨")).toBe(false);
  });

  it("empty search then down+enter neither throws nor selects a missing option", async () => {
    const host = mount();
    const onSelect = vi.fn();
    const input = await renderCombo(host, { onSelect });
    const errors: unknown[] = [];
    const handler = (event: ErrorEvent) => { errors.push(event.error); event.preventDefault(); };
    window.addEventListener("error", handler);
    try {
      await act(async () => input.focus());
      await act(async () => type(input, "없는 검색값"));
      await act(async () => key(input, "ArrowDown"));
      await act(async () => key(input, "Enter"));
      expect(errors).toEqual([]);
      expect(onSelect).not.toHaveBeenCalled();
      expect(input.value).toBe("없는 검색값");
    } finally { window.removeEventListener("error", handler); }
  });
});


it("refreshes multi-select hidden values when the persisted selection changes", async () => {
  const host = mount();
  const input = await renderCombo(host, { multiple: true, value: ["진행중"], name: "choices" });
  await act(async () => input.focus());
  await act(async () => (host.querySelectorAll('[role="option"] button')[1] as HTMLButtonElement).click());
  expect([...host.querySelectorAll<HTMLInputElement>('input[name="choices"]')].map(e => e.value)).toEqual(["진행중", "심사 중"]);
  await renderCombo(host, { multiple: true, value: ["승인"], name: "choices" });
  expect([...host.querySelectorAll<HTMLInputElement>('input[name="choices"]')].map(e => e.value)).toEqual(["승인"]);
});
