// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { GroupTable } from "./GroupTable";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

function col(key: string, label: string, type = "select"): BoardColumn {
  return {
    id: `col-${key}`,
    org_id: "org",
    board_id: "b1",
    key,
    label,
    type,
    source: "in",
    rightPinned: false,
    options_jsonb: {
      options: [
        { id: "a", label: "A", order: 0 },
        { id: "b", label: "B", order: 1 },
      ],
    } as never,
    sort_order: 0,
    width: null,
  } as BoardColumn;
}

function row(id: string): ItemWithValues {
  return {
    id,
    org_id: "org",
    board_id: "b1",
    group_id: "g1",
    title: id,
    assigned_to: null,
    deal_id: null,
    sort_order: 0,
    created_at: "2026-08-10T00:00:00Z",
    updated_at: "2026-08-10T00:00:00Z",
    values: { priority: "a" },
  };
}

async function renderTable(host: HTMLElement, props: {
  columns: BoardColumn[];
  canManageColumns?: boolean;
  addLabelOptionAction?: (input: {
    boardId: string; columnId: string; label: string; requestId: string;
  }) => Promise<{ ok: boolean; message: string; optionId?: string; conflict?: boolean }>;
  cellAction?: (form: FormData) => Promise<void>;
}) {
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <GroupTable
        boardId="b1"
        groupId="g1"
        columns={props.columns}
        rows={[row("row-1")]}
        readOnly={false}
        rowDragEnabled={false}
        cellFlash={null}
        onColumnDrop={() => {}}
        dragRowId={null}
        canDropRow={() => false}
        onRowDragStart={() => {}}
        onRowDragEnd={() => {}}
        onRowDrop={() => {}}
        canManageColumns={props.canManageColumns}
        addLabelOptionAction={props.addLabelOptionAction}
        cellAction={props.cellAction ?? (async () => {})}
      />,
    );
  });
}

function typeInto(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("GroupTable 셀 — 라벨 만들기 입구", () => {
  it("컬럼 관리 권한이 있으면 만들기 행이 보이고 저장이 같은 폼 계약으로 간다", async () => {
    const created: { boardId: string; columnId: string; label: string; requestId: string }[] = [];
    const saved: string[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    await renderTable(host, {
      columns: [col("priority", "우선순위")],
      canManageColumns: true,
      addLabelOptionAction: async (input) => {
        created.push(input);
        return { ok: true, optionId: "새값", message: "만들었어요." };
      },
      cellAction: async (form) => {
        saved.push(String(form.get("value") ?? ""));
      },
    });
    const input = host.querySelector('input[aria-label="우선순위"]') as HTMLInputElement;
    await act(async () => {
      input.focus();
      typeInto(input, "새값");
    });
    expect(host.textContent).toContain("「새값」 새로 만들기");
    const createButton = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("새로 만들기"))!;
    await act(async () => createButton.click());
    expect(created).toHaveLength(1);
    // 컬럼 id 보존·열쇠 동봉 — 기존 옵션 업데이트 서비스로 간다.
    expect(created[0]).toEqual({ boardId: "b1", columnId: "col-priority", label: "새값", requestId: expect.any(String) });
    expect(created[0].requestId).not.toBe("");
    // 만든 값이 같은 셀 폼으로 저장된다.
    expect(saved).toEqual(["새값"]);
  });

  it("일반 편집자(관리 권한 없음)는 검색·선택만 되고 만들기 행이 없다", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    await renderTable(host, {
      columns: [col("priority", "우선순위")],
      canManageColumns: false,
      addLabelOptionAction: async () => ({ ok: true, message: "ok" }),
    });
    const input = host.querySelector('input[aria-label="우선순위"]') as HTMLInputElement;
    await act(async () => {
      input.focus();
      typeInto(input, "B");
    });
    // 검색은 된다.
    expect(host.textContent).toContain("B");
    expect(host.textContent).not.toContain("새로 만들기");
    await act(async () => typeInto(input, "없는값"));
    expect(host.textContent).not.toContain("새로 만들기");
    expect(host.textContent).toContain("찾은 값이 없습니다");
  });

  it("보호 컬럼(진행상황·지역)은 관리 권한이 있어도 만들기 행이 없다", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    await renderTable(host, {
      columns: [
        { ...col("progress_status", "진행상황", "status"), move_rule_jsonb: { a: "g1" } },
        col("sido", "시도"),
      ],
      canManageColumns: true,
      addLabelOptionAction: async () => ({ ok: true, message: "ok" }),
    });
    for (const name of ["진행상황", "시도"]) {
      const input = host.querySelector(`input[aria-label="${name}"]`) as HTMLInputElement;
      await act(async () => {
        input.focus();
        typeInto(input, "없는값");
      });
      expect(host.textContent, name).not.toContain("새로 만들기");
    }
    // 검색·선택은 그대로 된다.
    const progress = host.querySelector('input[aria-label="진행상황"]') as HTMLInputElement;
    await act(async () => typeInto(progress, "A"));
    expect(host.textContent).toContain("A");
  });
});
