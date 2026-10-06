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

import { detailMemberText, detailValueText, ItemDetailPanel } from "./ItemDetailPanel";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import { emptyOtherInfoValue, updateOtherInfoEntry } from "@/lib/boards/structured-field";
import { resolveBoardDetailLayout } from "@/lib/boards/detail-layout";
import { CONTRACT_WORK_TAB } from "@/lib/default-tabs/contract-work";

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
  it("상담은 두 행 shell의 새 행이 아니라 정보 rail 안에서 스크롤된다", () => {
    const html = renderStaticPanel(
      <ItemDetailPanel boardId="board-a" row={row} columns={columns}
        boardLayout={[{ key: "company", source: "column" }]}
        layout={[{ key: "company", source: "column" }]} inherited defaultOpen canEditItems canManageColumns
        consultationSection={<section><button type="button">예약 변경</button></section>} />,
    );
    const host = document.createElement("div");
    host.innerHTML = html;
    const consultation = host.querySelector("[data-item-detail-consultation]")!;
    const rail = host.querySelector("[data-item-detail-info-rail]")!;
    const header = host.querySelector("[data-item-detail-header]")!;
    expect(consultation.parentElement).toBe(rail);
    expect(header.parentElement!.children).toHaveLength(2);
    expect(rail.contains(consultation.querySelector("button"))).toBe(true);
    const css = readFileSync(stylePath, "utf8");
    const rule = css.match(/\.consultationSection\s*\{([^}]+)\}/)![1];
    expect(rule).toContain("flex-shrink: 0");
    expect(rule).toContain("overflow-x: auto");
    expect(rule).toContain("max-width: 100%");
  });

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
      "TXT 내려받기",
      "CSV 내려받기",
      "연관담당",
      "히스토리",
    ]) {
      expect(html).toContain(copy);
    }
    // 2026-10-06 — 내보내기는 ⋯ 메뉴 한 곳에만 있다. 정보 칸 아래의 같은 버튼 묶음은 없앴다.
    expect(html).not.toContain(">내보내기</summary>");
    expect(html).not.toContain("TXT 추출");
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
    // 2026-10-06 — 이전 자료 묶음은 링크만 센다. 파일은 증빙 목록에 «한 번만» 나온다.
    expect(html).toContain("이전 링크 1개");
    expect(html).toContain("예전 견적 자료");
    expect(html.match(/견적서\.pdf/g)).toHaveLength(1);
    expect(html).not.toContain("파일 첨부");
    expect(html).not.toContain("링크 이름");
  });

  it("업로드 성공분만 동일 로컬 File의 문서 종류 선택을 열고 서버 재다운로드를 요구하지 않는다", () => {
    const source = readFileSync(sourcePath, "utf8");
    expect(source).toContain('buttonLabel="사업자등록증으로 읽기"');
    expect(source).toContain("<ItemDetailVatOcr");
    expect(source).toContain("localFile: file");
    expect(source).toContain("sourceFileId: requestId");
    expect(source).not.toContain("fetch(result.downloadUrl");
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
      "restoreDetailPanelOpener(open, wasOpenRef.current, requestedOpenerRef.current?.isConnected ? requestedOpenerRef.current : triggerRef.current)",
    );
  });

  it("v17-detail 증빙 묶음·메모 고치기·시도 추천 입력을 렌더한다", () => {
    const regionColumns: BoardColumn[] = [
      { ...columns[0], id: "col-sido", key: "sido", label: "시도", type: "select" },
    ];
    const html = renderStaticPanel(
      <ItemDetailPanel
        boardId="board-a"
        row={{ ...row, values: { sido: "서울" } }}
        columns={regionColumns}
        boardLayout={[{ key: "sido", source: "column" }]}
        layout={[{ key: "sido", source: "column" }]}
        inherited
        canEditItems
        canManageColumns={false}
        defaultOpen
        initialDetail={{
          ok: true,
          events: [
            { id: "evt-1", kind: "memo", body: "첫 메모", actor_id: "user-a", created_at: "2026-09-20T00:00:00Z" },
            { id: "evt-2", kind: "memo", body: "고친 메모", actor_id: "user-a", created_at: "2026-09-21T00:00:00Z", edited_at: "2026-09-22T00:00:00Z", edit_count: 1 },
          ],
          links: [],
          files: [
            { id: "f-1", name: "사업자등록증.pdf", mime_type: "application/pdf", size_bytes: 2048, created_at: "2026-09-22T00:00:00Z", downloadUrl: "https://example.invalid/dl" },
          ],
          members: [{ id: "user-a", name: "담당자 A" }],
          viewerId: "user-a",
          viewerRole: "member",
          assignedTo: "user-a",
        }}
      />,
    );
    // 증빙: 묶음 제목·다중 선택 input·내려받기. 폴더 연결은 건드리지 않는다.
    expect(html).toContain("증빙 파일");
    expect(html).toContain('id="item-a-evidence-files"');
    expect(html).toContain("사업자등록 1개");
    expect(html).toContain("https://example.invalid/dl");
    // 메모: 본인 줄에만 고치기, 고친 줄에는 고침 표시.
    expect(html).toContain("메모 기록 고치기");
    expect(html).toContain("고침");
    // 지역: 시도 추천 입력이 자동저장 입력 대신 렌더된다.
    expect(html).toContain('name="item-a-sido-region"');
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


describe("Next canonical URL and detail hash", () => {
  // Next 16 app-router wraps native history writes to update canonicalUrl.
  // Server Action/refresh then commits that canonical URL back to history.
  // Direct location.hash does not pass through this integration point.
  function routerHistoryProbe() {
    let canonical = window.location.href;
    const push = window.history.pushState.bind(window.history);
    const replace = window.history.replaceState.bind(window.history);
    const pushSpy = vi.spyOn(window.history, "pushState").mockImplementation((data, title, url) => {
      if (url) canonical = new URL(url, window.location.href).href;
      push(data, title, url);
    });
    const replaceSpy = vi.spyOn(window.history, "replaceState").mockImplementation((data, title, url) => {
      if (url) canonical = new URL(url, window.location.href).href;
      replace(data, title, url);
    });
    return { canonical: () => canonical, refresh: () => replace(null, "", canonical),
      restore: () => { pushSpy.mockRestore(); replaceSpy.mockRestore(); } };
  }
  function panel(id = "item-a", next?: {id:string;title:string}, previous?: {id:string;title:string}) {
    return <ItemDetailPanel boardId="board-a" row={{ ...row, id, title: id === "item-a" ? "대한정밀" : "미래상사" }}
      columns={columns} boardLayout={[{key:"company",source:"column"}]} layout={[{key:"company",source:"column"}]}
      inherited canEditItems canManageColumns={false} nextItem={next} previousItem={previous}
      initialDetail={{ok:true,events:[],links:[],files:[],members:[]}} />;
  }
  it("a saved checkbox regroup keeps the same detail open after the row remounts", async () => {
    window.history.replaceState(null,"","/w/test/boards/board-a?consultation=remote");
    const probe = routerHistoryProbe();
    try {
      const host=document.createElement("div"); document.body.append(host); mountedRoot=createRoot(host);
      await act(async()=>mountedRoot?.render(<div key="contract-done">{panel()}</div>));
      await act(async()=>document.querySelector<HTMLButtonElement>('[data-item-detail-trigger="item-a"]')!.click());
      expect(new URL(probe.canonical()).hash).toBe("#item-item-a");
      await act(async()=>{ probe.refresh(); mountedRoot?.render(<div key="deposit-confirmed">{panel()}</div>); });
      expect(window.location.hash).toBe("#item-item-a");
      expect(document.querySelectorAll('[aria-label="상세 닫기"]')).toHaveLength(1);
      expect(window.location.search).toBe("?consultation=remote");
    } finally { probe.restore(); }
  });
  it("sibling navigation updates the router URL and back/forward still select one detail", async () => {
    const probe=routerHistoryProbe();
    try {
      const host=document.createElement("div"); document.body.append(host); mountedRoot=createRoot(host);
      await act(async()=>mountedRoot?.render(<>{panel("item-a",{id:"item-b",title:"미래상사"})}{panel("item-b",undefined,{id:"item-a",title:"대한정밀"})}</>));
      await act(async()=>document.querySelector<HTMLButtonElement>('[data-item-detail-trigger="item-a"]')!.click());
      await act(async()=>{ document.querySelector<HTMLButtonElement>('[aria-label="다음 회사 미래상사 열기"]')!.click(); await new Promise(resolve=>setTimeout(resolve,30)); });
      expect(new URL(probe.canonical()).hash).toBe("#item-item-b");
      await act(async()=>{ window.history.back(); await new Promise(resolve=>setTimeout(resolve,30)); });
      expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("대한정밀");
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
      await act(async()=>{ window.history.forward(); await new Promise(resolve=>setTimeout(resolve,30)); });
      expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("미래상사");
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    } finally { probe.restore(); }
  });
  it("closing a direct deep link replaces only its hash and keeps the query", async () => {
    window.history.replaceState(null,"","/w/test/boards/board-a?consultation=remote#item-item-a");
    const probe=routerHistoryProbe(); const length=window.history.length;
    try {
      const host=document.createElement("div"); document.body.append(host); mountedRoot=createRoot(host);
      await act(async()=>mountedRoot?.render(panel()));
      await act(async()=>document.querySelector<HTMLButtonElement>('[aria-label="상세 닫기"]')!.click());
      expect(new URL(probe.canonical()).hash).toBe("");
      expect(window.location.search).toBe("?consultation=remote");
      expect(window.history.length).toBe(length);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    } finally { probe.restore(); }
  });
  it("an unsuccessful save refresh retains the open drawer and unsaved memo draft", async () => {
    const probe=routerHistoryProbe();
    try {
      const host=document.createElement("div"); document.body.append(host); mountedRoot=createRoot(host);
      await act(async()=>mountedRoot?.render(panel()));
      await act(async()=>document.querySelector<HTMLButtonElement>('[data-item-detail-trigger="item-a"]')!.click());
      const draft=document.querySelector<HTMLTextAreaElement>('[data-item-detail-composer] textarea')!;
      await act(async()=>{
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(draft,"아직 저장하지 않은 메모");
        draft.dispatchEvent(new Event("input",{bubbles:true}));
      });
      await act(async()=>{ probe.refresh(); mountedRoot?.render(panel()); });
      expect(window.location.hash).toBe("#item-item-a");
      expect(document.querySelector<HTMLTextAreaElement>('[data-item-detail-composer] textarea')!.value).toBe("아직 저장하지 않은 메모");
      expect(document.querySelectorAll('[aria-label="상세 닫기"]')).toHaveLength(1);
    } finally { probe.restore(); }
  });
  it("closing a drawer opened here goes back once instead of adding another URL entry", async () => {
    window.history.replaceState(null,"","/w/test/boards/board-a?consultation=remote");
    const length=window.history.length;
    const host=document.createElement("div"); document.body.append(host); mountedRoot=createRoot(host);
    await act(async()=>mountedRoot?.render(panel()));
    await act(async()=>document.querySelector<HTMLButtonElement>('[data-item-detail-trigger="item-a"]')!.click());
    expect(window.history.length).toBe(length+1);
    await act(async()=>{ document.querySelector<HTMLButtonElement>('[aria-label="상세 닫기"]')!.click(); await new Promise(resolve=>setTimeout(resolve,30)); });
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("?consultation=remote");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

});

/*
 * 2026-10-06 소유자 피드백 「상세가 너무 복잡하다」 — 모든 보드가 함께 쓰는 상세 drawer.
 *   ① 배치된 필드가 없을 때 안내 한 줄과 (관리자만) 「필드 배치」
 *   ② 설정 도구(순서 규칙·상세 전용 필드·표 승격·상세/표 배지)는 접힌 관리자 영역 한 곳에만
 *   ③ 증빙은 브라우저 기본 파일 선택 대신 놓는 자리 한 줄
 *   ④ 글자 크기·굵기는 토큰 네 단계
 */
describe("2026-10-06 상세 정리", () => {
  function staticHost(html: string) {
    const host = document.createElement("div");
    host.innerHTML = html;
    return host;
  }

  it("일반 사용자에게는 설정 도구·⠿ 손잡이·상세/표 배지·중복 내보내기가 보이지 않는다", () => {
    const html = renderStaticPanel(
      <ItemDetailPanel
        boardId="board-a"
        row={{ ...row, values: { company: "대한정밀", detail_note: "메모" } }}
        columns={columns}
        boardLayout={[{ key: "company", source: "column" }]}
        layout={[
          { key: "company", source: "column" },
          { key: "detail_note", source: "detail", label: "상세 메모", type: "text" },
        ]}
        inherited
        canEditItems
        canManageColumns={false}
        defaultOpen
      />,
    );
    for (const hidden of ["순서 규칙", "+ 상세 전용 필드 추가", "⠿", "표에도 보이기", "관리자 · 상세 배치 편집", ">내보내기<"]) {
      expect(html, hidden).not.toContain(hidden);
    }
    const rail = staticHost(html).querySelector("[data-item-detail-info-rail]")!;
    // 필드 줄에는 이름과 값만 남는다 — 배지 텍스트(상세/표)가 라벨에 붙지 않는다.
    expect([...rail.querySelectorAll("label[id$='-label']")].map((label) => label.textContent)).toEqual(["회사명", "상세 메모"]);
  });

  it("관리자 설정 도구는 접힌 「관리자 · 상세 배치 편집」 안에만 있다", () => {
    const html = renderStaticPanel(
      <ItemDetailPanel
        boardId="board-a"
        row={{ ...row, values: { detail_note: "메모", detail_cert: "있음" } }}
        columns={columns}
        boardLayout={[]}
        layout={[
          { key: "detail_note", source: "detail", label: "상세 메모", type: "text" },
          { key: "detail_cert", source: "column", label: "법인공동인증서", type: "text" },
        ]}
        inherited={false}
        canEditItems
        canManageColumns
        defaultOpen
      />,
    );
    const host = staticHost(html);
    const admin = [...host.querySelectorAll("details")]
      .find((candidate) => candidate.querySelector(":scope > summary")?.textContent === "관리자 · 상세 배치 편집")!;
    expect(admin).toBeDefined();
    expect(admin.hasAttribute("open")).toBe(false);
    for (const selector of [
      '[aria-label="상세 메모를 표에도 보이기"]',
      '[aria-label="법인공동인증서를 표에서 내리기"]',
      '[aria-label="상세 전용 필드 이름"]',
    ]) {
      const control = host.querySelector(selector);
      expect(control, selector).not.toBeNull();
      expect(admin.contains(control), `${selector} 가 관리자 영역 밖에 있다`).toBe(true);
    }
    expect(admin.textContent).toContain("순서 규칙");
    // 배지는 관리자 목록에서만 뜻이 있다.
    const fieldList = host.querySelector("[data-item-detail-info-rail]")!;
    const badgesOutside = [...fieldList.querySelectorAll("span")]
      .filter((span) => (span.textContent === "상세" || span.textContent === "표") && !admin.contains(span));
    expect(badgesOutside).toHaveLength(0);
  });

  it("읽는 순서는 회사 정보 → 증빙 파일 → 클라우드 폴더이고, 연결 전 폴더는 한 줄로 접힌다", () => {
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
        initialDetail={{ ok: true, events: [], links: [], files: [], members: [] }}
      />,
    );
    const host = staticHost(html);
    const rail = host.querySelector("[data-item-detail-info-rail]")!;
    const order = [...rail.children].map((child) =>
      child.querySelector("h3")?.textContent
      ?? child.querySelector(":scope > summary")?.textContent
      ?? (child.matches("[class*='fieldList']") ? "fields" : ""),
    ).filter(Boolean);
    expect(order).toEqual(["회사 정보", "fields", "증빙 파일", "클라우드 폴더 연결", "관리자 · 상세 배치 편집"]);
    const folder = rail.querySelector("[data-item-detail-cloud-folder]")!;
    expect(folder.hasAttribute("open")).toBe(false);
    // 긴 설명 문장 대신 흐린 한 줄만 남긴다.
    expect(html).not.toContain("Google Drive·OneDrive·Dropbox 등의 폴더 하나로");
    expect(html).not.toContain("보호 저장소에 직접 올립니다");
    expect(html).not.toContain("파일은 이 브라우저 안에서만 읽습니다. 체크한 필드만");
  });

  it.each([
    [true, "표시할 필드가 없어요"],
    [false, "표시할 정보가 없어요"],
  ])("배치된 필드가 없으면 안내 한 줄만 보인다 (관리자=%s)", (canManageColumns, copy) => {
    const html = renderStaticPanel(
      <ItemDetailPanel
        boardId="board-a"
        row={row}
        columns={columns}
        boardLayout={[]}
        layout={[]}
        inherited
        canEditItems
        canManageColumns={canManageColumns}
        defaultOpen
      />,
    );
    const empty = staticHost(html).querySelector("[data-detail-empty-fields]")!;
    expect(empty.textContent).toContain(copy);
    expect(html).not.toContain("배치된 상세 필드가 없습니다");
    expect(html).not.toContain("미배치");
    expect(empty.querySelector("button")?.textContent ?? null).toBe(canManageColumns ? "필드 배치" : null);
  });

  it("관리자의 「필드 배치」는 접힌 관리자 영역을 펼치고 그 제목으로 초점을 옮긴다", async () => {
    window.history.replaceState(null, "", "/#item-item-a");
    const container = document.createElement("div");
    document.body.append(container);
    mountedRoot = createRoot(container);
    await act(async () => mountedRoot?.render(
      <ItemDetailPanel boardId="board-a" row={row} columns={columns} boardLayout={[]} layout={[]}
        inherited canEditItems canManageColumns defaultOpen
        initialDetail={{ ok: true, events: [], links: [], files: [], members: [] }} />,
    ));
    const admin = [...document.querySelectorAll<HTMLDetailsElement>("details")]
      .find((candidate) => candidate.querySelector(":scope > summary")?.textContent === "관리자 · 상세 배치 편집")!;
    expect(admin.open).toBe(false);
    const trigger = document.querySelector<HTMLButtonElement>("[data-detail-empty-fields] button")!;
    await act(async () => trigger.click());
    expect(admin.open).toBe(true);
    expect(document.activeElement).toBe(admin.querySelector("summary"));
  });

  it("증빙은 스타일된 놓는 자리 한 줄이고 input은 sr-only로만 숨긴다", () => {
    const html = renderStaticPanel(
      <ItemDetailPanel boardId="board-a" row={row} columns={columns}
        boardLayout={[{ key: "company", source: "column" }]} layout={[{ key: "company", source: "column" }]}
        inherited canEditItems canManageColumns={false} defaultOpen />,
    );
    const host = staticHost(html);
    const drop = host.querySelector("[data-evidence-drop]")!;
    const input = drop.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.id).toBe("item-a-evidence-files");
    expect(input.hasAttribute("multiple")).toBe(true);
    expect(input.className).toMatch(/visuallyHidden/);
    const label = drop.querySelector("label")!;
    expect(label.getAttribute("for")).toBe(input.id);
    expect(label.textContent).toBe("파일 올리기");
    expect(drop.textContent).toContain("또는 끌어다 놓기");
    // OCR은 같은 줄의 보조 버튼이지만 놓는 자리 «밖» 이다 — OCR 모달에 놓은 파일이 증빙으로 올라가면 안 된다.
    const ocr = [...host.querySelectorAll("button")].find((button) => button.textContent === "사업자등록증 OCR로 읽기")!;
    expect(ocr).toBeDefined();
    expect(drop.contains(ocr)).toBe(false);
    expect(drop.parentElement!.contains(ocr)).toBe(true);
    const css = readFileSync(stylePath, "utf8");
    const hidden = css.match(/\.visuallyHidden\s*\{([^}]+)\}/)![1];
    expect(hidden).toContain("width: 1px");
    expect(hidden).toContain("clip-path: inset(50%)");
    expect(hidden).not.toContain("display: none");
    expect(css).toMatch(/\.evidenceDrop\[data-dragover="true"\]\s*\{[^}]*border-color: var\(--mw-primary\)/);
    expect(css).toMatch(/\.evidenceDrop:focus-within\s*\{[^}]*outline: 2px solid var\(--mw-primary\)/);
  });

  it("끌기는 놓는 자리를 강조하고, 자식 사이 이동에는 깜빡이지 않으며, 뒤의 표 행으로 새지 않는다", async () => {
    const rowDragOver = vi.fn();
    const rowDrop = vi.fn();
    window.history.replaceState(null, "", "/#item-item-a");
    const container = document.createElement("div");
    document.body.append(container);
    mountedRoot = createRoot(container);
    await act(async () => mountedRoot?.render(
      // 실제 보드는 <tr onDragOver={acceptRow} onDrop={dropRow}> 안에서 상세를 그린다.
      <div onDragOver={rowDragOver} onDrop={rowDrop}>
        <ItemDetailPanel boardId="board-a" row={row} columns={columns}
          boardLayout={[{ key: "company", source: "column" }]} layout={[{ key: "company", source: "column" }]}
          inherited canEditItems canManageColumns={false} defaultOpen
          initialDetail={{ ok: true, events: [], links: [], files: [], members: [] }} />
      </div>,
    ));
    const drop = document.querySelector<HTMLElement>("[data-evidence-drop]")!;
    const label = drop.querySelector("label")!;
    expect(drop.dataset.dragover).toBe("false");
    await act(async () => { drop.dispatchEvent(new MouseEvent("dragover", { bubbles: true, cancelable: true })); });
    expect(drop.dataset.dragover).toBe("true");
    await act(async () => { drop.dispatchEvent(new MouseEvent("dragleave", { bubbles: true, relatedTarget: label })); });
    expect(drop.dataset.dragover, "자식으로 옮겨 갔을 뿐인데 강조가 꺼졌다").toBe("true");
    await act(async () => { drop.dispatchEvent(new MouseEvent("dragleave", { bubbles: true, relatedTarget: document.body })); });
    expect(drop.dataset.dragover).toBe("false");
    const dropEvent = new MouseEvent("drop", { bubbles: true, cancelable: true });
    // jsdom 의 MouseEvent 에는 dataTransfer 가 없다. 빈 목록이면 업로드는 일어나지 않는다.
    Object.defineProperty(dropEvent, "dataTransfer", { value: { files: [] } });
    await act(async () => { drop.dispatchEvent(dropEvent); });
    expect(dropEvent.defaultPrevented).toBe(true);
    expect(rowDragOver).not.toHaveBeenCalled();
    expect(rowDrop).not.toHaveBeenCalled();
  });

  it("글자 크기는 --fs 토큰, 굵기는 400/600 토큰만 쓰고 정보 칸에 기본 크기가 있다", () => {
    const css = readFileSync(stylePath, "utf8");
    const sizes = [...css.matchAll(/font-size:\s*([^;]+);/g)].map((match) => match[1]);
    expect(sizes.filter((size) => !/^var\(--fs-(11|12|13|14|16|18|22)\)$/.test(size))).toEqual([]);
    const weights = [...css.matchAll(/font-weight:\s*([^;]+);/g)].map((match) => match[1]);
    expect(weights.filter((weight) => weight !== "var(--fw-normal)" && weight !== "var(--fw-semibold)")).toEqual([]);
    const rail = css.match(/\.infoRail\s*\{([^}]+)\}/)![1];
    expect(rail).toContain("font-size: var(--fs-12)");
    expect(css).toMatch(/\.companyName\s*\{[^}]*font-size: var\(--fs-16\);[^}]*font-weight: var\(--fw-semibold\)/);
    expect(css).not.toContain("fieldHandle");
    // 패널 안에는 Tailwind 크기·굵기 유틸리티를 두지 않는다(행의 「열기 ↗」 버튼은 표 안이라 제외).
    const source = readFileSync(sourcePath, "utf8");
    const panelBody = source.slice(source.indexOf("{open && ("));
    expect(panelBody).not.toMatch(/\b(text-xs|text-sm|text-base|font-bold|font-semibold|font-normal)\b/);
  });
});

