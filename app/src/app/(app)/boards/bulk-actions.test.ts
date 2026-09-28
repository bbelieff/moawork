import { describe, expect, it } from "vitest";

import {
  BULK_BLOCKED_COLUMN_KEYS,
  BULK_BLOCKED_VALUES,
  bulkBlockReason,
  isBulkStatusIntent,
  pickBulkStatusColumn,
  resolveBulkColumnKey,
} from "./bulk-action-gates";
import { presentWorkflowProgressColumns } from "@/lib/workflow/progress";
import type { BoardColumn } from "@/lib/boards/types";

describe("bulk 전이 안전 게이트", () => {
  it("불투명 컬럼은 일괄로 쓸 수 없음 (contact_move/work_move/seal)", () => {
    expect(BULK_BLOCKED_COLUMN_KEYS.has("contact_move")).toBe(true);
    expect(BULK_BLOCKED_COLUMN_KEYS.has("work_move")).toBe(true);
    expect(BULK_BLOCKED_COLUMN_KEYS.has("seal_status")).toBe(true);
    for (const key of ["contact_move", "work_move", "seal_status", "seal_approval"]) {
      expect(bulkBlockReason(key, "무슨값", null)).toMatch(/낱개 확인 흐름/);
    }
  });

  it("어떤 컬럼에 담겨도 전이 강제 값은 차단", () => {
    for (const value of ["리드컨택으로 넘기기", "업무관리 이동", "컨택 이동"]) {
      expect(BULK_BLOCKED_VALUES.has(value)).toBe(true);
      expect(bulkBlockReason("consult_status", value, "new-lead")).toMatch(/낱개 확인 흐름/);
      expect(bulkBlockReason("contract_status", value, "contact")).toMatch(/낱개 확인 흐름/);
    }
  });

  it("합성 진행현황 키는 실제 저장 컬럼으로 환원 — EAV 오염 방지", () => {
    expect(resolveBulkColumnKey("workflow_progress", "new-lead")).toBe("consult_status");
    expect(resolveBulkColumnKey("workflow_progress", "contact")).toBe("contract_status");
    expect(resolveBulkColumnKey("workflow_progress", "work")).toBe("progress_status");
    expect(resolveBulkColumnKey("due", "new-lead")).toBe("due");
    expect(resolveBulkColumnKey("due", null)).toBe("due");
  });

  it("일반 상태·날짜·담당은 막지 않음", () => {
    expect(bulkBlockReason("consult_status", "상담 대기", "new-lead")).toBeNull();
    expect(bulkBlockReason("due", "2026-10-01", null)).toBeNull();
    expect(bulkBlockReason("owner", "user-a", null)).toBeNull();
  });

  it("단계 컬럼의 전이값도 차단 — 신리드→리드컨택 직행 불가", () => {
    expect(bulkBlockReason("consult_status", "리드컨택으로 넘기기", "new-lead")).not.toBeNull();
    expect(bulkBlockReason("workflow_progress", "리드컨택으로 넘기기", "new-lead")).not.toBeNull();
  });
});

function physical(over: Partial<BoardColumn> & { key: string }): BoardColumn {
  const { key, ...rest } = over;
  return {
    id: `col-${key}`,
    org_id: "org",
    board_id: "board",
    key,
    label: key,
    type: "status",
    source: "in",
    rightPinned: false,
    options_jsonb: { options: [] },
    sort_order: 0,
    width: null,
    ...rest,
  } as BoardColumn;
}

describe("bulk 상태 컬럼 — 물리 키 탐색", () => {
  it("합성 표에서는 단계 키를 찾을 수 없지만 물리에서는 찾는다 (주요 탭 null 회귀)", () => {
    const stage = physical({
      key: "consult_status",
      label: "상담 상황",
      options_jsonb: {
        options: [
          { id: "대기", label: "대기", color: null, order: 0 },
          { id: "리드컨택으로 넘기기", label: "리드컨택으로 넘기기", color: null, order: 1 },
        ],
      } as never,
    });
    const presented = presentWorkflowProgressColumns("new-lead", [stage]);
    // 표에는 합성 키만 남고 물리 단계 키는 사라진다 — 표에서 찾으면 null 이 되는 결함.
    expect(presented.some((column) => column.key === "consult_status")).toBe(false);
    expect(presented.some((column) => column.key === "workflow_progress")).toBe(true);

    const picked = pickBulkStatusColumn([stage], "new-lead");
    expect(picked?.key).toBe("consult_status");
    expect(picked?.label).toBe("진행현황");
    // 합성 렌더 의미 보존 — 전이값은 일괄 선택지에 올리지 않는다.
    expect(picked?.options.map((option) => option.id)).toEqual(["대기"]);
  });

  it("읽기전용·자동 칸은 상태 일괄에서 제외", () => {
    const readonly = physical({ key: "consult_status", is_readonly: true } as never);
    expect(pickBulkStatusColumn([readonly], "new-lead")).toBeNull();
  });
});

describe("bulk 상태 의도 판정 — 실제 컬럼 키 보존", () => {
  it("진행현황·단계 키만 일괄로 넘기고 다른 select 는 스스로 편집", () => {
    expect(isBulkStatusIntent("workflow_progress", "new-lead", "consult_status")).toBe(true);
    expect(isBulkStatusIntent("consult_status", "new-lead", "consult_status")).toBe(true);
    expect(isBulkStatusIntent("priority", "new-lead", "consult_status")).toBe(false);
    expect(isBulkStatusIntent("status", null, "status")).toBe(true);
    expect(isBulkStatusIntent("priority", null, "status")).toBe(false);
  });
});
