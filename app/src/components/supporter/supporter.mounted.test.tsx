// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupporterDock } from "./SupporterDock";
import { SupporterProvider } from "./SupporterProvider";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const UNAVAILABLE = { status: { kind: "unavailable", reason: "not_configured" } };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function modeOf(input: unknown): string | null {
  return new URL(String(input), "http://localhost").searchParams.get("mode");
}

const mounted: { container: HTMLElement; root: Root }[] = [];

async function mount(ui: ReactNode): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ container, root });
  await act(async () => {
    root.render(ui);
  });
  await act(async () => {});
  return container;
}

function rerenderOf(container: HTMLElement): Root {
  const entry = mounted.find((item) => item.container === container);
  if (!entry) throw new Error("unknown container");
  return entry.root;
}

afterEach(async () => {
  while (mounted.length > 0) {
    const entry = mounted.pop();
    if (entry) {
      await act(async () => {
        entry.root.unmount();
      });
      entry.container.remove();
    }
  }
  vi.unstubAllGlobals();
});

function toggleOf(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector('[aria-label="운영서포터 전환"]');
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === text,
  );
  if (!found) throw new Error(`button not found: ${text}`);
  return found as HTMLButtonElement;
}

describe("SupporterProvider mounted behavior", () => {
  it("proactively verifies operations permission and exposes the toggle from user mode", async () => {
    const fetchMock = vi.fn(async (input: unknown) => { void input; return jsonResponse(UNAVAILABLE); });
    vi.stubGlobal("fetch", fetchMock);

    const container = await mount(
      <SupporterProvider contextKey="org-1" allowOperations initialOpen>
        <SupporterDock />
      </SupporterProvider>,
    );

    // 초기 모드가 user 여도 operations 판정이 미리 나간다 — 교착 금지.
    const modes = fetchMock.mock.calls.map(([input]) => modeOf(input));
    expect(modes).toContain("user");
    expect(modes).toContain("operations");

    const toggle = toggleOf(container);
    expect(toggle).not.toBeNull();
    await act(async () => {
      toggle?.click();
    });
    expect(container.querySelector('[aria-label="운영서포터"]')).not.toBeNull();
    expect(toggleOf(container)?.getAttribute("aria-checked")).toBe("true");
    expect(container.textContent).toContain("AI 연결 준비 중");
  });

  it("never trusts an HTML 200 or a malformed body as a grant", async () => {
    const fetchMock = vi.fn(async (input: unknown) =>
      modeOf(input) === "operations"
        ? new Response("<html>login</html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          })
        : jsonResponse({ status: { kind: "unavailable" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const container = await mount(
      <SupporterProvider contextKey="org-1" allowOperations initialOpen>
        <SupporterDock />
      </SupporterProvider>,
    );

    expect(toggleOf(container)).toBeNull();
    expect(container.querySelector('[aria-label="모아서포터"]')).not.toBeNull();
    expect(container.textContent).toContain("연결 상태를 확인할 수 없어요");
  });

  it("hides the operations surface on fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "operations_forbidden" }, 403)),
    );

    const container = await mount(
      <SupporterProvider contextKey="org-1" allowOperations initialOpen>
        <SupporterDock />
      </SupporterProvider>,
    );

    expect(toggleOf(container)).toBeNull();
    expect(container.textContent).toContain("연결 상태를 확인할 수 없어요");
  });

  it("shows an explicit error status with the draft preserved and no provider bubble", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(UNAVAILABLE)));

    const container = await mount(
      <SupporterProvider contextKey="org-1" allowOperations={false} initialOpen>
        <SupporterDock />
      </SupporterProvider>,
    );

    await act(async () => {
      buttonByText(container, "사용법 알려줘").click();
    });

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("AI 연결 준비 중");
    expect(status?.textContent).toContain("실행되지 않았어요");
    // 가짜 서포터 답변 말풍선은 생기지 않는다.
    expect(container.textContent).not.toContain("정적 도움말");
    const input = container.querySelector(
      'input[aria-label="서포터 입력"]',
    ) as HTMLInputElement | null;
    expect(input?.value).toBe("사용법 알려줘");
    // 반복 제출해도 안내 상태는 하나로 유지된다.
    await act(async () => {
      buttonByText(container, "자동화 연결 안내").click();
    });
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(container.textContent).not.toContain("정적 도움말");
  });

  it("derives safe user mode immediately when allowOperations drops", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(UNAVAILABLE)));

    const shell = (allowOperations: boolean) => (
      <SupporterProvider
        contextKey="org-1"
        allowOperations={allowOperations}
        initialOpen
      >
        <SupporterDock />
      </SupporterProvider>
    );
    const container = await mount(shell(true));
    const toggle = toggleOf(container);
    expect(toggle).not.toBeNull();
    await act(async () => {
      toggle?.click();
    });
    expect(container.querySelector('[aria-label="운영서포터"]')).not.toBeNull();
    await act(async () => {
      buttonByText(container, "연결 상태 확인해줘").click();
    });
    expect(container.textContent).toContain("연결 상태 확인해줘");

    await act(async () => {
      rerenderOf(container).render(shell(false));
    });

    expect(container.querySelector('[aria-label="모아서포터"]')).not.toBeNull();
    expect(toggleOf(container)).toBeNull();
    // 이전 운영 기록이 번쩍이지 않는다.
    expect(container.textContent).not.toContain("연결 상태 확인해줘");
  });

  it("aborts in-flight status checks on unmount", async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init?: { signal?: AbortSignal }) => {
        if (init?.signal) signals.push(init.signal);
        return jsonResponse(UNAVAILABLE);
      }),
    );

    await mount(
      <SupporterProvider contextKey="org-1" allowOperations initialOpen>
        <SupporterDock />
      </SupporterProvider>,
    );

    expect(signals.length).toBeGreaterThan(0);
    // afterEach 언마운트가 abort 를 일으킨다 — 다음 테스트 격리를 위해 여기서 닫는다.
    const entry = mounted.pop();
    if (entry) {
      await act(async () => {
        entry.root.unmount();
      });
      entry.container.remove();
    }
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});