/*
 * 2026-10-06 검토 P1 — 계약업체 실무 상세의 첫 칸이 담당자(person)였고, 일반 글자 입력으로 떨어져
 *   구성원 id 를 날것으로 보여 줬다. 그 입력에 이름을 치면 담당자가 구성원 아닌 글자로 저장됐다.
 */
describe("2026-10-06 구성원 칸은 글자 입력도, 날것 id 도 아니다", () => {
  const KNOWN = "8b1f3c9e-1111-2222-3333-444455556666";
  const GONE = "0d6c2a71-9999-4888-8777-666655554444";
  const members = [{ id: KNOWN, label: "김담당" }];

  function staticHost(html: string) {
    const host = document.createElement("div");
    host.innerHTML = html;
    return host;
  }

  const workColumns: BoardColumn[] = CONTRACT_WORK_TAB.columns.map((definition, index) => ({
    id: `col-${definition.key}`, org_id: "org-a", board_id: "board-work", key: definition.key,
    label: definition.label, type: definition.type, source: definition.source,
    rightPinned: definition.rightPinned ?? false,
    options_jsonb: definition.options ? { options: definition.options } : null,
    sort_order: index, width: definition.width ?? null,
  }));

  it.each([true, false])("계약업체 실무 기본 배치(canEditItems=%s)에 담당자 입력이 없고 id 가 보이지 않는다", (canEditItems) => {
    const layout = resolveBoardDetailLayout(CONTRACT_WORK_TAB.source, [], workColumns);
    const html = renderStaticPanel(
      <ItemDetailPanel
        boardId="board-work"
        row={{ ...row, board_id: "board-work", assigned_to: KNOWN, values: { owner: KNOWN, engagement_kind: "자금" } }}
        columns={workColumns}
        boardLayout={layout}
        layout={layout}
        inherited
        canEditItems={canEditItems}
        canManageColumns={canEditItems}
        memberOptions={members}
        defaultOpen
        initialDetail={{ ok: true, events: [], links: [], files: [], members: [] }}
      />,
    );
    const host = staticHost(html);
    expect(host.querySelector("#item-a-owner")).toBeNull();
    expect(host.querySelector("#detail-field-owner")).toBeNull();
    expect(html).not.toContain(KNOWN);
    // 담당자는 연관담당 줄의 「담당자」로 이름이 보인다.
    expect(host.querySelector("[data-item-detail-watchers]")?.textContent).toContain("김담당담당자");
  });

  it.each([true, false])("배치에 놓인 구성원 칸(canEditItems=%s)은 이름만 읽기 전용으로 보여 준다", (canEditItems) => {
    const memberColumns: BoardColumn[] = [
      { ...columns[0], id: "col-owner", key: "owner", label: "담당자", type: "person", sort_order: 0 },
      { ...columns[0], id: "col-reviewer", key: "reviewer", label: "검토자", type: "person", sort_order: 1 },
      { ...columns[0], id: "col-team", key: "team", label: "참여자", type: "people", sort_order: 2 },
      { ...columns[0], id: "col-legacy", key: "legacy_owner", label: "옛 담당", type: "person", sort_order: 3 },
    ];
    const layout = memberColumns.map((column) => ({ key: column.key, source: "column" as const }));
    const html = renderStaticPanel(
      <ItemDetailPanel
        boardId="board-a"
        row={{ ...row, values: { owner: KNOWN, reviewer: GONE, team: [KNOWN, GONE], legacy_owner: "홍길동" } }}
        columns={memberColumns}
        boardLayout={layout}
        layout={layout}
        inherited
        canEditItems={canEditItems}
        canManageColumns={false}
        memberOptions={members}
        defaultOpen
        initialDetail={{ ok: true, events: [], links: [], files: [], members: [] }}
      />,
    );
    const host = staticHost(html);
    for (const column of memberColumns) {
      expect(host.querySelector(`#item-a-${column.key}`), column.key).toBeNull();
      const field = host.querySelector(`#detail-field-${column.key}`)!;
      expect(field.querySelector("input, textarea, select"), column.key).toBeNull();
      expect(field.querySelector("label")?.hasAttribute("for"), column.key).toBe(false);
    }
    const text = (key: string) => host.querySelector(`#detail-field-${key} [data-detail-member-field]`)?.textContent;
    expect(text("owner")).toBe("김담당");
    expect(text("reviewer")).toBe("알 수 없는 구성원");
    expect(text("team")).toBe("김담당, 알 수 없는 구성원");
    expect(text("legacy_owner")).toBe("홍길동");
    expect(html).not.toContain(KNOWN);
    expect(html).not.toContain(GONE);
  });

  it("내보내기·미배치 목록이 쓰는 값 문구도 구성원 이름이다", () => {
    expect(detailValueText("person", KNOWN, {}, null, members)).toBe("김담당");
    expect(detailValueText("people", [KNOWN, GONE], {}, null, members)).toBe("김담당, 알 수 없는 구성원");
    expect(detailValueText("person", null, {}, null, members)).toBe("—");
    expect(detailMemberText(GONE, [])).toBe("알 수 없는 구성원");
  });
});
