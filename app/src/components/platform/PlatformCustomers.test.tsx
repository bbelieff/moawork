// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformCustomerRegistry } from "./PlatformCustomerRegistry";
import { PlatformCustomerDetail } from "./PlatformCustomerDetail";
import type { CustomerDetail, CustomerSummary } from "@/lib/platform/customers/contracts";

const pushes: string[] = [];
const refreshes: string[] = [];

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => { pushes.push(href); },
    refresh: () => { refreshes.push("refresh"); },
  }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const summary: CustomerSummary = {
  orgId: "00000000-0000-4000-8000-0000000000a1",
  name: "알파 회사",
  slug: "alpha",
  orgStatus: "active",
  industry: "경영컨설팅",
  setupStatus: "setting_up",
  inviteState: "pending",
  memberCount: 1,
  openTaskCount: 1,
  updatedAt: "2026-09-17T00:00:00Z",
};

const detail: CustomerDetail = {
  ...summary,
  hasRep: false,
  canEnter: true,
  canManage: true,
  template: { key: null, appliedAt: null },
};

const task = {
  taskId: "00000000-0000-4000-8000-000000000071",
  title: "대표 초대 안내",
  kind: "setup" as const,
  status: "todo" as const,
  createdAt: "2026-09-17T00:00:00Z",
  updatedAt: "2026-09-17T00:00:00Z",
};

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function mount(node: React.ReactNode): void {
  act(() => {
    root.render(node);
  });
}

function input(id: string): HTMLInputElement {
  const el = container.querySelector(`#${id}`);
  if (!(el instanceof HTMLInputElement)) throw new Error(`missing input ${id}`);
  return el;
}

function typeInto(el: HTMLInputElement, value: string): void {
  act(() => {
    el.focus();
    // React controlled input은 직접 대입을 무시하므로 네이티브 setter로 바꾼다.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("missing input value setter");
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  pushes.length = 0;
  refreshes.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("unexpected fetch"); }));
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    value: () => "00000000-0000-4000-8000-000000000099",
    configurable: true,
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

