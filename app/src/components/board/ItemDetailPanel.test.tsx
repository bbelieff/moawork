// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lineageActions = vi.hoisted(() => ({
  read: vi.fn(),
  reassign: vi.fn(),
  follower: vi.fn(),
  schedule: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("@/app/(app)/boards/assignment-lineage-actions", () => ({
  readAssignmentLineageAction: lineageActions.read,
  reassignAssignmentAction: lineageActions.reassign,
  setAssignmentFollowerAction: lineageActions.follower,
  scheduleAssignmentHandoffAction: lineageActions.schedule,
  cancelAssignmentHandoffAction: lineageActions.cancel,
}));

import { ItemDetailPanel } from "./ItemDetailPanel";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";

const columns: BoardColumn[] = [
  {
    id: "col-company",
    org_id: "org-a",
    board_id: "board-a",
    key: "company",
    label: "회사명",
    type: "text",
    source: "in",
    rightPinned: false,
    options_jsonb: null,
    sort_order: 0,
    width: null,
  },
];
const row: ItemWithValues = {
  id: "item-a",
  org_id: "org-a",
  board_id: "board-a",
  group_id: "group-a",
  title: "대한정밀",
  assigned_to: "user-a",
  deal_id: null,
  sort_order: 0,
  created_at: "2026-08-16T00:00:00Z",
  updated_at: "2026-08-16T00:00:00Z",
  values: { company: "대한정밀", hidden_legacy: "보존값" },
};

type CloseChannel = "Escape" | "backdrop" | "close button";

let mountedRoot: Root | null = null;

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => mountedRoot?.unmount());
    mountedRoot = null;
  }
  document.body.replaceChildren();
  window.history.replaceState(null, "", window.location.pathname);
});

beforeEach(() => {
  lineageActions.read.mockReset().mockResolvedValue({
    ok: true,
    data: {
      orgId: "org-a",
      boardId: "board-a",
      dealId: "deal-a",
      itemId: "item-a",
      baselineAssigneeId: "user-a",
      currentAssigneeId: "user-a",
      version: 2,
      transitions: [],
      followers: [],
      pendingHandoff: null,
    },
  });
  lineageActions.reassign.mockReset().mockResolvedValue({ ok: true, data: { version: 3 } });
  lineageActions.follower.mockReset().mockResolvedValue({ ok: true, data: { version: 2 } });
  lineageActions.schedule.mockReset().mockResolvedValue({ ok: true, data: { version: 2, handoffId: "handoff-a" } });
  lineageActions.cancel.mockReset().mockResolvedValue({ ok: true, data: { version: 2 } });
});

async function renderInteractivePanel() {
  const container = document.createElement("div");
  document.body.append(container);
  mountedRoot = createRoot(container);

  await act(async () => {
    mountedRoot?.render(
      <ItemDetailPanel
        boardId="board-a"
        row={row}
        columns={columns}
        boardLayout={[{ key: "company", source: "column" }]}
        layout={[{ key: "company", source: "column" }]}
        inherited
        canEditItems
        canManageColumns
      />,
    );
  });

  const opener = document.querySelector<HTMLButtonElement>(
    '[aria-label="대한정밀 상세 열기"]',
  );
  expect(opener).not.toBeNull();
  await act(async () => opener?.click());

  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  const closeButton = document.querySelector<HTMLButtonElement>(
    '[aria-label="상세 닫기"]',
  );
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(dialog).not.toBeNull();
  expect(closeButton).not.toBeNull();
  expect(document.activeElement).toBe(closeButton);

  return { opener: opener!, dialog: dialog!, closeButton: closeButton! };
}

async function closePanel(
  channel: CloseChannel,
  dialog: HTMLElement,
  closeButton: HTMLButtonElement,
) {
  await act(async () => {
    if (channel === "Escape") {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    } else if (channel === "backdrop") {
      dialog.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    } else {
      closeButton.click();
    }
  });
}

