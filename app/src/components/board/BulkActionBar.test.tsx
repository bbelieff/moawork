import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/boards/bulk-actions", () => ({
  bulkApplyCellsAction: vi.fn(),
  bulkAssignAction: vi.fn(),
  bulkMoveGroupAction: vi.fn(),
}));

import { BulkActionBar, BulkFailures, shiftBulkDateTime } from "./BulkActionBar";

const TARGETS = [
  { id: "item-a", title: "대한정밀" },
  { id: "item-b", title: "한빛상사" },
];

const STATUS = {
  key: "consult_status",
  label: "진행현황",
  options: [
    { id: "대기", label: "대기" },
    { id: "진행중", label: "진행중" },
  ],
};

function bar(over: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <BulkActionBar
      boardId="board-a"
      workflowKind={null}
      totalSelected={3}
      targets={TARGETS}
      targetValues={{}}
      canEdit
      canMove
      canExport
      statusColumn={STATUS}
      fieldColumns={[{ key: "due", label: "마감일", type: "date" }]}
      dateColumns={[{ key: "due", label: "마감일", includeTime: false }]}
      members={[{ id: "user-a", label: "김담당" }]}
      groups={[{ id: "group-a", name: "새 리드" }]}
      exportCsv="이름\n대한정밀"
      exportFilename="board-a-selection.csv"
      dialog={null}
      notice={null}
      onOpenDialog={() => {}}
      onCloseDialog={() => {}}
      onClear={() => {}}
      onApplied={() => {}}
      onNotice={() => {}}
      {...over}
    />,
  );
}

describe("BulkActionBar 선택 바", () => {
  it("성공과 실패 메시지는 판정에 따라 역할·색상을 구분한다", () => {
    const success = bar({ notice: { ok: true, message: "내보냈습니다" } });
    expect(success).toContain('role="status" aria-live="polite"');
    const failure = bar({ notice: { ok: false, message: "내보낼 권한이 없어요" } });
    expect(failure).toContain('role="alert" aria-live="assertive"');
    expect(failure).toContain('class="text-xs text-mw-error"');
    expect(failure).toContain("내보낼 권한이 없어요");
  });
  it("일괄 권한이 없으면 쓰기·삭제 대화상자를 막고 export 권한도 독립적으로 숨긴다", () => {
    const html = bar({ canEdit: false, canDelete: false, canExport: false, dialog: { op: "trash" } });
    for (const op of ["status", "assignee", "date", "fields", "move", "note", "trash", "export"]) {
      expect(html).not.toContain(`data-bulk-op="${op}"`);
    }
    expect(html).not.toContain("<dialog");
  });
  it("개수·보기 내 대상·숨겨진 제외를 함께 표시", () => {
    const html = bar();
    expect(html).toContain("3개 선택");
    expect(html).toContain("보기 내 2개 대상");
    expect(html).toContain("숨겨진 1개 제외");
  });

  it("지원되는 작업만 노출 — 상태·담당자·일정·필드·이동·내보내기", () => {
    const html = bar();
    for (const op of ["status", "assignee", "date", "fields", "move", "export"] as const) {
      expect(html).toContain(`data-bulk-op="${op}"`);
    }
  });

  it("읽기 전용이면 편집 버튼을 노출하지 않고 내보내기는 유지", () => {
    const html = bar({ canEdit: false });
    expect(html).not.toContain('data-bulk-op="status"');
    expect(html).not.toContain('data-bulk-op="move"');
    expect(html).toContain('data-bulk-op="export"');
  });

  it("이동 권한이 없으면 이동 버튼을 노출하지 않음", () => {
    expect(bar({ canMove: false })).not.toContain('data-bulk-op="move"');
  });
});

describe("BulkActionBar 상태 대화상자", () => {
  it("검토 목록과 preset 값을 그대로 표시", () => {
    const html = bar({ dialog: { op: "status", preset: "진행중" } });
    expect(html).toContain("대한정밀");
    expect(html).toContain("한빛상사");
    expect(html).toContain("보기 내 2개에 적용합니다");
    expect(html).toContain("진행중");
  });

  it("일괄 불가 preset 은 제외 안내를 표시하고 입력 유지를 강제", () => {
    const html = bar({ dialog: { op: "status", preset: "리드컨택으로 넘기기" } });
    expect(html).toContain("일괄로 적용할 수 없어 제외했습니다");
  });
});

describe("BulkFailures 건별 실패", () => {
  it("실패 항목의 행 이름과 사유를 보존하고 입력 유지 문구를 표시", () => {
    const html = renderToStaticMarkup(
      <BulkFailures
        targets={TARGETS}
        result={{
          ok: false,
          applied: 1,
          failed: 1,
          results: [
            { itemId: "item-a", ok: true, message: "저장했습니다." },
            { itemId: "item-b", ok: false, message: "권한이 없어요." },
          ],
        }}
      />,
    );
    expect(html).toContain("한빛상사");
    expect(html).toContain("권한이 없어요");
    expect(html).toContain("입력은 그대로");
    expect(html).not.toContain("대한정밀 —");
  });
});

describe("shiftBulkDateTime 일정 이동", () => {
  it("날짜·일시 모두 N일 이동, 시:분 보존", () => {
    expect(shiftBulkDateTime("2026-09-25", 3)).toBe("2026-09-28");
    expect(shiftBulkDateTime("2026-09-25T14:30", -2)).toBe("2026-09-23T14:30");
    expect(shiftBulkDateTime("2026-01-31", 1)).toBe("2026-02-01");
  });

  it("저장된 정본 ISO(Z)를 UTC 날짜 기준으로 이동하고 시각을 보존", () => {
    expect(shiftBulkDateTime("2026-09-25T14:30:00.000Z", 1)).toBe("2026-09-26T14:30:00.000Z");
    expect(shiftBulkDateTime("2026-09-25T14:30:00Z", -2)).toBe("2026-09-23T14:30:00.000Z");
  });

  it("타임존 없는 로컬 ISO 초 단위는 분 형식으로 이동", () => {
    expect(shiftBulkDateTime("2026-09-25T14:30:00", 1)).toBe("2026-09-26T14:30");
  });

  it("깨진 입력은 null — 조용한 유지가 아니라 오류로", () => {
    expect(shiftBulkDateTime("내일", 3)).toBeNull();
    expect(shiftBulkDateTime("", 3)).toBeNull();
    expect(shiftBulkDateTime("2026-02-30", 1)).toBeNull();
    expect(shiftBulkDateTime("2026-09-25T14:30", 1.5)).toBeNull();
  });
});

describe("BulkActionBar 대화상자 셸", () => {
  it("모달 전용 — open 속성을 쓰지 않고 showModal 로 연다", () => {
    const html = bar({ dialog: { op: "status", preset: "진행중" } });
    expect(html).toContain("<dialog");
    expect(html).not.toContain(" open");
    expect(html).toContain('aria-label="상태 일괄 변경"');
  });
});
