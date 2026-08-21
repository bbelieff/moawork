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
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { BoardColumn } from "@/lib/boards/types";
import type { SectionPresetRecord } from "@/lib/presets/section-presets";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

// 서버 액션은 렌더 계약과 무관하다. 실제 동작은 preset-actions.test.ts 가 검증한다.
vi.mock("@/app/(app)/boards/preset-actions", () => ({
  loadGroupPresetLibraryAction: vi.fn(),
  saveGroupPresetAction: vi.fn(),
  applyGroupPresetAction: vi.fn(),
  resetGroupPresetAction: vi.fn(),
}));

import { loadGroupPresetLibraryAction } from "@/app/(app)/boards/preset-actions";

const { createPresetLibraryLoader, GroupPresetMenu } = await import("./GroupPresetMenu");
const { GroupBlock } = await import("./GroupBlock");
const { BoardWorkspace } = await import("./BoardWorkspace");

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
      columns={columns}
      order={undefined}
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
    expect(html).toContain("다른 프리셋과 견주기");
    expect(html).toContain("메뉴를 열면 저장된 프리셋을 불러옵니다");
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

    expect(html).toContain("메뉴를 열면 저장된 프리셋을 불러옵니다");
    expect(html).not.toContain("이 아이템에 적용");
  });

  it("durable 배치가 있으면 변경됨과 기본 되돌리기를 그린다", () => {
    const html = menu({ order: ["phone", "owner"] });
    expect(html).toContain("기본으로 되돌리기");
    expect(html).toContain("변경됨");
    expect(html).toContain('name="boardId"');
    expect(html).toContain('name="groupKey"');
  });

  it("권한이 없으면 버튼을 감추는 대신 이유를 적는다", () => {
    const html = menu({ canEditPresets: false });

    expect(html).toContain("«프리셋 편집» 권한이 필요합니다");
    expect(html).not.toContain("현재 구조를 프리셋으로 저장");
    expect(html).not.toContain("다른 프리셋과 견주기");
  });

  it("가상 «그룹 없음» 블록에는 저장을 걸지 않는다 — 저장할 그룹이 없다", () => {
    const html = menu({ savable: false, groupKey: "__ungrouped__" });

    expect(html).not.toContain("현재 구조를 프리셋으로 저장");
    // 미리보기는 저장 대상이 없어도 의미가 있다.
    expect(html).toContain("다른 프리셋과 견주기");
  });

  it("렌더만으로는 라이브러리를 조회하지 않는다", () => {
    menu();
    expect(vi.mocked(loadGroupPresetLibraryAction)).not.toHaveBeenCalled();
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

  it("카드 전체를 자르지 않는다 — 자르면 머리말의 팝오버가 잘려 안 보인다", () => {
    const html = renderToStaticMarkup(
      <GroupBlock
        name="1차 부재"
        color={null}
        columns={columns}
        rows={[]}
        presetName="p"
        presetChanged={false}
        presetMenu={<span>메뉴</span>}
      >
        <div>본문</div>
      </GroupBlock>,
    );

    const section = html.slice(0, html.indexOf(">") + 1);
    // Chrome 실측: <section> 에 overflow-hidden 이 있으면 그 section 이 팝오버를 자른다.
    expect(section).toContain("<section");
    expect(section).not.toContain("overflow-hidden");
    // 대신 본문 래퍼가 아래쪽 모서리를 자른다 — 카드 모양은 그대로다.
    expect(html).toContain("overflow-hidden rounded-b-xl");
    expect(html).toContain("rounded-t-xl");
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
    // 원래 있던 «변경됨» 점(●)은 그대로 둔다 — 이 PR 이 추가한 텍스트만 뺐다(구조 축소 금지).
    expect(html).toContain("bg-mw-primary");
  });
});

/*
 * W1·W2 — 배선을 잰다.
 *
 * 검수에서 나온 구멍: `GroupPresetMenu` 를 **직접** 렌더하는 테스트와 `GroupBlock` 이 메뉴를
 * **주입받아** 렌더하는 테스트만 있었다. 그래서 «보드 화면이 그 메뉴를 실제로 다는가» 와
 * «버튼이 어떤 액션에 물려 있는가» 는 아무도 보지 않았다 —
 * `BoardWorkspace` 가 `presetMenu` 를 아예 안 넘겨도 109건이 전부 초록이었다.
 */
