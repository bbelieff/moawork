/**
 * BBE-174 그룹 프리셋 메뉴 — 렌더 계약.
 *
 * ⚠ **이것은 AGENTS.md §3 의 «화면 확인 증거» 가 아니다.** 렌더 테스트는 마크업이 나온다는
 * 것만 말하고, 그 화면이 실제로 열리는지는 말하지 않는다(§1.5 가 그 착각을 지목했다).
 * 여기서 고정하는 것은 딱 두 가지다 —
 *   ① 「WO-6에서 연결됩니다」 대기 문구가 **더 이상 없다**
 *   ② 권한에 따라 무엇이 보이고 무엇 대신 이유가 보이는가
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BoardColumn } from "@/lib/boards/types";
import type { SectionPresetRecord } from "@/lib/presets/section-presets";

// 서버 액션은 렌더 계약과 무관하다. 실제 동작은 preset-actions.test.ts 가 검증한다.
vi.mock("@/app/(app)/boards/preset-actions", () => ({
  INITIAL_GROUP_PRESET_STATE: { ok: true, message: null },
  saveGroupPresetAction: vi.fn(),
  applyGroupPresetAction: vi.fn(),
  resetGroupPresetAction: vi.fn(),
}));

const { GroupPresetMenu } = await import("./GroupPresetMenu");
const { GroupBlock } = await import("./GroupBlock");

function column(key: string, label: string): BoardColumn {
  return {
    id: `col-${key}`, org_id: "org-1", board_id: "board-1", key, label,
    type: "text", source: "in", rightPinned: false, options_jsonb: null,
    sort_order: 0, width: null, move_rule_jsonb: null, is_readonly: false,
  };
}

const columns = [column("owner", "담당자"), column("phone", "연락처")];

const preset: SectionPresetRecord = {
  id: "preset-1",
  name: "신규리드 관리-1차 부재",
  groups: [{ name: "1차 부재", color: null }],
  columns: [],
  created_at: "2026-08-17T00:00:00Z",
  source: "user.section-preset/x",
};

function menu(overrides: Partial<Parameters<typeof GroupPresetMenu>[0]> = {}) {
  return renderToStaticMarkup(
    <GroupPresetMenu
      boardId="board-1"
      groupKey="group-1"
      savable
      presetName="신규리드 관리-1차 부재"
      changed={false}
      columns={columns}
      order={undefined}
      presets={[preset]}
      canEditPresets
      canManageColumns
      {...overrides}
    />,
  );
}

describe("BBE-174 GroupPresetMenu", () => {
  it("대기 문구 대신 실제 액션을 그린다", () => {
    const html = menu();

    // 이 카드가 없애러 온 문구.
    expect(html).not.toContain("WO-6");
    expect(html).not.toContain("연결됩니다");

    expect(html).toContain("현재 구조를 프리셋으로 저장");
    expect(html).toContain("다른 프리셋 적용");
    expect(html).toContain("신규리드 관리-1차 부재");
  });

  it("저장 폼이 보드·그룹·요청 id 를 함께 보낸다 — 요청 id 가 멱등성의 근거다", () => {
    const html = menu();

    expect(html).toContain('name="boardId"');
    expect(html).toContain('name="groupKey"');
    expect(html).toContain('name="requestId"');
    // 이름 칸의 기본값은 칩에 보이는 이름과 같다.
    expect(html).toContain('value="신규리드 관리-1차 부재"');
  });

  it("프리셋을 고르기 전에는 적용 버튼이 없다 — 미리보기가 먼저다", () => {
    const html = menu();

    expect(html).toContain("프리셋을 고르면 미리보기가 나옵니다");
    expect(html).not.toContain("이 아이템에 적용");
  });

  it("변경됨이면 «되돌리기» 가 나오고, 무엇이 비워지는지 적는다", () => {
    const changed = menu({ changed: true, order: ["phone", "owner"] });

    expect(changed).toContain("기본으로 되돌리기");
    expect(changed).toContain("컬럼도 값도 그대로 남습니다");
    expect(changed).toContain("변경됨");

    expect(menu()).not.toContain("기본으로 되돌리기");
  });

  it("권한이 없으면 버튼을 감추는 대신 이유를 적는다", () => {
    const html = menu({ canEditPresets: false });

    expect(html).toContain("«프리셋 편집» 권한이 필요합니다");
    expect(html).not.toContain("현재 구조를 프리셋으로 저장");
    expect(html).not.toContain("다른 프리셋 적용");
  });

  it("가상 «그룹 없음» 블록에는 저장을 걸지 않는다 — 저장할 그룹이 없다", () => {
    const html = menu({ savable: false, groupKey: "__ungrouped__" });

    expect(html).not.toContain("현재 구조를 프리셋으로 저장");
    // 적용·되돌리기는 배치만 다루므로 가상 블록에서도 의미가 있다.
    expect(html).toContain("다른 프리셋 적용");
  });

  it("저장된 프리셋이 없으면 «먼저 저장해 보세요» 로 안내한다 (원칙 5 — 빈 상태 한 줄 + 다음 행동)", () => {
    expect(menu({ presets: [] })).toContain("저장된 아이템 프리셋이 없습니다");
  });
});

describe("BBE-174 GroupBlock 프리셋 칩", () => {
  it("메뉴를 넘기면 머리말에 그 메뉴가 들어간다", () => {
    const html = renderToStaticMarkup(
      <GroupBlock
        name="1차 부재"
        color="#4f46e5"
        columns={columns}
        rows={[]}
        presetName="신규리드 관리-1차 부재"
        presetChanged={false}
        presetMenu={<span data-testid="preset-menu">메뉴 자리</span>}
      >
        <div />
      </GroupBlock>,
    );

    expect(html).toContain("메뉴 자리");
    expect(html).not.toContain("WO-6");
  });

  it("메뉴가 없어도 대기 문구로 돌아가지 않는다", () => {
    const html = renderToStaticMarkup(
      <GroupBlock
        name="1차 부재"
        color={null}
        columns={columns}
        rows={[]}
        presetName="신규리드 관리-1차 부재"
        presetChanged
      >
        <div />
      </GroupBlock>,
    );

    expect(html).not.toContain("WO-6");
    expect(html).not.toContain("연결됩니다");
    expect(html).toContain("변경됨");
  });
});
