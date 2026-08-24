// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/app/(app)/boards/new-lead-onboarding-actions", () => ({ saveNewLeadOnboardingAction: vi.fn() }));
import { NewLeadOnboarding } from "./NewLeadOnboarding";

let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("Issue #542 new lead onboarding", () => {
  it("shows the one-time guide only when the server says it is new", () => {
    const html = renderToStaticMarkup(<NewLeadOnboarding boardId="board-a" autoOpen />);
    expect(html).toContain("신규리드 시작하기");
    expect(html).toContain("리드컨택으로 넘기기");
  });

  it("keeps a separate manual help opener after completion", () => {
    const html = renderToStaticMarkup(<NewLeadOnboarding boardId="board-a" autoOpen={false} />);
    expect(html).toContain("신규리드 도움말");
    expect(html).not.toContain("신규리드 시작하기");
  });

  it("완료 뒤에도 수동 도움말을 실제로 다시 연다", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<NewLeadOnboarding boardId="board-a" autoOpen={false} />));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const opener = [...document.querySelectorAll("button")].find((button) => button.textContent === "신규리드 도움말")!;
    await act(async () => opener.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("신규리드 시작하기");
  });
});