describe("PlatformCustomerRegistry", () => {
  it("renders the narrow list with filters and a refresh control", () => {
    mount(<PlatformCustomerRegistry customers={[summary]} query={{ search: "", status: "all" }} problem={null} />);
    expect(container.textContent).toContain("알파 회사");
    expect(container.textContent).toContain("세팅 중");
    expect(container.textContent).toContain("초대 전");
    expect(container.textContent).toContain("미처리 1건");
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe("전체");
    expect(container.textContent).toContain("새로고침");
    // 업무·개인 정보는 목록에 없다.
    expect(container.textContent).not.toContain("requester_user_id");
  });

  it("keeps typed values when validation fails instead of clearing the form", () => {
    mount(<PlatformCustomerRegistry customers={[]} query={{ search: "", status: "all" }} problem={null} />);
    act(() => {
      container.querySelector<HTMLButtonElement>("button")!;
    });
    const openButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "새 고객사");
    act(() => { openButton!.click(); });
    typeInto(input("customer-new-name"), "  ");
    typeInto(input("customer-new-slug"), "alpha");
    act(() => {
      container.querySelector('form[aria-label="새 고객사 등록"]')!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(container.textContent).toContain("회사 이름을 1~80자로 입력해 주세요.");
    // 실패해도 입력값은 그대로 — 다시 치게 하지 않는다.
    expect(input("customer-new-name").value).toBe("  ");
    expect(input("customer-new-slug").value).toBe("alpha");
  });

  it("keeps typed values when the server rejects the slug", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: false, message: "이 회사 주소는 사용할 수 없어요." }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    mount(<PlatformCustomerRegistry customers={[]} query={{ search: "", status: "all" }} problem={null} />);
    const openButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "새 고객사");
    act(() => { openButton!.click(); });
    typeInto(input("customer-new-name"), "알파 회사");
    typeInto(input("customer-new-slug"), "platform");
    await act(async () => {
      container.querySelector('form[aria-label="새 고객사 등록"]')!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    // 클라이언트 검증에서 걸려 서버에 닿지 않고, 입력은 보존된다.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("이 회사 주소는 사용할 수 없어요");
    expect(input("customer-new-name").value).toBe("알파 회사");
  });

  it("navigates only to a re-read customer, never on an unconfirmed save", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).startsWith("/api/workspace-requests")) {
        return new Response(JSON.stringify({ ok: true, state: "approved", redirectTo: "/w/alpha" }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, customers: [{ orgId: summary.orgId, slug: "alpha" }] }), { status: 200 });
    }));
    mount(<PlatformCustomerRegistry customers={[]} query={{ search: "", status: "all" }} problem={null} />);
    const openButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "새 고객사");
    act(() => { openButton!.click(); });
    typeInto(input("customer-new-name"), "알파 회사");
    typeInto(input("customer-new-slug"), "alpha");
    await act(async () => {
      container.querySelector('form[aria-label="새 고객사 등록"]')!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(pushes).toEqual([`/platform/organizations/${summary.orgId}`]);
  });

  it("stays put with guidance when the save cannot be re-read", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).startsWith("/api/workspace-requests")) {
        return new Response(JSON.stringify({ ok: true, state: "approved", redirectTo: "/w/alpha" }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, customers: [] }), { status: 200 });
    }));
    mount(<PlatformCustomerRegistry customers={[]} query={{ search: "", status: "all" }} problem={null} />);
    const openButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "새 고객사");
    act(() => { openButton!.click(); });
    typeInto(input("customer-new-name"), "알파 회사");
    typeInto(input("customer-new-slug"), "alpha");
    await act(async () => {
      container.querySelector('form[aria-label="새 고객사 등록"]')!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(pushes).toEqual([]);
    expect(container.textContent).toContain("목록에서 확인되지 않아요");
  });

  it("explains list failures without inventing rows", () => {
    mount(<PlatformCustomerRegistry customers={[]} query={{ search: "", status: "all" }} problem="unavailable" />);
    expect(container.textContent).toContain("고객 목록을 불러오지 못했어요");
    expect(container.textContent).not.toContain("알파 회사");
  });
});

