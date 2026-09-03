/* @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceEntry } from "./WorkspaceEntry";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

let root: Root | null = null;

beforeEach(() => {
  router.replace.mockReset();
  router.refresh.mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

async function renderBlocked(recheckStrategy?: "refresh" | "replace-routing-query") {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<WorkspaceEntry initialView="blocked" recheckStrategy={recheckStrategy} />));
  return host.querySelector<HTMLButtonElement>("button")!;
}

describe("WorkspaceEntry blocked-state recheck", () => {
  it("removes the routing-error query before asking the server to decide again", async () => {
    const button = await renderBlocked("replace-routing-query");

    await act(async () => button.click());

    expect(router.replace).toHaveBeenCalledOnce();
    expect(router.replace).toHaveBeenCalledWith("/workspace-entry");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("keeps refresh for transient loaders and server-state blocks", async () => {
    const button = await renderBlocked();

    await act(async () => button.click());

    expect(router.refresh).toHaveBeenCalledOnce();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
