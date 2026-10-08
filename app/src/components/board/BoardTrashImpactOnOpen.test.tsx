// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BoardTrashImpactOnOpen } from "./BoardTrashImpactOnOpen";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const impact = { groups: 1, rows: 12, memos: 3, files: 2, views: 1, automations: 1, messaging: 2 };
let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(open: boolean) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <details open={open}>
        <summary>탭 설정</summary>
        <BoardTrashImpactOnOpen boardId="board-a" />
      </details>,
    );
  });
  return host.querySelector("details") as HTMLDetailsElement;
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
});

describe("Issue 857 · 탭 삭제 개수는 탭 설정을 열 때만 읽는다", () => {
  it("닫혀 있으면 읽지 않고, 열면 한 번 읽어 개수를 보여 준다(다시 열어도 다시 읽지 않음)", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: impact }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const details = mount(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(host!.textContent).toContain("탭 설정을 열면 지울 내용을 세어 보여 줘요.");

    act(() => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/boards/board-a/trash-impact", { cache: "no-store" });
    expect(host!.querySelector('[data-testid="board-trash-impact"]')?.textContent)
      .toBe("아이템 1 · 행 12 · 메모 3 · 첨부 파일 2 · 저장된 보기 1 · 자동화 규칙 1 · 문자 규칙 2");

    act(() => {
      details.open = false;
      details.dispatchEvent(new Event("toggle"));
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("못 읽으면 삭제를 막지 않고 알려 준다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "x" }), { status: 503 })));
    mount(true);
    await flush();
    expect(host!.textContent).toContain("지울 내용의 개수를 불러오지 못했어요. 삭제와 복구는 그대로 할 수 있어요.");
  });
});
