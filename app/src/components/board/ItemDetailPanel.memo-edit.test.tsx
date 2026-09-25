// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemWithValues } from "@/lib/boards/types";
import type { ItemDetailSnapshot } from "@/app/(app)/boards/item-detail-actions";

const actions = vi.hoisted(() => ({ edit: vi.fn(), load: vi.fn(), upload: vi.fn() }));
vi.mock("@/app/(app)/boards/item-detail-memo-actions", () => ({ updateItemDetailEventAction: actions.edit }));
vi.mock("@/app/(app)/boards/item-detail-actions", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  loadItemDetailAction: actions.load,
  uploadItemDetailFileAction: actions.upload,
}));

import { ItemDetailPanel } from "./ItemDetailPanel";

const row: ItemWithValues = {
  id: "item-a", org_id: "org-a", board_id: "board-a", group_id: "group-a",
  title: "편집 충돌 검증", assigned_to: "user-a", deal_id: null, sort_order: 0,
  created_at: "2026-09-25T00:00:00Z", updated_at: "2026-09-25T00:00:00Z", values: {},
};
const snapshot = (body: string, count: number): ItemDetailSnapshot => ({
  ok: true, links: [], files: [], members: [{ id: "user-a", name: "작성자" }],
  viewerId: "user-a", viewerRole: "member", assignedTo: "user-a",
  events: [{ id: "event-a", kind: "memo", body, actor_id: "user-a",
    created_at: row.created_at, edit_count: count }],
});
const failure: ItemDetailSnapshot = {
  ok: false, message: "다른 저장이 먼저 됐습니다. 새로고침으로 최신을 확인해 주세요.",
  events: [], links: [], files: [], members: [],
};
let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.clearAllMocks();
  actions.edit.mockResolvedValue(failure);
  actions.load.mockResolvedValue(snapshot("다른 사람이 저장한 최신 본문", 1));
  actions.upload.mockResolvedValue(snapshot("다른 사람이 저장한 최신 본문", 1));
  window.history.replaceState(null, "", "/#item-item-a");
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  window.history.replaceState(null, "", "/");
});

async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.getAttribute("aria-label") === label || candidate.textContent === label);
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
async function beginDraft() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(
    <ItemDetailPanel boardId="board-a" row={row} columns={[]} boardLayout={[]} layout={[]}
      inherited canEditItems canManageColumns={false} defaultOpen initialDetail={snapshot("편집 시작 본문", 0)} />,
  ));
  await click("메모 기록 고치기");
  const textarea = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="기록 고치기"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "보존할 내 초안");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return textarea;
}

describe("메모 충돌 복구의 초안과 편집 기준", () => {
  it("새로고침은 초안·기준·요청 ID를 유지하고 명시적 계속만 최신 기준으로 바꾼다", async () => {
    const textarea = await beginDraft();
    await click("고친 기록 저장");
    const first = actions.edit.mock.calls[0][0];
    expect(first).toMatchObject({ body: "보존할 내 초안", baseBody: "편집 시작 본문", expectedEditCount: 0 });
    await click("최신 기록 다시 불러오기");
    expect(textarea.value).toBe("보존할 내 초안");
    expect(document.body.textContent).toContain("다른 사람이 저장한 최신 본문");
    await click("고친 기록 저장");
    expect(actions.edit.mock.calls[1][0]).toEqual(first);
    await click("최신 내용을 확인하고 편집 계속");
    expect(textarea.value).toBe("보존할 내 초안");
    await click("고친 기록 저장");
    expect(actions.edit.mock.calls[2][0]).toMatchObject({
      body: "보존할 내 초안", baseBody: "다른 사람이 저장한 최신 본문", expectedEditCount: 1,
    });
    expect(actions.edit.mock.calls[2][0].requestId).not.toBe(first.requestId);
  });

  it("파일 첨부의 상세 재조회도 작성 중 초안의 기준 버전을 바꾸지 않는다", async () => {
    const textarea = await beginDraft();
    const input = document.querySelector<HTMLInputElement>('#item-a-evidence-files')!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["fixture"], "fixture.txt")] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(actions.upload).toHaveBeenCalledOnce();
    expect(textarea.value).toBe("보존할 내 초안");
    expect(document.body.textContent).toContain("다른 사람이 저장한 최신 본문");
    await click("고친 기록 저장");
    expect(actions.edit.mock.calls[0][0]).toMatchObject({
      body: "보존할 내 초안", baseBody: "편집 시작 본문", expectedEditCount: 0,
    });
  });
});