function renderStaticPanel(element: ReactNode) {
  const documentDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  Reflect.deleteProperty(globalThis, "document");
  try {
    return renderToStaticMarkup(element);
  } finally {
    if (documentDescriptor)
      Object.defineProperty(globalThis, "document", documentDescriptor);
  }
}

const sourcePath = resolve(
  process.cwd(),
  process.cwd().endsWith("app")
    ? "src/components/board/ItemDetailPanel.tsx"
    : "app/src/components/board/ItemDetailPanel.tsx",
);
const stylePath = resolve(
  process.cwd(),
  process.cwd().endsWith("app")
    ? "src/components/board/item-detail-panel.module.css"
    : "app/src/components/board/item-detail-panel.module.css",
);

describe("BBE-565 목업 기준 실제 상세 패널", () => {
  it("상단 헤더·좌측 회사정보·우측 알림/히스토리·하단 작성기 구조를 렌더한다", () => {
    const html = renderStaticPanel(
      <ItemDetailPanel
        boardId="board-a"
        row={row}
        columns={columns}
        boardLayout={[{ key: "company", source: "column" }]}
        layout={[{ key: "company", source: "column" }]}
        inherited
        canEditItems
        canManageColumns
        defaultOpen
        boardName="신규리드 관리"
        groupName="💡 신규고객"
      />,
    );
    expect(html).toContain("신규리드 관리 · 💡 신규고객");
    expect(html).toContain("이 화면에 배치되지 않은 항목 1개");
    expect(html).toContain("순서 규칙");
    expect(html).toContain("관리자 · 상세 배치 편집");
    expect(html).not.toContain("리드컨택으로 넘기기");
    expect(html).toContain("hidden_legacy");
    expect(html).toContain("배치에 추가");
    for (const anchor of [
      "data-item-detail-surface",
      "data-item-detail-header",
      "data-item-detail-info-rail",
      "data-item-detail-watchers",
      "data-item-detail-history",
      "data-item-detail-composer",
    ]) expect(html).toContain(anchor);
    const css = readFileSync(stylePath, "utf8");
    expect(css).toContain("width: calc(100% - 6rem)");
    expect(css).toContain("grid-template-columns: minmax(22rem, 25rem) minmax(0, 1fr)");
    expect(css).toContain("grid-template-rows: 3.625rem minmax(0, 1fr)");
    expect(css).toContain("min-height: 2.15rem");
  });

  it("상세 전용 필드는 표 승격 동작을 제공한다", () => {
    const html = renderStaticPanel(
      <ItemDetailPanel
        boardId="board-a"
        row={{ ...row, values: { detail_note: "메모" } }}
        columns={columns}
        boardLayout={[]}
        layout={[
          {
            key: "detail_note",
            source: "detail",
            label: "상세 메모",
            type: "text",
          },
        ]}
        inherited={false}
        canEditItems
        canManageColumns
        defaultOpen
      />,
    );
    expect(html).toContain("상세");
    expect(html).toContain("상세 메모을 표에도 보이기");
    expect(html).toContain("+ 상세 전용 필드 추가");
    expect(html).toContain('aria-label="상세 전용 필드 이름"');
    expect(html).toContain("기본으로 되돌리기");
  });

  it("상세 연락처는 편집 입력에서도 010-0000-0000 표기로 시작한다", () => {
    const phoneColumn: BoardColumn = { ...columns[0], id: "col-phone", key: "phone", label: "연락처", type: "phone" };
    const html = renderStaticPanel(
      <ItemDetailPanel
        boardId="board-a"
        row={{ ...row, deal_id: "deal-a", values: { phone: "+82 10 3026 6007" } }}
        columns={[phoneColumn]}
        boardLayout={[{ key: "phone", source: "column" }]}
        layout={[{ key: "phone", source: "column" }]}
        inherited
        canEditItems
        canManageColumns={false}
        canonicalNewLead
        defaultOpen
      />,
    );
    expect(html).toContain('type="tel"');
    expect(html).toContain('value="010-3026-6007"');
  });

  it("정규화 검토대상 연락처를 빈 값으로 숨기지 않고 확인 필요로 표시한다", () => {
    const phoneColumn: BoardColumn = { ...columns[0], id: "col-phone", key: "phone", label: "연락처", type: "phone" };
    const html = renderStaticPanel(
      <ItemDetailPanel
        boardId="board-a"
        row={{ ...row, deal_id: "deal-a", values: { phone: null }, value_statuses: { phone: "needs_review" } }}
        columns={[phoneColumn]}
        boardLayout={[{ key: "phone", source: "column" }]}
        layout={[{ key: "phone", source: "column" }]}
        inherited
        canEditItems
        canManageColumns={false}
        canonicalNewLead
        defaultOpen
      />,
    );
    expect(html).toContain('value="확인 필요"');
  });

  it("상속된 기본 필드가 있으면 빈 배치 안내 없이 편집 입력을 보여준다", () => {
    const html = renderStaticPanel(
      <ItemDetailPanel
        boardId="board-a"
        row={{ ...row, values: {} }}
        columns={columns}
        boardLayout={[
          { key: "company", source: "column", label: "회사명", type: "text" },
        ]}
        layout={[
          { key: "company", source: "column", label: "회사명", type: "text" },
        ]}
        inherited
        canEditItems
        canManageColumns={false}
        defaultOpen
      />,
    );
    expect(html).toContain('id="item-a-company"');
    expect(html).toContain("✓ 자동 저장됨");
    expect(html).not.toContain("배치된 상세 필드가 없습니다");
    expect(html).not.toContain("이 화면에 배치되지 않은 항목");
    expect(html).not.toContain("관리자 · 상세 배치 편집");
  });

  it("신규리드 담당자는 canonical lineage로, 연관담당은 기존 복수 선택으로 저장한다", () => {
    const memberColumns: BoardColumn[] = [
      {
        ...columns[0],
        id: "col-owner",
        key: "owner",
        label: "담당자",
        type: "person",
      },
      {
        ...columns[0],
        id: "col-collaborators",
        key: "collaborators",
        label: "연관담당",
        type: "people",
        sort_order: 1,
      },
    ];
    const html = renderStaticPanel(
      <ItemDetailPanel
        boardId="board-a"
        row={{
          ...row,
          deal_id: "deal-a",
          values: { owner: "user-a", collaborators: ["user-a", "user-b"] },
        }}
        columns={memberColumns}
        boardLayout={[
          { key: "owner", source: "column" },
          { key: "collaborators", source: "column" },
        ]}
        layout={[
          { key: "owner", source: "column" },
          { key: "collaborators", source: "column" },
        ]}
        inherited
        canEditItems
        canManageColumns={false}
        canonicalNewLead
        memberOptions={[
          { id: "user-a", label: "이대표" },
          { id: "user-b", label: "카위" },
        ]}
        defaultOpen
      />,
    );
    expect(html).not.toContain('name="field" value="owner"');
    expect(html).toContain('name="field" value="collaborators"');
    expect(html).toContain("이대표");
    expect(html).toContain("연관담당");
    expect(html).toContain("바꾸기");
    expect(html.match(/aria-haspopup="dialog"/g)?.length).toBe(2);
    expect(html.match(/id="detail-field-collaborators"/g) ?? []).toHaveLength(0);
  });

  it("상세 drawer 담당자 변경은 legacy owner form 없이 canonical reassign을 호출한다", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("50000000-0000-4000-8000-000000000010");
    window.history.replaceState(null, "", "/#item-item-a");
    const host = document.createElement("div");
    document.body.append(host);
    mountedRoot = createRoot(host);
    const ownerColumn: BoardColumn = { ...columns[0], id: "col-owner", key: "owner", label: "담당자", type: "person" };
    await act(async () => mountedRoot?.render(
      <ItemDetailPanel
        boardId="board-a"
        row={{ ...row, deal_id: "deal-a", values: { owner: "user-a" } }}
        columns={[ownerColumn]}
        boardLayout={[{ key: "owner", source: "column" }]}
        layout={[{ key: "owner", source: "column" }]}
        inherited
        canEditItems
        canManageColumns={false}
        canonicalNewLead
        memberOptions={[{ id: "user-a", label: "이대표" }, { id: "user-b", label: "카위" }]}
        defaultOpen
        initialDetail={{ ok: true, events: [], links: [], files: [], members: [] }}
      />,
    ));
    const ownerTrigger = [...document.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="dialog"]')]
      .find((button) => button.textContent?.includes("이대표"))!;
    expect(ownerTrigger).not.toBeUndefined();
    expect(document.querySelector('input[name="field"][value="owner"]')).toBeNull();
    await act(async () => ownerTrigger.click());
    await act(async () => { await Promise.resolve(); });
    const lineageDialog = document.querySelector<HTMLElement>('[aria-label="담당자 흐름"]')!;
    await act(async () => [...lineageDialog.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "담당자 변경")?.click());
    const picker = document.querySelector<HTMLElement>('[aria-label="현재 담당자 선택"]')!;
    const target = [...picker.querySelectorAll<HTMLLabelElement>("label")]
      .find((label) => label.textContent?.includes("카위"))!;
    await act(async () => target.querySelector<HTMLInputElement>("input")?.click());
    await act(async () => [...picker.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "선택 저장")?.click());
    await act(async () => {
      await Promise.resolve();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(lineageActions.reassign).toHaveBeenCalledWith({
      boardId: "board-a",
      dealId: "deal-a",
      itemId: "item-a",
      assignedTo: "user-b",
      expectedAssignedTo: "user-a",
      expectedVersion: 2,
      requestId: "50000000-0000-4000-8000-000000000010",
    });
  });

  it("상세 drawer는 전역 portal과 공용 dialog 레이어를 사용한다", () => {
    const source = readFileSync(sourcePath, "utf8");
    expect(source).toContain("createPortal(children, document.body)");
    expect(source).toContain("mw-layer-dialog ${styles.backdrop}");
    expect(source).toContain("data-item-detail-backdrop");
    expect(source).not.toContain('className="fixed inset-0 z-50');
  });

  it("Issue 524의 업체 정보·첨부·내보내기·알림 대상·불변 히스토리 작성기를 한 drawer에 둔다", () => {
    const html = renderStaticPanel(
      <ItemDetailPanel
        boardId="board-a"
        row={row}
        columns={columns}
        boardLayout={[{ key: "company", source: "column" }]}
        layout={[{ key: "company", source: "column" }]}
        inherited
        canEditItems
        canManageColumns
        defaultOpen
      />,
    );
    for (const copy of [
      "회사 정보",
      "클라우드 폴더",
      "TXT 추출",
      "CSV",
      "연관담당",
      "히스토리",
      "통화 기록",
      "삭제 불가",
    ]) {
      expect(html).toContain(copy);
    }
    expect(html).toContain("✓ 자동 저장됨");
    expect(html).toContain('aria-label="메모 또는 통화 기록"');
    expect(html).toContain("링크 복사");
    expect(html).toContain("← 이전");
    const source = readFileSync(sourcePath, "utf8");
    expect(source).toContain("setTimeout(() => save(valueRef.current), 700)");
    expect(source).toContain(
      'window.addEventListener("hashchange", syncFromHash)',
    );
    expect(source).toContain("window.history.replaceState");
  });

  it("클라우드 폴더 1개를 중심에 두고 이전 링크·첨부는 읽기 전용으로 보존한다", () => {
    const html = renderStaticPanel(
      <ItemDetailPanel
        boardId="board-a"
        row={row}
        columns={columns}
        boardLayout={[{ key: "company", source: "column" }]}
        layout={[{ key: "company", source: "column" }]}
        inherited
        canEditItems
        canManageColumns
        defaultOpen
        initialDetail={{
          ok: true,
          events: [],
          cloudFolder: {
            id: "folder-a",
            url: "https://drive.google.com/drive/folders/folder-a",
            provider: "google_drive",
            providerLabel: "Google Drive",
          },
          links: [
            {
              id: "legacy-link",
              label: "예전 견적 자료",
              url: "https://legacy.example.com/folders/quote",
              created_at: "2026-08-01T00:00:00Z",
            },
          ],
          files: [
            {
              id: "legacy-file",
              name: "견적서.pdf",
              mime_type: "application/pdf",
              size_bytes: 1024,
              created_at: "2026-08-01T00:00:00Z",
              downloadUrl: "https://storage.example.com/file",
            },
          ],
          members: [],
        }}
      />,
    );
    expect(html).toContain("Google Drive");
    expect(html).toContain("폴더 열기");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("이전 첨부·링크 2개");
    expect(html).toContain("예전 견적 자료");
    expect(html).toContain("견적서.pdf");
    expect(html).not.toContain("파일 첨부");
    expect(html).not.toContain("링크 이름");
  });

  it.each<CloseChannel>(["Escape", "backdrop", "close button"])(
    "%s 닫기는 실제 dialog를 제거하고 같은 opener로 포커스를 돌려준다",
    async (channel) => {
      const { opener, dialog, closeButton } = await renderInteractivePanel();
      const panel = dialog.querySelector<HTMLElement>("section");
      expect(panel).not.toBeNull();

      await act(async () => {
        panel?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      });
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
      expect(document.activeElement).toBe(closeButton);

      await closePanel(channel, dialog, closeButton);
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);
      expect(document.activeElement).toBe(opener);
    },
  );

  it("뒤 행에서 이전 회사로 전환해도 새 상세 닫기 버튼에 포커스를 유지하고 Tab을 가둔다", async () => {
    const container = document.createElement("div");
    const outside = document.createElement("button");
    outside.textContent = "배경 버튼";
    document.body.append(container, outside);
    mountedRoot = createRoot(container);
    const previousRow = row;
    const nextRow = { ...row, id: "item-b", title: "미래상사" };

    await act(async () => {
      mountedRoot?.render(
        <>
          <ItemDetailPanel
            boardId="board-a"
            row={previousRow}
            columns={columns}
            boardLayout={[{ key: "company", source: "column" }]}
            layout={[{ key: "company", source: "column" }]}
            inherited
            canEditItems
            canManageColumns
            nextItem={{ id: nextRow.id, title: nextRow.title }}
          />
          <ItemDetailPanel
            boardId="board-a"
            row={nextRow}
            columns={columns}
            boardLayout={[{ key: "company", source: "column" }]}
            layout={[{ key: "company", source: "column" }]}
            inherited
            canEditItems
            canManageColumns
            previousItem={{ id: previousRow.id, title: previousRow.title }}
          />
        </>,
      );
    });

    const nextTrigger = document.querySelector<HTMLButtonElement>(
      '[data-item-detail-trigger="item-b"]',
    );
    await act(async () => nextTrigger?.click());
    const previousButton = document.querySelector<HTMLButtonElement>(
      '[aria-label="이전 회사 대한정밀 열기"]',
    );
    expect(previousButton).not.toBeNull();

    await act(async () => {
      previousButton?.click();
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
    });

    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe(
      "대한정밀",
    );
    const activeClose = document.querySelector<HTMLButtonElement>(
      '[role="dialog"] [aria-label="상세 닫기"]',
    );
    expect(document.activeElement).toBe(activeClose);

    outside.focus();
    expect(document.activeElement).toBe(outside);
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(activeClose);
  });

  it("Escape·pointer·ref가 실행형 helper에 실제로 결속돼 있다", () => {
    const source = readFileSync(sourcePath, "utf8");
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain(
      'window.addEventListener("keydown", closeOnEscape)',
    );
    expect(source).toContain(
      'window.removeEventListener("keydown", closeOnEscape)',
    );
    expect(source).toContain(
      "isDetailPanelBackdrop(event.target, event.currentTarget)",
    );
    expect(source).toContain("focusDetailPanelElement(closeButtonRef.current)");
    expect(source).toContain("ref={triggerRef}");
    expect(source).toContain(
      "restoreDetailPanelOpener(open, wasOpenRef.current, triggerRef.current)",
    );
  });
});
