// @vitest-environment jsdom
import { act, cloneElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({ moveRowAction: vi.fn() }));
vi.mock("@/app/(app)/boards/actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/(app)/boards/actions")>()),
  moveRowAction: actionMocks.moveRowAction,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/boards/board-1",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { BoardWorkspace } from "./BoardWorkspace";
import { boardEntryFromRow } from "@/lib/consultation/boardView";

let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async () => {
  actionMocks.moveRowAction.mockReset();
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

const group = { id: "group-1", org_id: "org-1", board_id: "board-1", name: "담당자 1", color: null, sort_order: 0 };
const board = {
  id: "board-1",
  org_id: "org-1",
  name: "리드컨택 관리",
  icon: null,
  description: null,
  source: "core.default-tab/contact",
  is_system: false,
  sort_order: 0,
  row_order_version: 0,
};

function rowOf(id: string, title: string, sortOrder: number) {
  return {
    id,
    org_id: "org-1",
    board_id: "board-1",
    group_id: "group-1",
    title,
    assigned_to: "user-1",
    // DealLedgerButton 은 jsdom 대상이 아니라 deal 없이 둔다(행 영역 본문과 무관).
    deal_id: null,
    sort_order: sortOrder,
    created_at: "",
    updated_at: "",
    values: {},
  };
}

function entryOf(itemId: string, mode: string, confirmed: readonly boolean[], version = 2) {
  const keys = ["contract_sent", "signed_copy_sent", "counterparty_signature_confirmed", "deposit_confirmed"] as const;
  return boardEntryFromRow({
    item_id: itemId,
    deal_id: "deal-1",
    company_id: null,
    mode,
    version,
    meeting_at: null,
    checklist: Object.fromEntries(
      keys.map((key, index) => [
        key,
        confirmed[index]
          ? { confirmed: true, actor: "user-1", at: "2026-09-26T10:00:00+09:00" }
          : { confirmed: false, actor: null, at: null },
      ]),
    ),
    ready: false,
    missing: [],
    seal_approved: false,
    seal_detail: "",
    deal_stage_kind: "meeting",
  });
}

const rows = [rowOf("item-remote", "화상 상담 건", 0), rowOf("item-inperson", "방문 상담 건", 1)];
const consultationByItem = {
  "item-remote": entryOf("item-remote", "remote", [true, false, false, false]),
  "item-inperson": entryOf("item-inperson", "inperson", [true, true, false, false]),
};

function workspace(view: "all" | "remote" | "inperson") {
  return (
    <BoardWorkspace
      board={board as never}
      columns={[]}
      groups={[group as never]}
      rows={rows as never}
      columnOrder={{}}
      cellFlash={null}
      assigneeLabels={{ "user-1": "김담당" }}
      canEditItems
      canMoveRows
      consultationView={view}
      consultationByItem={consultationByItem}
    />
  );
}

describe("BoardWorkspace consultation stage view", () => {
  it("STEP2 탭에서는 비대면 행만 계약 단계 묶음으로 보인다", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(workspace("remote")));
    const text = host.textContent ?? "";
    expect(text).toContain("화상 상담 건");
    expect(text).not.toContain("방문 상담 건");
    // 계약 단계 보드: 1단계 묶음에 1건.
    expect(text).toContain("계약 확인 2단계 · 서명본 발송 (1)");
    expect(text).toContain("정보수집 (0)");
    // 표에서 진행이 읽힌다.
    expect(text).toContain("상담 진행");
    expect(text).toContain("계약 1/4");
    expect(text).toContain("다음: 서명본 발송");
    // 첫열 체크박스(일괄 선택)는 그대로 있다.
    const checkbox = host.querySelector('input[type="checkbox"][aria-label="화상 상담 건 선택"]');
    expect(checkbox).not.toBeNull();
  });

  it("STEP3 탭에서는 대면 행만 보이고 계약 단계가 다르다", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(workspace("inperson")));
    const text = host.textContent ?? "";
    expect(text).not.toContain("화상 상담 건");
    expect(text).toContain("방문 상담 건");
    expect(text).toContain("계약 확인 3단계 · 상대 서명 확인 (1)");
    expect(text).toContain("계약 2/4");
    expect(text).toContain("대면상담예약 (0)");
  });

  it("전체 보기(기존 /contract)는 물리 그룹 그대로 두 행을 보여준다", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(workspace("all")));
    const text = host.textContent ?? "";
    expect(text).toContain("화상 상담 건");
    expect(text).toContain("방문 상담 건");
    expect(text).toContain("담당자 1");
    expect(text).not.toContain("STEP2");
    expect(text).not.toContain("STEP3");
    // 전체 보기에서도 상담 진행 칸은 읽힌다.
    expect(text).toContain("상담 진행");
  });

  it("단계 보기에서는 행 드래그 진입점이 없다", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(workspace("remote")));
    expect(host.querySelector('[aria-label="화상 상담 건 위로 이동"]')).toBeNull();
  });
  it("groups unstarted rows by actual phase and keeps only contract rows in four-step groups", async () => {
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    const map = { ...consultationByItem, "item-remote": { ...entryOf("item-remote","remote",[false,false,false,false]), phase: "consulting" as const } };
    await act(async () => root!.render(cloneElement(workspace("remote"), { consultationByItem: map })));
    expect(host.textContent).toContain("상담중 (1)");
    expect(host.textContent).toContain("계약 확인 1단계 · 계약서 송부 (0)");
    expect(host.textContent).not.toContain("계약 0/4");
  });

});
