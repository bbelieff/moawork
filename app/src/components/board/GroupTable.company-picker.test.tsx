// @vitest-environment jsdom

/**
 * GroupTable → ContractWorkIntakeForm 사이의 «한 줄» 을 잰다 (#588 ③ 후속).
 *
 * ★ 왜 이 파일이 생겼나 — 검수가 그 한 줄(`truncated={companyPicker.truncated}`)을
 *   지우고 325개 테스트를 돌렸는데 **하나도 안 빨개졌다.**
 *   서버·전달(props)·폼은 각각 테스트가 있었는데 그 사이의 GroupTable 만
 *   아무도 «그려 보고» 있지 않았다.
 *
 *   이 줄이 끊기면 잘린 목록에서 「먼저 등록해 주세요」만 뜨고 「일부만 보인다」가
 *   사라진다 — 이 기능이 막으려던 중복을 이 기능이 만든다.
 *   타입을 필수로 올려 «안 넘기는 것» 은 막았지만, 타입은 «false 를 넘기는 것» 은
 *   못 막는다. 그래서 실제로 열어서 문장을 확인한다.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/w/sample-lab/boards/b-1" }));

import { GroupTable } from "./GroupTable";
import type { BoardColumn } from "@/lib/boards/types";
import type { CompanyPickerRow } from "@/lib/companies/search";
import type { CompanyIntakeActionState } from "@/app/(app)/boards/[id]/company-intake-actions";

const COLUMN: BoardColumn = {
  id: "col-name", org_id: "org", board_id: "b1", key: "name", label: "업체명",
  type: "text", source: "in", rightPinned: false, options_jsonb: null,
  sort_order: 0, width: null,
};

const ROWS: readonly CompanyPickerRow[] = [
  { company: { id: "c-1", org_id: "org", name: "가나상사" } as unknown as CompanyPickerRow["company"], dealCount: 0 },
];

const action = async () => ({ ok: true, message: "" }) as CompanyIntakeActionState;

let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

/** 표를 그리고 「＋ 업체 추가」를 눌러 고르기를 연다. */
async function openPicker(truncated: boolean) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <GroupTable
        boardId="b1"
        groupId="g-1"
        columns={[COLUMN]}
        rows={[]}
        readOnly={false}
        rowDragEnabled={false}
        cellFlash={null}
        onColumnDrop={() => {}}
        dragRowId={null}
        canDropRow={() => false}
        onRowDragStart={() => {}}
        onRowDragEnd={() => {}}
        onRowDrop={() => {}}
        canDeleteItems={false}
        companyPicker={{ rows: ROWS, loadError: null, truncated, action }}
      />,
    );
  });
  const trigger = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("업체 추가"));
  expect(trigger, "「＋ 업체 추가」 버튼이 있어야 한다").toBeTruthy();
  await act(async () => trigger?.click());
  return host;
}

describe("GroupTable — 업체 고르기로 «잘렸다» 를 전달한다", () => {
  it("★ 잘렸으면 폼이 그 사실을 안다", async () => {
    const host = await openPicker(true);
    expect(host.textContent).toContain("안 보여도 없는 게 아니에요");
  });

  it("안 잘렸으면 종전 안내 그대로다", async () => {
    const host = await openPicker(false);
    expect(host.textContent).toContain("먼저 등록해 주세요");
    expect(host.textContent).not.toContain("안 보여도 없는 게 아니에요");
  });
});
