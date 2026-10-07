// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #849 PR2 — 「새 탭 만들기」 팝오버. createTabFromSidebarAction(본문은 createBoardAction 과 같다)으로
 * 이름·자리(nav_section)·요청 ID 를 보내고, 열 때마다 요청 ID 를 새로 만든다.
 * 실패는 던지지 않고 폼 아래 한 줄로, 화면(경로)이 바뀌면 닫는다.
 */

const action = vi.hoisted(() => ({ calls: [] as FormData[], result: { error: null as string | null } }));
const route = vi.hoisted(() => ({ pathname: "/w/sample-lab/boards" }));
vi.mock("@/app/(app)/boards/actions", () => ({
  createTabFromSidebarAction: vi.fn(async (_previous: unknown, formData: FormData) => {
    action.calls.push(formData);
    return action.result;
  }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));

import { NEW_TAB_HINT, SidebarNewTab } from "./SidebarNewTab";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let root: Root | undefined;
let host: HTMLElement;

async function mount() {
  host = document.createElement("aside");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<SidebarNewTab />); });
}
/** 지속 레이아웃의 화면 이동 — 부품은 그대로 살아 있고 경로만 바뀐다. */
async function navigate(pathname: string) {
  route.pathname = pathname;
  await act(async () => { root!.render(<SidebarNewTab />); });
  await flushFrames();
}

function trigger(): HTMLButtonElement {
  return host.querySelector<HTMLButtonElement>('button[data-nav-key="new-tab"]')!;
}
function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}
function field<T extends HTMLElement>(selector: string): T {
  return dialog()!.querySelector<T>(selector)!;
}
async function flushFrames() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}
async function open() {
  await act(async () => { trigger().click(); });
  await flushFrames();
}
async function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function submit() {
  const form = field<HTMLFormElement>("form");
  await act(async () => { form.requestSubmit(); });
  await flushFrames();
}

beforeEach(() => {
  action.calls = [];
  action.result = { error: null };
  route.pathname = "/w/sample-lab/boards";
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = undefined;
  document.body.replaceChildren();
});

