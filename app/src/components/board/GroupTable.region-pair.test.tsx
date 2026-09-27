// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GroupTable } from "./GroupTable";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";

vi.mock("@/app/(app)/boards/region-pair-actions", () => ({
  updateNewLeadRegionPairAction: vi.fn(async () => ({ ok: true, message: "✓ 자동 저장됨" })),
  updateBoardRegionPairAction: vi.fn(async () => ({ ok: true, message: "✓ 자동 저장됨" })),
}));

function col(key: string, label: string): BoardColumn {
  return {
    id: `col-${key}`,
    org_id: "org",
    board_id: "board-1",
    key,
    label,
    type: "select",
    source: "in",
    rightPinned: false,
    options_jsonb: null,
    sort_order: 0,
    width: null,
  };
}

function row(values: Record<string, unknown>, dealId: string | null = null): ItemWithValues {
  return {
    id: "item-1",
    org_id: "org",
    board_id: "board-1",
    group_id: "group-1",
    title: "행1",
    assigned_to: null,
    deal_id: dealId,
    sort_order: 0,
    created_at: "2026-08-10T00:00:00Z",
    updated_at: "2026-08-10T00:00:00Z",
    values: values as ItemWithValues["values"],
  };
}

function render(columns: readonly BoardColumn[], rows: readonly ItemWithValues[], canonical = false) {
  return renderToStaticMarkup(
    <GroupTable
      boardId="board-1"
      groupId="group-1"
      columns={columns}
      rows={rows}
      readOnly={false}
      canonicalNewLead={canonical}
      rowDragEnabled={false}
      cellFlash={null}
      onColumnDrop={() => {}}
      dragRowId={null}
      canDropRow={() => false}
      onRowDragStart={() => {}}
      onRowDragEnd={() => {}}
      onRowDrop={() => {}}
    />,
  );
}

describe("GroupTable 시도-시군구 의존 콤보", () => {
  it("시도·시군구 열이 함께 있으면 두 칸 다 콤보로 그린다", () => {
    const html = render([col("sido", "시도"), col("sigungu", "시군구")], [row({ sido: "서울", sigungu: "강남구" })]);
    expect(html).toContain('name="item-1-sido-region"');
    expect(html).toContain('name="item-1-sigungu-region"');
    // 단일필드 form(낱개 저장)으로 직접 저장하지 않는다 — 쌍 액션으로만 간다.
    expect(html).not.toContain('name="columnKey" value="sido"');
    expect(html).not.toContain('name="columnKey" value="sigungu"');
  });

  it("신규리드 연결 행도 같은 콤보 — canonical SSOT와 일반보드 모두 처리", () => {
    const canonicalHtml = render(
      [col("sido", "시도"), col("sigungu", "시군구")],
      [row({ sido: "서울", sigungu: "강남구" }, "deal-1")],
      true,
    );
    expect(canonicalHtml).toContain('name="item-1-sido-region"');
    expect(canonicalHtml).toContain('name="item-1-sigungu-region"');

    const generalHtml = render(
      [col("region_sido", "시도"), col("region_sigungu", "시군구")],
      [row({ region_sido: "경기", region_sigungu: "화성시" })],
    );
    expect(generalHtml).toContain('name="item-1-region_sido-region"');
    expect(generalHtml).toContain('name="item-1-region_sigungu-region"');
  });

  it("시도 하나만 있으면 의존 콤보로 바꾸지 않는다 — 중간 잘못된 조합을 만들지 않음", () => {
    const html = render([col("sido", "시도"), col("note", "메모")], [row({ sido: "서울" })]);
    expect(html).not.toContain('name="item-1-sido-region"');
  });

  it("컬럼 is_readonly 잠금도 쌍 양쪽을 표시만 한다(BoardCell과 같은 판정)", () => {
    const readonlySido = { ...col("sido", "시도"), is_readonly: true };
    const html = render([readonlySido, col("sigungu", "시군구")], [row({ sido: "서울", sigungu: "강남구" })]);
    expect(html).not.toContain('role="combobox"');
    expect(html).toContain("서울");
    expect(html).toContain("강남구");
  });

  it("source 비편집(수식) 잠금도 쌍 양쪽을 표시만 한다", () => {
    const calcSigungu = { ...col("sigungu", "시군구"), source: "calc" as const };
    const html = render([col("sido", "시도"), calcSigungu], [row({ sido: "서울", sigungu: "강남구" })]);
    expect(html).not.toContain('role="combobox"');
    expect(html).toContain("서울");
    expect(html).toContain("강남구");
  });

  it("읽기전용에서는 콤보 대신 표시만 한다", () => {
    const html = renderToStaticMarkup(
      <GroupTable
        boardId="board-1"
        groupId="group-1"
        columns={[col("sido", "시도"), col("sigungu", "시군구")]}
        rows={[row({ sido: "서울", sigungu: "강남구" })]}
        readOnly
        rowDragEnabled={false}
        cellFlash={null}
        onColumnDrop={() => {}}
        dragRowId={null}
        canDropRow={() => false}
        onRowDragStart={() => {}}
        onRowDragEnd={() => {}}
        onRowDrop={() => {}}
      />,
    );
    expect(html).not.toContain('role="combobox"');
    expect(html).toContain("서울");
  });
  it("정본 연결 행도 서버에서 거부하는 계산 출처를 편집기로 열지 않는다", () => {
    const html = render(
      [col("sido", "시도"), { ...col("sigungu", "시군구"), source: "calc" }],
      [row({ sido: "서울", sigungu: "강남구" }, "deal-1")],
      true,
    );
    expect(html).not.toContain('role="combobox"');
    expect(html).toContain("강남구");
  });
});
