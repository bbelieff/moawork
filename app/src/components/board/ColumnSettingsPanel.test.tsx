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

  it("enables required/validation and delivery only after migration118 and its constrained worker are live", () => {
    expect(panel).toContain("기존 결손은 임의로 채우지 않으며");
    expect(panel).toContain('name="required"');
    expect(panel).toContain('name="dateMin"');
    expect(panel).toContain("const DELIVERY_READY = true");
    expect(panel).toContain("예약 저장");
    expect(panel).toContain("외부 문자·이메일은 보내지 않습니다");
  });

  it("makes the recipient and timezone semantics explicit and supports status/cancel/error surfaces", () => {
    expect(panel).toContain("받는 사람(직접 선택)");
    expect(panel).toContain("담당자 자동 추정 없이 이 사용자 한 명에게만 예약합니다");
    expect(panel).toContain("예약 시각 (KST, Asia/Seoul)");
    expect(panel).toContain("statusLabel(schedule.status)");
    expect(panel).toContain("cancelColumnScheduleAction");
    expect(panel).toContain('role={message.ok ? "status" : "alert"}');
  });

  it("uses the canonical wrap enum and preserves policies the two presets cannot represent", () => {
    expect(panel).toContain('? "wrap" : "truncate"');
    expect(panel).toContain('<option value="truncate">한 줄</option>');
    expect(panel).toContain('return "all";');
    expect(panel).toContain('keys.length === 1 && keys[0] === "roles"');
    expect(panel).toContain(': "preserve";');
    expect(panel).toContain('<option value="preserve">기존 제한 유지</option>');
    expect(actions).toContain('...(input.editPolicy ? { editPolicy:');
    expect(actions).toContain('...(input.viewPolicy ? { viewPolicy:');
  });

  it("uses only the hosted115 command/set/cancel contracts with tenant and board-column guards", () => {
    expect(actions).toContain('client.rpc(BOARD_COLUMN_RPC.command');
    expect(actions).toContain('client.rpc("set_board_column_date_schedule"');
    expect(actions).toContain('client.rpc("cancel_board_column_date_schedule"');
    expect(actions).toContain("required: Boolean(input.required)");
    expect(actions).toContain("validation: input.validation");
    expect(actions).toContain('loadPermGuard(ctx.org.id, "structure.column_manage")');
    expect(actions).toContain("service.getBoardDetail(ctx, boardId)");
    expect(actions).toContain('.eq("org_id", ctx.org.id).eq("board_id", boardId).eq("column_id", columnId)');
    expect(actions).not.toMatch(/service_role|supabase\/migrations|worker\/src/);
  });
});
