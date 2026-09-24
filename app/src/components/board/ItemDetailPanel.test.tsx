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

import { detailValueText, ItemDetailPanel } from "./ItemDetailPanel";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import { emptyOtherInfoValue, updateOtherInfoEntry } from "@/lib/boards/structured-field";

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

it("renders other_info through the structured detail consumer and exports unchecked text losslessly", async () => {
  let value = updateOtherInfoEntry(emptyOtherInfoValue(), "certifications", {
    checked: true,
    text: "벤처기업",
  });
  value = updateOtherInfoEntry(value, "otherBusinesses", {
    checked: false,
    text: "보존할 메모",
  });
  const infoColumn: BoardColumn = {
    ...columns[0],
    id: "col-other-info",
    key: "custom_other_info",
    label: "기타정보",
    type: "other_info",
  };
  const infoRow: ItemWithValues = {
    ...row,
    values: { custom_other_info: value, export_status: "수출 예정" },
  };
  const container = document.createElement("div");
  document.body.append(container);
  mountedRoot = createRoot(container);
  await act(async () => mountedRoot?.render(
    <ItemDetailPanel
      boardId="board-a"
      row={infoRow}
      columns={[infoColumn]}
      boardLayout={[{ key: "custom_other_info", source: "column", type: "other_info", label: "기타정보" }]}
      layout={[{ key: "custom_other_info", source: "column", type: "other_info", label: "기타정보" }]}
      inherited
      canEditItems
      canManageColumns
    />,
  ));
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="대한정밀 상세 열기"]')?.click());
  const otherInfoTrigger = document.body.querySelector<HTMLButtonElement>('[aria-label="기타정보 1건: 보유인증 편집"]')!;
  expect(otherInfoTrigger).not.toBeNull();
  expect(document.body.querySelector('#item-a-custom_other_info')).toBeNull();
  await act(async () => otherInfoTrigger.click());
  expect(document.body.querySelector('form input[name="fieldKey"][value="custom_other_info"]')).not.toBeNull();
  const exported = detailValueText("other_info", value, infoRow.values, null);
  expect(exported).toContain("1건");
  expect(exported).toContain("보유인증=체크(벤처기업)");
  expect(exported).toContain("다른사업자=미체크(보존할 메모)");
  expect(exported).not.toContain("[object Object]");
  expect(exported).not.toContain("수출 예정");
});

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
    expect(html).toContain("상세 메모를 표에도 보이기");
    expect(html).toContain("+ 상세 전용 필드 추가");
    expect(html).toContain('aria-label="상세 전용 필드 이름"');
    expect(html).toContain("기본으로 되돌리기");
  });

  /*
   * #657 — 표로 올린 것을 다시 내리는 길.
   *
   * 전에는 올리는 버튼이 source === "detail" 일 때만 그려져서, 한 번 누르면 버튼 자체가
   * 사라졌다. 총괄의 말: 「표로 보이게 하는 버튼은 있는데 이게 되돌릴수는 없게 되어있음」.
   */
  it("표로 올라간 상세 필드에는 「상세만」으로 되돌리는 버튼이 붙는다", () => {
    const html = renderStaticPanel(
      <ItemDetailPanel
        boardId="board-a"
        row={{ ...row, values: { detail_cert: "ㄴㄴ" } }}
        columns={columns}
        boardLayout={[]}
        layout={[{ key: "detail_cert", source: "column", label: "법인공동인증서", type: "text" }]}
        inherited={false}
        canEditItems
        canManageColumns
        defaultOpen
      />,
    );
    expect(html).toContain("법인공동인증서를 표에서 내리기");
    // 이미 표에 있으므로 «올리기» 는 없어야 한다 — 두 버튼이 같이 서면 무엇이 참인지 모른다.
    expect(html).not.toContain("법인공동인증서를 표에도 보이기");
  });

  it("★ 원래부터 표 컬럼이던 칸에는 되돌리기 버튼이 안 붙는다 — 구조 축소가 아니다", () => {
    const html = renderStaticPanel(
      <ItemDetailPanel
        boardId="board-a"
        row={{ ...row, values: { phone: "010-0000-0000" } }}
        columns={columns}
        boardLayout={[]}
        layout={[{ key: "phone", source: "column", label: "연락처", type: "phone" }]}
        inherited={false}
        canEditItems
        canManageColumns
        defaultOpen
      />,
    );
    expect(html).not.toContain("연락처를 표에서 내리기");
  });

  /*
   * #717 — 사용자가 지은 이름에 조사를 «손으로» 붙이면 절반이 틀린다.
   *
   * ★ 이 시험이 생기기 전까지, 바로 위 시험들이 틀린 조사를 «정답으로» 고정하고 있었다
   *   («상세 메모을» · «법인공동인증서을»). 시험이 버그를 지키고 있었던 것이다.
   *
   * ★★ 그리고 이건 title·aria-label 이다 — 화면 낭독기를 쓰는 사람이 그대로 «듣는다».
   *
   * 받침 «있는» 이름과 «없는» 이름을 같은 시험에서 돌린다. 한쪽만 재면
   *   `${label}을` 로 되돌려도 통과하는 시험이 된다 (받침 있는 쪽은 원래 맞으니까).
   */
  it.each([
    ["받침 있음", "영업관리팀", "영업관리팀을"],
    ["받침 없음", "담당자", "담당자를"],
    ["받침 없음 · 모음", "메모", "메모를"],
    ["받침 ㄹ", "이메일", "이메일을"],
  ])("★ #717 %s — 「%s」에는 「%s」가 붙는다", (_label, name, expected) => {
    const html = renderStaticPanel(
      <ItemDetailPanel
        boardId="board-a"
        row={{ ...row, values: { detail_note: "값" } }}
        columns={columns}
        boardLayout={[]}
        layout={[{ key: "detail_note", source: "detail", label: name, type: "text" }]}
        inherited={false}
        canEditItems
        canManageColumns
        defaultOpen
      />,
    );
    expect(html, `${name} → 조사가 틀렸다`).toContain(`${expected} 표에도 보이기`);
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

  it("신규리드 상세 기대출 label은 실제 button id와 연결되고 label click은 그 편집기만 연다", async () => {
    const loanColumn: BoardColumn = {
      ...columns[0],
      id: "col-loans",
      key: "existing_loan_records",
      label: "기대출",
      type: "text",
    };
    const loanRow: ItemWithValues = {
      ...row,
      deal_id: "deal-a",
      values: { existing_loan_records: "[]" },
    };
    const host = document.createElement("div");
    document.body.append(host);
    mountedRoot = createRoot(host);
    await act(async () => {
      mountedRoot?.render(
        <ItemDetailPanel
          boardId="board-a"
          row={loanRow}
          columns={[loanColumn]}
          boardLayout={[{ key: "existing_loan_records", source: "column", label: "기대출", type: "text" }]}
          layout={[{ key: "existing_loan_records", source: "column", label: "기대출", type: "text" }]}
          inherited
          canEditItems
          canManageColumns={false}
          canonicalNewLead
          defaultOpen
        />,
      );
    });
    const detailOpener = document.querySelector<HTMLButtonElement>('[aria-label="대한정밀 상세 열기"]');
    expect(detailOpener).not.toBeNull();
    await act(async () => detailOpener?.click());

    const label = document.querySelector<HTMLLabelElement>('#detail-field-existing_loan_records label[for="item-a-existing_loan_records"]');
    const control = document.querySelector<HTMLButtonElement>("#item-a-existing_loan_records");
    expect(label).not.toBeNull();
    expect(control).not.toBeNull();
    expect(document.querySelector('[aria-label="기대출 편집"]')).toBeNull();
    await act(async () => label?.click());
    expect(document.querySelectorAll('[aria-label="기대출 편집"]')).toHaveLength(1);
  });

  it("신규리드 상세는 금융 alias를 한 셀씩 렌더하고 unplaced·generic write를 중복 생성하지 않는다", () => {
    const financialColumns: BoardColumn[] = [
      { ...columns[0], id: "col-credit", key: "credit_scores", label: "신용점수", type: "text" },
      { ...columns[0], id: "col-founded", key: "founded_month", label: "창업연월", type: "text", sort_order: 1 },
      { ...columns[0], id: "col-revenue", key: "revenue_3y_million", label: "3개년매출(백만원)", type: "number", sort_order: 2 },
    ];
    const financialLayout = financialColumns.map((column) => ({
      key: column.key,
      source: "column" as const,
      label: column.label,
      type: column.type,
    }));
    const html = renderStaticPanel(
      <ItemDetailPanel
        boardId="board-a"
        row={{
          ...row,
          deal_id: "deal-a",
          values: {
            credit_score_ncb: 812,
            credit_score_kcb: 745,
            founded_month: "2024-02-29",
            revenue_3y_million: 1234,
            revenue_band: "10억~30억",
          },
        }}
        columns={financialColumns}
        boardLayout={financialLayout}
        layout={financialLayout}
        inherited
        canEditItems
        canManageColumns
        canonicalNewLead
        defaultOpen
      />,
    );
    expect(html.match(/id="detail-field-credit_scores"/g)).toHaveLength(1);
    expect(html.match(/id="detail-field-revenue_3y_million"/g)).toHaveLength(1);
    expect(html).toContain('name="fieldKey" value="credit_score_ncb"');
    expect(html).toContain('name="fieldKey" value="credit_score_kcb"');
    expect(html).not.toContain('name="fieldKey" value="credit_scores"');
    expect(html).toContain('value="2024-02-29"');
    expect(html).toContain('value="1,234"');
    expect(html).toContain("이 화면에 배치되지 않은 항목 0개");
    expect(html).toContain("credit_score_ncb");
    expect(html).toContain("credit_score_kcb");
    expect(html).toContain("revenue_band");
    const source = readFileSync(sourcePath, "utf8");
    expect(source).toContain("current[fieldKey] === status");
    expect(source).toContain("current[NEW_LEAD_COMPOSITE_FIELD_KEYS.foundedDate] === status");
    expect(source).toContain("current[NEW_LEAD_COMPOSITE_FIELD_KEYS.revenue3yMillion] === status");
    expect(source).toContain('aria-live="polite"');
  });

  it("빈 layout의 기존 physical 금융 값은 unplaced에서 logical restore intent 한 건씩만 만든다", () => {
    const presentationColumns: BoardColumn[] = [
      { ...columns[0], id: "present-credit", key: "credit_scores", label: "신용점수", type: "text" },
      { ...columns[0], id: "present-revenue", key: "revenue_3y_million", label: "3개년매출(백만원)", type: "number", sort_order: 1 },
    ];
    const durableColumns: BoardColumn[] = [
      { ...columns[0], id: "ncb", key: "credit_score_ncb", label: "NCB", type: "number" },
      { ...columns[0], id: "kcb", key: "credit_score_kcb", label: "KCB", type: "number", sort_order: 1 },
      { ...columns[0], id: "band", key: "revenue_band", label: "기존 매출구간", type: "select", sort_order: 2 },
      { ...columns[0], id: "revenue", key: "revenue_3y_million", label: "실제 매출", type: "number", sort_order: 3 },
    ];
    const html = renderStaticPanel(
      <ItemDetailPanel
        boardId="board-a"
        row={{
          ...row,
          values: {
            credit_score_ncb: 812,
            credit_score_kcb: 745,
            revenue_band: "10억~30억",
            revenue_3y_million: 1234,
          },
        }}
        columns={presentationColumns}
        durableColumns={durableColumns}
        boardLayout={[]}
        durableBoardLayout={[]}
        layout={[]}
        durableLayout={[]}
        inherited={false}
        canEditItems
        canManageColumns
        canonicalNewLead
        defaultOpen
      />,
    );
    expect(html.match(/name="fieldKey" value="credit_scores"/g)).toHaveLength(1);
    expect(html.match(/name="fieldKey" value="revenue_3y_million"/g)).toHaveLength(1);
    expect(html).not.toContain('name="fieldKey" value="credit_score_ncb"');
    expect(html).not.toContain('name="fieldKey" value="credit_score_kcb"');
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
    ]) {
      expect(html).toContain(copy);
    }
    /*
     * #672 — 히스토리는 이제 «치울 수» 있다. 「삭제 불가」는 더 이상 사실이 아니다.
     *   ★ 그래도 «지워지지는» 않는다는 것이 문구에 남아 있어야 한다 — 되살릴 수 있다.
     */
    expect(html).not.toContain("삭제 불가");
    expect(html).toContain("전체 기록");
    expect(html).toContain("✓ 자동 저장됨");
    // #660 — 탭을 가로채므로 «빠져나갈 문(Esc)» 을 이름에 적는다. 키보드만 쓰는 사람이 갇히면 안 된다.
    // #662 — 성격이 넷이 되어 「메모 또는 통화 기록」이 더는 사실이 아니다. 고르는 자리를 가리킨다.
    expect(html).toContain(
      'aria-label="기록 내용 — 성격은 아래에서 고릅니다. 탭으로 들여쓰기, Esc 로 빠져나가기"',
    );
    /*
     * #662 — 「버튼을 누르면 미끄러지듯이 열려서 네 개 중 하나를 고른다」.
     *
     * ★ 닫힌 채로는 inert 여야 한다. 폭 0 으로 숨기기만 하면 «보이지 않는데 탭이 걸리는»
     *   버튼 넷이 남아, 키보드만 쓰는 사람이 빈 곳을 네 번 지나간다.
     * ★ 자동(field_change)은 «없어야» 한다. 시스템이 남기는 기록이라 고를 수 없다.
     */
    expect(html).toContain("data-detail-kind-picker");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain("inert");
    for (const kind of ["메모", "통화", "행정", "미팅"]) {
      expect(html).toContain(`>${kind}</button>`);
    }
    // 처음에 고른 것은 메모 하나뿐이다 — 라디오는 하나만 켜져 있어야 한다.
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    // 자동은 선택지가 아니다.
    expect(html).not.toContain(">자동</button>");
    // 높이 손잡이는 오른쪽 «위» 에 있다 — 이 칸은 화면 아래에 붙어 아래로는 늘릴 자리가 없다.
    expect(html).toContain("data-composer-grip");
    // 가장자리·가운데 손잡이로 전체 너비와 좌우 분할을 바꾼다.
    expect(html).toContain("data-detail-edge-grip");
    expect(html).toContain("data-detail-split-grip");
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

it("히스토리는 대화와 실제 변경을 기본으로 보여 주고 전체 기록에서 최초 입력을 확인한다", async () => {
  window.history.replaceState(null, "", "/#item-item-a");
  const container = document.createElement("div");
  document.body.append(container);
  mountedRoot = createRoot(container);
  await act(async () => mountedRoot?.render(
    <ItemDetailPanel boardId="board-a" row={row} columns={columns}
      boardLayout={[{ key: "company", source: "column" }]} layout={[{ key: "company", source: "column" }]}
      inherited canEditItems={false} canManageColumns={false} defaultOpen
      initialDetail={{ ok: true, links: [], files: [], members: [{ id: "user-a", name: "담당 A" }], events: [
        { id: "memo", kind: "memo", actor_id: "user-a", body: "담당자 상담 내용", created_at: row.created_at },
        { id: "initial", kind: "field_change", actor_id: "user-a", body: "company 항목이 변경되었습니다.", created_at: row.created_at, metadata: { column_key: "company", before: null, after: "초기 회사" } },
        { id: "change", kind: "field_change", actor_id: "user-a", body: "company 항목이 변경되었습니다.", created_at: "2026-08-17T00:00:00Z", metadata: { column_key: "company", before: "초기 회사", after: "변경 회사" } },
      ] }} />,
  ));
  const history = document.querySelector<HTMLElement>("[data-item-detail-history]")!;
  expect(history.textContent).toContain("담당자 상담 내용");
  expect(history.textContent).toContain("회사명: 초기 회사 → 변경 회사");
  expect(history.textContent).not.toContain("최초 입력");
  expect(history.textContent).not.toContain("company 항목");
  const toggle = history.querySelector<HTMLButtonElement>("button[aria-pressed]")!;
  await act(async () => toggle.click());
  expect(toggle.getAttribute("aria-pressed")).toBe("true");
  expect(history.textContent).toContain("회사명: 미입력 → 초기 회사 (최초 입력)");
  expect(history.querySelector("[data-history-remove]")).toBeNull();
  await act(async () => toggle.click());
  expect(history.textContent).not.toContain("최초 입력");
});