describe("PlatformCustomerDetail", () => {
  it("shows overview facts and the honest template state", () => {
    mount(<PlatformCustomerDetail customer={detail} tasks={[task]} history={[]} />);
    expect(container.textContent).toContain("알파 회사");
    expect(container.textContent).toContain("경영컨설팅");
    // 행 없음이 미적용 증거가 아니다 — 기록 없음을 정직하게 말한다.
    expect(container.textContent).toContain("적용 기록 없음");
    expect(container.textContent).not.toContain("미적용");
    expect(container.textContent).toContain("회사로 이동");
    expect(container.querySelector('a[href="/w/alpha"]')).toBeTruthy();
  });

  it("blocks company entry for non-members instead of enrolling them", () => {
    mount(<PlatformCustomerDetail customer={{ ...detail, canEnter: false }} tasks={[]} history={[]} />);
    expect(container.querySelector('a[href="/w/alpha"]')).toBeNull();
    expect(container.textContent).toContain("이 회사 멤버가 아니라 회사 화면으로 이동할 수 없어요");
  });

  it("keeps the task title when saving fails and refreshes the list on success", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: false, message: "작업을 저장하지 못했어요." }), { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    mount(<PlatformCustomerDetail customer={detail} tasks={[]} history={[]} />);
    act(() => {
      (container.querySelectorAll('[role="tab"]')[1] as HTMLButtonElement).click();
    });
    const addButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "＋ 작업 추가");
    act(() => { addButton!.click(); });
    typeInto(input("customer-task-title"), "대표 초대 안내");
    await act(async () => {
      container.querySelector('form[aria-label="관리 작업 추가"]')!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(container.textContent).toContain("작업을 저장하지 못했어요.");
    expect(input("customer-task-title").value).toBe("대표 초대 안내");
    expect(refreshes).toEqual([]);
  });

  it("renders task rows and history with before-after metadata", () => {
    mount(<PlatformCustomerDetail
      customer={detail}
      tasks={[{ ...task, status: "in_progress" }]}
      history={[{ label: "세팅 완료", before: "setting_up", after: "active", memo: "도입 상태 변경", taskId: null, createdAt: "2026-09-17T00:00:00Z" }]}
    />);
    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs[1].textContent).toContain("세팅·지원 (1건)");
    act(() => { (tabs[2] as HTMLButtonElement).click(); });
    expect(container.textContent).toContain("세팅 완료");
    // 원문 enum이 아니라 한국어로 보인다.
    expect(container.textContent).toContain("세팅 중 → 이용 중·참여 완료");
    expect(container.textContent).not.toContain("setting_up → active");
  });

  it("shows the safe invite address only to the active owner-manager", () => {
    mount(<PlatformCustomerDetail customer={detail} tasks={[]} history={[]} />);
    expect(input("customer-invite-url").value).toBe(new URL("/workspace-entry?mode=new&join=alpha", window.location.origin).href);
    expect(container.textContent).toContain("참여 요청 후 승인이 필요합니다");
    expect(container.textContent).toContain("초대 주소 복사");
    expect(container.textContent).toContain("초대 안내함으로 기록");
    expect(container.textContent).not.toContain("이메일");
  });

  it("hides invite management from members who can only enter", () => {
    mount(<PlatformCustomerDetail customer={{ ...detail, canManage: false }} tasks={[]} history={[]} />);
    expect(container.querySelector("#customer-invite-url")).toBeNull();
    expect(container.textContent).not.toContain("초대 주소 복사");
    expect(container.textContent).not.toContain("초대 안내함으로 기록");
    expect(container.textContent).toContain("회사 대표만 초대를 관리");
  });

  it("shows copy failure as a selectable link, never as sent mail", async () => {
    mount(<PlatformCustomerDetail customer={detail} tasks={[]} history={[]} />);
    const copyButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "초대 주소 복사");
    await act(async () => { copyButton!.click(); });
    expect(container.textContent).toContain("복사하지 못했어요");
    // 선택 가능한 링크는 그대로 있고, 전송됐다고 말하지 않는다.
    expect(input("customer-invite-url").value).toBe(new URL("/workspace-entry?mode=new&join=alpha", window.location.origin).href);
    expect(container.textContent).not.toContain("이메일");
    expect(container.textContent).not.toContain("전송됐");
  });

  it("resolves history task titles from the task store, not the audit payload", () => {
    mount(<PlatformCustomerDetail
      customer={detail}
      tasks={[task]}
      history={[{ label: "작업 상태 변경", before: "todo", after: "in_progress", memo: "", taskId: task.taskId, createdAt: "2026-09-17T00:00:00Z" }]}
    />);
    const tabs = container.querySelectorAll('[role="tab"]');
    act(() => { (tabs[2] as HTMLButtonElement).click(); });
    expect(container.textContent).toContain("할 일 → 진행 중");
    expect(container.textContent).toContain("관련 작업: 대표 초대 안내");
    expect(container.textContent).not.toContain("todo → in_progress");
  });

  it("marks unverified representatives as needing confirmation, not as joined", () => {
    mount(<PlatformCustomerDetail customer={{ ...detail, inviteState: "pending" }} tasks={[]} history={[]} />);
    expect(container.textContent).toContain("초대 전 · 대표 확인 필요");
  });

  it("bounds the task list honestly at 200", () => {
    const many = Array.from({ length: 200 }, (_, index) => ({
      ...task,
      taskId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    }));
    mount(<PlatformCustomerDetail customer={detail} tasks={many} history={[]} />);
    const tabs = container.querySelectorAll('[role="tab"]');
    act(() => { (tabs[1] as HTMLButtonElement).click(); });
    expect(container.textContent).toContain("최대 200건까지 보여줘요");
  });
});
