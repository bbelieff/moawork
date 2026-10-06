// @vitest-environment jsdom
/**
 * #839 (대표 지시 2026-10-06) — 계약업체 실무 보드의 화면 연결:
 *   · 진행현황 팝오버가 «원본» 단계 컬럼의 이동 규칙으로 «보드 이동 / 상태만 바꾸기» 를 나눈다
 *     (화면용 진행현황 열은 규칙을 비우므로 그 열로는 알 수 없다).
 *   · 같은 제목(회사명) 행이 2건 이상이면 «같은 회사 N건» — 계약업체 실무에서만.
 *   · 그룹 띠 제목은 표시만 이모지를 걷고, 이모지만 다른 중복 이름은 원문을 지킨다.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/boards/b",
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { BoardWorkspace } from "./BoardWorkspace";
import { CONTRACT_WORK_TAB_SOURCE } from "@/lib/default-tabs/contract-work";
import type { Board, BoardColumn, BoardGroup, ItemWithValues } from "@/lib/boards/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

const groups = [
  { id: "g-ready", org_id: "o", board_id: "b", name: "준비단계", color: "#00c875", sort_order: 0 },
  { id: "g-review", org_id: "o", board_id: "b", name: "🔂 심사 중", color: "#9cd326", sort_order: 1 },
  { id: "g-dup", org_id: "o", board_id: "b", name: "⏹️ 준비단계", color: null, sort_order: 2 },
] as BoardGroup[];

const columns = [{
  id: "c-progress", org_id: "o", board_id: "b", key: "progress_status", label: "진행상항", type: "status", source: "act",
  rightPinned: false, sort_order: 0, width: 160,
  options_jsonb: { options: [
    { id: "대기중", label: "대기중", color: "#00c875" },
    { id: "심사 중", label: "심사 중", color: "#9cd326" },
    { id: "📂소진공 혁신성장 대기", label: "📂소진공 혁신성장 대기", color: "#ffcb00" },
  ] },
  move_rule_jsonb: { "대기중": "g-ready", "심사 중": "g-review" },
}] as BoardColumn[];

function row(id: string, title: string, groupId: string, stage: string): ItemWithValues {
  return {
    id, org_id: "o", board_id: "b", group_id: groupId, title, assigned_to: null, deal_id: null,
    sort_order: 0, created_at: "", updated_at: "", values: { progress_status: stage },
  };
}

async function mount(source: string) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const board = { id: "b", org_id: "o", name: "계약업체 실무", source, is_system: false, sort_order: 0 } as Board;
  const rows = [
    row("r1", "QA합성회사", "g-review", "심사 중"),
    row("r2", "QA합성회사", "g-review", "📂소진공 혁신성장 대기"),
    row("r3", "단독회사", "g-ready", "대기중"),
  ];
  await act(async () => root!.render(
    <BoardWorkspace board={board} columns={columns} groups={groups} rows={rows} columnOrder={{}} cellFlash={null} assigneeLabels={{}} canEditItems canMoveRows />,
  ));
  return host;
}

describe("BoardWorkspace 계약업체 실무 화면 연결 (#839)", () => {
  it("원본 이동 규칙으로 진행현황 선택지를 «보드 이동 / 상태만 바꾸기» 로 나눈다", async () => {
    const host = await mount(CONTRACT_WORK_TAB_SOURCE);
    const trigger = host.querySelector<HTMLButtonElement>('button[role="combobox"][data-stage-value="📂소진공 혁신성장 대기"]')!;
    expect(trigger.textContent).toBe("소진공 혁신성장 대기");
    await act(async () => trigger.click());
    const picker = document.querySelector<HTMLElement>("[data-stage-picker]")!;
    const option = (id: string) => [...picker.querySelectorAll<HTMLElement>("[data-stage-option]")]
      .find((node) => node.getAttribute("data-stage-option") === id)!;
    expect(option("대기중").closest('[role="group"]')?.textContent).toContain("보드 이동");
    expect(option("대기중").textContent).toContain("→ 준비단계");
    expect(option("심사 중").textContent).toContain("지금 그룹");
    expect(option("📂소진공 혁신성장 대기").closest('[role="group"]')?.textContent).toContain("상태만 바꾸기 (보드 그대로)");
  });

  it("같은 회사 이름이 2건 이상인 행에만 «같은 회사 N건» — 다른 보드에는 없다", async () => {
    const host = await mount(CONTRACT_WORK_TAB_SOURCE);
    expect(host.querySelectorAll("[data-same-company-count]")).toHaveLength(2);
    expect(host.textContent).toContain("같은 회사 2건");
    await act(async () => root!.unmount());
    root = null;
    document.body.replaceChildren();
    const other = await mount("custom");
    expect(other.querySelectorAll("[data-same-company-count]")).toHaveLength(0);
  });

  it("그룹 띠 제목은 앞머리 이모지를 걷되, 이모지만 다른 중복 이름은 원문을 지킨다", async () => {
    const host = await mount(CONTRACT_WORK_TAB_SOURCE);
    const titles = [...host.querySelectorAll("[data-group-title]")].map((node) => node.textContent);
    expect(titles).toEqual(["준비단계", "심사 중", "⏹️ 준비단계"]);
    const accents = [...host.querySelectorAll<HTMLElement>("[data-visual-block='group-table']")].map((node) => node.dataset.groupAccent);
    expect(accents[0]).toBe("#00c875");
    expect(accents[1]).toBe("#9cd326");
    expect(accents[2]).toMatch(/^#[0-9a-f]{6}$/);
  });
});
