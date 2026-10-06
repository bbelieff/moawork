import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Board, BoardTrashImpact, DefaultTabDismissal } from "@/lib/boards/types";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock("@/app/(app)/settings/workspace-builder/tab-actions", () => ({
  restoreBoardAction: async () => {},
  purgeBoardAction: async () => {},
  reinstallDefaultTabAction: async () => {},
}));

import {
  BoardTrashImpactSummary,
  BoardTrashSection,
  formatTrashImpact,
  quotedObject,
  reinstallableDefaultTabs,
  resolveTabTrashNotice,
  TabTrashSurface,
  trashCountdown,
} from "./TabTrashSurface";

const NOW = new Date("2026-10-07T03:00:00Z"); // KST 12:00

function board(overrides: Partial<Board>): Board {
  return {
    id: "board-x",
    org_id: "org-1",
    name: "예시 탭",
    description: null,
    icon: null,
    is_system: false,
    source: null,
    sort_order: 0,
    created_by: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

const DEFAULT_TABS = [
  { source: "core.default-tab/new-lead", name: "신규리드 관리" },
  { source: "core.default-tab/notice", name: "공지" },
];

const active = [
  board({ id: "user-before", name: "상담 준비", nav_section: "before-contract" }),
  board({ id: "user-after", name: "사후 관리", nav_section: "after-contract" }),
  board({ id: "default-new", name: "신규리드 관리", source: "core.default-tab/new-lead" }),
];
const trashed = [
  board({
    id: "trash-user",
    name: "옛 탭",
    source: "trash/trash-user",
    deleted_at: "2026-10-05T03:00:00Z",
  }),
  board({
    id: "trash-default",
    name: "공지",
    source: "trash/trash-default/core.default-tab/notice",
    trashed_source: "core.default-tab/notice",
    deleted_at: "2026-10-01T03:00:00Z",
  }),
];

describe("탭 휴지통 계산", () => {
  it("지운 시각 + 7일을 한국 날짜로, 남은 날을 올림으로 센다", () => {
    expect(trashCountdown("2026-10-05T03:00:00Z", NOW)).toEqual({ daysLeft: 5, purgeOn: "2026-10-12", label: "5일 남음 (2026-10-12)" });
    // 23:30 UTC 는 한국 날짜로 다음 날이다.
    expect(trashCountdown("2026-10-01T23:30:00Z", NOW).purgeOn).toBe("2026-10-09");
    expect(trashCountdown("2026-09-29T03:00:00Z", NOW).label).toBe("오늘 지워져요 (2026-10-06)");
    expect(trashCountdown(null, NOW).label).toBe("—");
  });

  it("탭 이름 받침에 맞춰 을/를을 고른다", () => {
    expect(quotedObject("옛 탭")).toBe("‘옛 탭’을");
    expect(quotedObject("신규리드 관리")).toBe("‘신규리드 관리’를");
    expect(quotedObject("CRM")).toBe("‘CRM’을(를)");
  });

  it("지울 내용 개수를 화면 용어로 늘어놓는다", () => {
    const impact: BoardTrashImpact = { groups: 2, rows: 1200, memos: 3, files: 4, views: 1, automations: 0, messaging: 5 };
    expect(formatTrashImpact(impact)).toBe("아이템 2 · 행 1,200 · 메모 3 · 첨부 파일 4 · 저장된 보기 1 · 자동화 규칙 0 · 문자 규칙 5");
  });

  it("휴지통에 있거나 이미 있는 기본 탭은 «다시 설치» 에서 뺀다", () => {
    const dismissals: DefaultTabDismissal[] = [
      { org_id: "org-1", source: "core.default-tab/notice", dismissed_at: "2026-10-01T03:00:00Z", dismissed_by: null },
      { org_id: "org-1", source: "core.default-tab/new-lead", dismissed_at: "2026-09-20T03:00:00Z", dismissed_by: null },
      { org_id: "org-1", source: "core.default-tab/unknown", dismissed_at: "2026-09-20T03:00:00Z", dismissed_by: null },
    ];
    // 공지는 휴지통에, 신규리드는 탭 목록에 있다 → 아무것도 다시 설치할 필요가 없다.
    expect(reinstallableDefaultTabs(dismissals, active, trashed, DEFAULT_TABS)).toEqual([]);
    expect(reinstallableDefaultTabs(dismissals, [], [], DEFAULT_TABS).map((tab) => tab.source)).toEqual([
      "core.default-tab/notice",
      "core.default-tab/new-lead",
    ]);
  });

  it("결과 안내는 URL 의 코드만 읽고 문장은 화면이 고른다", () => {
    const data = { activeBoards: active, trashedBoards: trashed, defaultTabs: DEFAULT_TABS, now: NOW };
    expect(resolveTabTrashNotice({ trashed: "trash-user" }, data)).toEqual({
      tone: "success",
      message: "‘옛 탭’을 휴지통으로 옮겼어요 · 2026-10-12에 완전히 지워져요",
    });
    expect(resolveTabTrashNotice({ error: "already-installed" }, data)).toEqual({
      tone: "error",
      message: "같은 기본 탭이 이미 다시 설치돼 있어요. 휴지통의 탭은 완전 삭제할 수 있어요.",
    });
    expect(resolveTabTrashNotice({ restored: "user-after" }, data)?.message).toContain("‘사후 관리’를 되살렸어요");
    expect(resolveTabTrashNotice({ reinstalled: "core.default-tab/notice" }, data)?.message).toBe("‘공지’ 기본 탭을 빈 탭으로 다시 설치했어요.");
    // 모르는 코드·없는 탭은 아무것도 띄우지 않는다.
    expect(resolveTabTrashNotice({ error: "<script>" }, data)).toBeNull();
    expect(resolveTabTrashNotice({ trashed: "missing" }, data)).toBeNull();
  });
});

describe("탭 관리 › 탭 목록·휴지통", () => {
  function render(params = {}, dismissals: DefaultTabDismissal[] = []) {
    return renderToStaticMarkup(
      <TabTrashSurface activeBoards={active} trashedBoards={trashed} dismissals={dismissals} defaultTabs={DEFAULT_TABS} params={params} now={NOW} />,
    );
  }

  it("탭 목록에 사이드바 자리와 기본 탭 표시, 열기 링크를 보여 준다", () => {
    const html = render();
    expect(html).toContain("탭 목록");
    expect(html).toContain("업무 › 계약 전");
    expect(html).toContain("업무 › 계약 후");
    expect(html).toContain("기본 탭");
    expect(html).toContain('href="/boards/user-before"');
  });

  it("휴지통은 최근에 지운 순서로, 남은 기간과 복구·완전 삭제 확인을 보여 준다", () => {
    const html = render();
    expect(html.indexOf("옛 탭")).toBeLessThan(html.indexOf("trash-default"));
    expect(html).toContain("2026-10-05");
    expect(html).toContain("5일 남음 (2026-10-12)");
    expect(html).toContain("1일 남음 (2026-10-08)");
    expect(html).toContain("복구");
    expect(html).toContain("지금 완전 삭제");
    expect(html).toContain("‘옛 탭’을 완전히 지울까요? 행·메모·파일까지 모두 지워지고 되돌릴 수 없어요.");
    expect(html).toContain("취소");
    expect(html).toContain("완전 삭제</button>");
  });

  it("휴지통이 비면 안내만 남기고, 지운 기본 탭은 다시 설치 버튼과 함께 보인다", () => {
    const html = renderToStaticMarkup(
      <TabTrashSurface
        activeBoards={[]}
        trashedBoards={[]}
        dismissals={[{ org_id: "org-1", source: "core.default-tab/notice", dismissed_at: "2026-10-01T03:00:00Z", dismissed_by: null }]}
        defaultTabs={DEFAULT_TABS}
        params={{}}
        now={NOW}
      />,
    );
    expect(html).toContain("휴지통이 비어 있어요");
    expect(html).toContain("지운 기본 탭");
    expect(html).toContain('name="source" value="core.default-tab/notice"');
    expect(html).toContain("기본 탭 다시 설치");
  });

  it("휴지통으로 옮긴 직후 안내를 status 로, 실패는 alert 로 알린다", () => {
    expect(render({ trashed: "trash-user" })).toMatch(/role="status"[^>]*>‘옛 탭’을 휴지통으로 옮겼어요 · 2026-10-12에 완전히 지워져요/);
    expect(render({ error: "permission" })).toMatch(/role="alert"[^>]*>이 작업을 할 권한이 없어요/);
  });
});

describe("보드 설정 › 탭 삭제", () => {
  it("휴지통 안내와 확인 단계를 거쳐 휴지통으로 삭제를 보낸다", () => {
    const html = renderToStaticMarkup(
      <BoardTrashSection boardId="board-a" boardName="옛 탭" deleteAction={async () => {}} loadImpact={async () => ({ groups: 0, rows: 0, memos: 0, files: 0, views: 0, automations: 0, messaging: 0 })} />,
    );
    expect(html).toContain(">탭 삭제</h2>");
    expect(html).not.toContain("위험 구역");
    expect(html).toContain("삭제하면 바로 휴지통으로 옮겨져요. 사이드바에서 사라지고 문자·자동화 규칙은 멈춰요.");
    expect(html).toContain("7일 안에는 탭 관리 › 휴지통에서 그대로 복구할 수 있어요. 7일이 지나면 완전히 지워져요.");
    expect(html).toContain('name="boardId" value="board-a"');
    expect(html).toContain("‘옛 탭’을 휴지통으로 옮길까요?");
    expect(html).toContain("휴지통으로 삭제</button>");
  });

  it("지울 내용 개수를 읽고, 못 읽으면 삭제를 막지 않고 알려 준다", async () => {
    const counts = renderToStaticMarkup(await BoardTrashImpactSummary({
      loadImpact: async () => ({ groups: 1, rows: 12, memos: 3, files: 2, views: 1, automations: 1, messaging: 2 }),
    }));
    expect(counts).toContain("아이템 1 · 행 12 · 메모 3 · 첨부 파일 2 · 저장된 보기 1 · 자동화 규칙 1 · 문자 규칙 2");

    const failed = renderToStaticMarkup(await BoardTrashImpactSummary({ loadImpact: async () => { throw new Error("rpc down"); } }));
    expect(failed).toContain("지울 내용의 개수를 불러오지 못했어요");
  });
});