describe("BBE-174 배선 — BoardWorkspace 가 메뉴를 실제로 단다 (W1)", () => {
  const board = {
    id: "board-1", org_id: "org-1", name: "신규리드 관리", description: null, icon: null,
    is_system: false, source: null, sort_order: 0, created_by: null,
    created_at: "2026-08-17T00:00:00Z", updated_at: "2026-08-17T00:00:00Z",
  };
  const group = { id: "group-1", org_id: "org-1", board_id: "board-1", name: "1차 부재", color: null, sort_order: 0 };
  const row = {
    id: "item-1", org_id: "org-1", board_id: "board-1", group_id: "group-1", title: "행",
    assigned_to: null, deal_id: null, sort_order: 0, created_at: "2026-08-17T00:00:00Z",
    updated_at: "2026-08-17T00:00:00Z", values: {},
  };

  function workspace(overrides: Record<string, unknown> = {}) {
    return renderToStaticMarkup(
      <BoardWorkspace
        board={board}
        columns={columns}
        groups={[group]}
        rows={[row]}
        columnOrder={{}}
        cellFlash={null}
        assigneeLabels={{}}
        canEditItems
          canEditPresets
        {...overrides}
      />,
    );
  }

  it("일반 보드에는 프리셋 메뉴가 붙는다", () => {
    const html = workspace();
    expect(html).toContain("아이템 프리셋 메뉴");
    expect(html).toContain("현재 구조를 프리셋으로 저장");
    expect(html).not.toContain("WO-6");
  });

  it("시스템 보드에는 붙이지 않는다 — 구조 편집이 막힌 화면이다", () => {
    const html = workspace({ board: { ...board, is_system: true } });
    expect(html).not.toContain("아이템 프리셋 메뉴");
    expect(html).not.toContain("현재 구조를 프리셋으로 저장");
  });
});

describe("BBE-223 메뉴 지연 조회", () => {
  it("GroupPresetMenu 자신의 open 토글만 loader를 부른다 — GroupBlock 기본 open과 분리한다", () => {
    const source = readFileSync(new URL("./GroupPresetMenu.tsx", import.meta.url), "utf8");
    expect(source).toContain("onToggle={async (event) =>");
    expect(source).toContain("event.currentTarget.open");
    expect(source).toContain("loader.current.open()");
  });

  it("열기 전 0회, 열면 1회, 반복 열기에도 같은 요청을 재사용한다", async () => {
    const fetchLibrary = vi.fn(async () => ({ ok: true, presets: [preset], message: null }));
    const loader = createPresetLibraryLoader(fetchLibrary);
    expect(fetchLibrary).toHaveBeenCalledTimes(0);

    const first = await loader.open();
    const second = await loader.open();

    expect(fetchLibrary).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("오류도 한 번만 조회하고 빈 목록으로 fail-closed 한다", async () => {
    const failed = { ok: false, presets: [], message: "불러오지 못했습니다." };
    const fetchLibrary = vi.fn(async () => failed);
    const loader = createPresetLibraryLoader(fetchLibrary);

    expect(await loader.open()).toEqual(failed);
    expect(await loader.open()).toEqual(failed);
    expect(fetchLibrary).toHaveBeenCalledTimes(1);
  });
});

describe("BBE-174 배선 — 이 슬라이스가 그리는 액션 (W2)", () => {
  it("저장과 durable 되돌리기 액션을 그린다", () => {
    const html = menu({ order: ["phone", "owner"] });

    // 저장은 실제로 있다.
    expect(html).toContain("현재 구조를 프리셋으로 저장");
    expect(html).toContain('name="requestId"');

    // 적용은 프리셋을 골라 미리보기를 본 뒤에만 나오고, durable 배치는 되돌릴 수 있다.
    expect(html).not.toContain("이 아이템에 적용");
    expect(html).toContain("기본으로 되돌리기");
    expect(html.match(/type="submit"/g) ?? []).toHaveLength(2);
  });

  it("미리보기는 남는다 — 적용하면 무엇이 되는지는 보여준다", () => {
    const html = menu();
    expect(html).toContain("다른 프리셋과 견주기");
  });

  it("apply/reset 서버 액션과 새로고침·Escape 계약을 실제 소스에 고정한다", () => {
    const source = readFileSync(new URL("./GroupPresetMenu.tsx", import.meta.url), "utf8");
    expect(source).toContain("useActionState(applyGroupPresetAction");
    expect(source).toContain("useActionState(resetGroupPresetAction");
    expect(source).toContain('name="presetId"');
    expect(source).toContain("router.refresh()");
    expect(source).toContain("loader.current = refreshed");
    expect(source).toContain('event.key !== "Escape"');
    expect(source).toContain("새 컬럼은 보드 공용이라 다른 아이템에도 나타납니다");
  });

  it("컬럼 관리 권한이 없으면 적용·되돌리기 대신 이유를 보여준다", () => {
    const html = menu({ order: ["phone", "owner"], canManageColumns: false });
    expect(html).toContain("되돌리려면 «컬럼 관리» 권한이 필요합니다");
    expect(html).not.toContain("기본으로 되돌리기");
  });
});