describe("새 탭 만들기 팝오버", () => {
  it("열면 제목·이름·자리·안내·버튼이 있고 탭 이름 칸으로 간다", async () => {
    await mount();
    expect(dialog()).toBeNull();
    await open();

    const panel = dialog()!;
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(trigger().getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("aria-labelledby")).toBe(panel.querySelector("h2")!.id);
    expect(panel.querySelector("h2")!.textContent).toBe("새 탭 만들기");

    const name = field<HTMLInputElement>('input[name="name"]');
    expect(name.required).toBe(true);
    expect(name.maxLength).toBe(100);
    expect(panel.querySelector(`label[for="${name.id}"]`)!.textContent).toBe("탭 이름");
    expect(document.activeElement).toBe(name);

    const place = field<HTMLSelectElement>('select[name="nav_section"]');
    expect(panel.querySelector(`label[for="${place.id}"]`)!.textContent).toBe("어디에 둘까요");
    expect([...place.options].map((option) => [option.value, option.textContent])).toEqual([
      ["before-contract", "업무 › 계약 전"],
      ["after-contract", "업무 › 계약 후"],
    ]);
    expect(place.value).toBe("after-contract");

    expect(panel.textContent).toContain(NEW_TAB_HINT);
    expect(NEW_TAB_HINT).toBe("기본 아이템 1개와 기본 열 3개(상태 · 담당 · 마감일)가 함께 만들어져요.");
    expect([...panel.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["취소", "만들기"]);
  });

  it("만들기는 createTabFromSidebarAction 에 이름·자리·요청 ID 를 보낸다", async () => {
    await mount();
    await open();
    await setValue(field<HTMLInputElement>('input[name="name"]'), "영업 파이프라인");
    await setValue(field<HTMLSelectElement>('select[name="nav_section"]'), "before-contract");
    await submit();

    expect(action.calls).toHaveLength(1);
    const sent = action.calls[0];
    expect(sent.get("name")).toBe("영업 파이프라인");
    expect(sent.get("nav_section")).toBe("before-contract");
    expect(String(sent.get("requestId"))).toMatch(UUID);
  });

  it("자리를 고르지 않으면 계약 후로 보낸다", async () => {
    await mount();
    await open();
    await setValue(field<HTMLInputElement>('input[name="name"]'), "계약 진행");
    await submit();
    expect(action.calls[0].get("nav_section")).toBe("after-contract");
  });

  it("★ 요청 ID 는 «열 때마다» 새로 만든다 — 같은 창의 두 번 누름은 한 요청, 다시 열면 새 요청", async () => {
    await mount();
    await open();
    const first = field<HTMLInputElement>('input[name="requestId"]').value;
    expect(first).toMatch(UUID);
    expect(field<HTMLInputElement>('input[name="requestId"]').value).toBe(first);

    await act(async () => { field<HTMLButtonElement>("button[type=button]").click(); });
    await open();
    const second = field<HTMLInputElement>('input[name="requestId"]').value;
    expect(second).toMatch(UUID);
    expect(second).not.toBe(first);
  });

  it("이름이 비었거나 공백뿐이면 보내지 않고 이유를 말한다", async () => {
    await mount();
    await open();
    await setValue(field<HTMLInputElement>('input[name="name"]'), "   ");
    await submit();

    expect(action.calls).toHaveLength(0);
    const name = field<HTMLInputElement>('input[name="name"]');
    expect(name.getAttribute("aria-invalid")).toBe("true");
    const alert = dialog()!.querySelector('[role="alert"]')!;
    expect(alert.textContent).toBe("탭 이름을 적어 주세요.");
    expect(name.getAttribute("aria-describedby")).toBe(alert.id);
  });

  it("Escape 로 닫히고 포커스가 「새 탭」 줄로 돌아온다", async () => {
    await mount();
    await open();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await flushFrames();

    expect(dialog()).toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger());
  });

  it("취소로 닫히고 포커스가 돌아온다", async () => {
    await mount();
    await open();
    await act(async () => { field<HTMLButtonElement>("button[type=button]").click(); });
    await flushFrames();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("다른 팝오버가 열리면 닫힌다", async () => {
    await mount();
    await open();
    await act(async () => {
      window.dispatchEvent(new CustomEvent("moawork:popover-open", { detail: "board-filter" }));
    });
    expect(dialog()).toBeNull();
  });

  it("★ 서버가 거절하면 던지지 않고 폼 아래 한 줄로 알린다 — 창·입력은 그대로", async () => {
    action.result = { error: "이 업무를 실행할 권한이 없어요." };
    await mount();
    await open();
    await setValue(field<HTMLInputElement>('input[name="name"]'), "영업 파이프라인");
    await submit();

    expect(action.calls).toHaveLength(1);
    const panel = dialog()!;
    const alert = panel.querySelector<HTMLElement>("[data-new-tab-error]")!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toBe("이 업무를 실행할 권한이 없어요.");
    expect(panel.querySelector("form")!.getAttribute("aria-describedby")).toBe(alert.id);
    expect(field<HTMLInputElement>('input[name="name"]').value).toBe("영업 파이프라인");
    expect(field<HTMLButtonElement>("button[type=submit]").disabled).toBe(false);
  });

  it("★ 실패 줄은 다시 열면 사라진다 — 지난번 실패를 끌고 오지 않는다", async () => {
    action.result = { error: "탭을 만들지 못했어요. 잠시 후 다시 시도해 주세요." };
    await mount();
    await open();
    await setValue(field<HTMLInputElement>('input[name="name"]'), "영업 파이프라인");
    await submit();
    expect(dialog()!.querySelector("[data-new-tab-error]")).not.toBeNull();

    await act(async () => { field<HTMLButtonElement>("button[type=button]").click(); });
    await open();
    expect(dialog()!.querySelector("[data-new-tab-error]")).toBeNull();
    expect(field<HTMLInputElement>('input[name="name"]').value).toBe("");
  });

  it("★ 화면(경로)이 바뀌면 닫는다 — 만들기 성공 후 새 탭 위에 창이 남아 같은 요청 ID 로 또 보내지 않게", async () => {
    await mount();
    await open();
    const first = field<HTMLInputElement>('input[name="requestId"]').value;
    await setValue(field<HTMLInputElement>('input[name="name"]'), "영업 파이프라인");
    await submit();
    expect(action.calls).toHaveLength(1);

    // 액션의 redirect 가 새 탭으로 옮긴 것과 같다 — 사이드바(지속 레이아웃)는 다시 마운트되지 않는다.
    await navigate("/w/sample-lab/boards/new-tab-id");
    expect(dialog()).toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");

    await open();
    const second = field<HTMLInputElement>('input[name="requestId"]').value;
    expect(second).toMatch(UUID);
    expect(second).not.toBe(first);
  });

  it("경로가 그대로면(같은 화면 다시 그리기) 열린 창을 닫지 않는다", async () => {
    await mount();
    await open();
    await navigate("/w/sample-lab/boards");
    expect(dialog()).not.toBeNull();
  });

  it("Tab 이 대화상자 안에서 맴돈다", async () => {
    await mount();
    await open();
    const buttons = [...dialog()!.querySelectorAll<HTMLButtonElement>("button")];
    const last = buttons[buttons.length - 1];
    last.focus();
    await act(async () => {
      last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(field<HTMLInputElement>('input[name="name"]'));
  });
});
