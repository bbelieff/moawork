import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { kstLocalToIso } from "./column-settings-model";

const panel = readFileSync(new URL("./ColumnSettingsPanel.tsx", import.meta.url), "utf8");
const actions = readFileSync(new URL("../../app/(app)/boards/column-settings-actions.ts", import.meta.url), "utf8");
const menu = readFileSync(new URL("./ColumnContextMenu.tsx", import.meta.url), "utf8");

describe("BBE-178 column settings UI preparation", () => {
  it("converts the explicitly labelled KST wall time without browser-timezone drift", () => {
    expect(kstLocalToIso("2026-08-21T09:30")).toBe("2026-08-21T00:30:00.000Z");
    expect(kstLocalToIso("2026-08-21 09:30")).toBeNull();
    expect(kstLocalToIso("not-a-date")).toBeNull();
  });

  it("registers the settings panel in the merged context-menu surface", () => {
    expect(menu).toContain('setPanel("settings")}>컬럼 설정');
    expect(menu).toContain("<ColumnSettingsPanel");
  });

  it("keeps required/validation and new delivery fail-closed until migration118 and its worker are live", () => {
    expect(panel).toContain("필수·유효성은 원자 저장과 서버 우회 차단 계약이 배포된 뒤 켤 수 있습니다");
    expect(panel).toContain("<fieldset disabled");
    expect(panel).toContain("const DELIVERY_READY = false");
    expect(panel).toContain("실제 발송 연결 후 예약 가능");
  });

  it("makes the recipient and timezone semantics explicit and supports status/cancel/error surfaces", () => {
    expect(panel).toContain("받는 사람(직접 선택)");
    expect(panel).toContain("담당자 자동 추정 없이 이 사용자 한 명에게만 예약합니다");
    expect(panel).toContain("예약 시각 (KST, Asia/Seoul)");
    expect(panel).toContain("statusLabel(schedule.status)");
    expect(panel).toContain("cancelColumnScheduleAction");
    expect(panel).toContain('role={message.ok ? "status" : "alert"}');
  });

  it("uses only the hosted115 command/set/cancel contracts with tenant and board-column guards", () => {
    expect(actions).toContain('client.rpc(BOARD_COLUMN_RPC.command');
    expect(actions).toContain('client.rpc("set_board_column_date_schedule"');
    expect(actions).toContain('client.rpc("cancel_board_column_date_schedule"');
    expect(actions).toContain('loadPermGuard(ctx.org.id, "structure.column_manage")');
    expect(actions).toContain("service.getBoardDetail(ctx, boardId)");
    expect(actions).toContain('.eq("org_id", ctx.org.id).eq("board_id", boardId).eq("column_id", columnId)');
    expect(actions).not.toMatch(/service_role|supabase\/migrations|worker\/src/);
  });
});
