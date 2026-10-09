// @vitest-environment jsdom
/**
 * #845 5단계(2026-10-08 대표 결정) — 칸 머리글과 칸 메뉴를 «그려진 결과와 행동» 으로 잰다.
 *   · 머리글은 이름만: 이름이 곧 메뉴 단추(누르기 · Enter/Space · 오른쪽 단추), ⋯ 단추·출처 기호 없음
 *   · 메뉴는 간결하게: 맨 위 칸 이름 + 회색 한 줄(「날짜 · 18/24 채움」), 항목은 한 줄씩(둘째 줄·예시 없음)
 *   · 「보기 [나만]」 / 「칸 [모두]」 — 뒤쪽은 칸 관리 권한이 있을 때만
 *   · 고른 일은 맞는 요청을 올린다(정렬·필터·숨기기·옮기기), 지우기는 확인 창에서 결과를 말한다
 *   (#604 계약: 메뉴는 본문 포털 · 보드에서 한 번에 하나 · 확인 대화상자 · 중복 제출 막기는 그대로)
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import { ColumnContextMenu, type ColumnMenuMove, type ColumnMenuView } from "./ColumnContextMenu";

const command = vi.hoisted(() => vi.fn());
const rename = vi.hoisted(() => vi.fn());
vi.mock("@/app/(app)/boards/column-command-actions", () => ({ runColumnCommandAction: command }));
vi.mock("@/app/(app)/boards/title-actions", () => ({ renameColumnTitleAction: rename }));

const source = readFileSync(resolve(process.cwd(), "src/components/board/ColumnContextMenu.tsx"), "utf8");
const workspace = readFileSync(resolve(process.cwd(), "src/components/board/BoardWorkspace.tsx"), "utf8");

const base = {
  org_id: "org-a", board_id: "board-a", rightPinned: false, options_jsonb: null,
  sort_order: 1, width: 160, move_rule_jsonb: null,
} as const;
const column = { ...base, id: "column-a", key: "amount", label: "지원 금액", type: "money", source: "in" } as BoardColumn;
const rowOf = (id: string, values: ItemWithValues["values"]): ItemWithValues => ({
  id, org_id: "org-a", board_id: "board-a", group_id: null, title: id, assigned_to: null, deal_id: null,
  sort_order: 0, created_at: "", updated_at: "", values,
});
const rows = [rowOf("r1", { amount: 1000 }), rowOf("r2", { amount: null }), rowOf("r3", { amount: 3000 })];

let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type MenuProps = Partial<Parameters<typeof ColumnContextMenu>[0]>;

async function renderMenu(props: MenuProps = {}, two = false, onParentDrag = vi.fn()) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<div data-overflow-host draggable onDragStart={onParentDrag}>
      <ColumnContextMenu boardId="board-a" column={column} canManage {...props} />
      {two ? <ColumnContextMenu boardId="board-a" column={{ ...column, id: "column-b", key: "date", label: "신청일", type: "date" }} canManage /> : null}
    </div>);
  });
  return { host, onParentDrag };
}

const nextFrame = () => act(async () => new Promise<void>((done) => window.requestAnimationFrame(() => done())));
const title = (label = "지원 금액") => [...document.querySelectorAll<HTMLElement>("[data-column-title]")].find((node) => node.textContent === label)!;
const menu = () => document.querySelector<HTMLElement>('[role="menu"]');
const items = () => [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
const itemLabel = (node: Element) => node.querySelector("span")?.textContent ?? "";
const item = (label: string) => items().find((node) => itemLabel(node) === label);

async function click(element: Element) {
  await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}
async function key(element: Element, value: string, init: KeyboardEventInit = {}) {
  await act(async () => element.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...init })));
}
async function openMenu(label?: string) {
  await click(title(label));
  await nextFrame();
}

function view(over: Partial<ColumnMenuView> = {}): ColumnMenuView {
  return { sortDirection: null, canFilter: false, onRequest: vi.fn(), ...over };
}

beforeEach(() => {
  command.mockReset();
  command.mockResolvedValue({ ok: true, message: "저장했습니다." });
  rename.mockReset();
  rename.mockImplementation(async (_board: string, _column: string, name: string) => ({ ok: true, name }));
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("칸 머리글 — 이름이 곧 메뉴 단추", () => {
  it("이름만 그리고(⋯·출처 기호 없음) 메뉴 단추 의미를 갖는다", async () => {
    await renderMenu();
    const trigger = title();
    expect(trigger.getAttribute("role")).toBe("button");
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.tabIndex).toBe(0);
    const header = document.querySelector("[data-overflow-host]")!.textContent;
    expect(header).toBe("지원 금액");
    for (const mark of ["⋯", "✎", "▼", "⇄", "ƒ", "⟳", "✉"]) expect(header).not.toContain(mark);
    expect(source).not.toContain("SourceBadge");
  });

  it("누르면 본문 포털에 메뉴가 열리고, 다시 누르면 닫힌다", async () => {
    await renderMenu();
    await openMenu();
    expect(menu()!.parentElement).toBe(document.body);
    expect(menu()!.closest("[data-overflow-host]")).toBeNull();
    expect(title().getAttribute("aria-expanded")).toBe("true");
    expect(title().getAttribute("aria-controls")).toBe(menu()!.id);
    expect(document.activeElement).toBe(items()[0]);
    await click(title());
    expect(menu()).toBeNull();
  });

  it("Enter·Space·오른쪽 단추로 열고 Esc 로 닫으면 초점이 이름으로 돌아온다", async () => {
    await renderMenu();
    for (const value of ["Enter", " "]) {
      await key(title(), value);
      expect(menu(), value).not.toBeNull();
      await nextFrame();
      await key(menu()!, "Escape");
      await nextFrame();
      expect(menu()).toBeNull();
      expect(document.activeElement).toBe(title());
    }
    await act(async () => title().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    expect(menu()).not.toBeNull();
  });

  it("이름을 끌면 머리글 끌기(칸 순서 바꾸기)로 이어진다 — 메뉴 단추가 끌기를 막지 않는다", async () => {
    const onParentDrag = vi.fn();
    await renderMenu({}, false, onParentDrag);
    const drag = new Event("dragstart", { bubbles: true, cancelable: true });
    await act(async () => title().dispatchEvent(drag));
    expect(onParentDrag).toHaveBeenCalledTimes(1);
    expect(drag.defaultPrevented).toBe(false);
    expect(title().tagName).not.toBe("BUTTON");
  });

  it("보드에서 칸 메뉴는 한 번에 하나만 열린다", async () => {
    await renderMenu({}, true);
    await openMenu("지원 금액");
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
    await openMenu("신청일");
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
    expect(menu()!.getAttribute("aria-label")).toBe("신청일 칸 메뉴");
  });
});

async function remount(props: MenuProps = {}) {
  await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  await renderMenu(props);
}

describe("칸 메뉴 맨 위 — 칸 이름 + 회색 한 줄", () => {
  const meta = () => document.querySelector("[data-column-menu-meta]")!.textContent;

  it.each([
    [{ type: "date", source: "in" }, "날짜 · 2/3 채움"],
    [{ type: "select", source: "in" }, "목록 · 2/3 채움"],
    [{ type: "person", source: "auto" }, "사람 · 2/3 채움"],
    [{ type: "text", source: "act" }, "글자 · 2/3 채움"],
    [{ type: "money", source: "in" }, "금액 · 2/3 채움"],
    [{ type: "number", source: "in" }, "숫자 · 2/3 채움"],
    [{ type: "money", source: "lk" }, "연결 · 2/3 채움"],
    [{ type: "calc", source: "calc", is_readonly: true }, "계산 · 고칠 수 없음"],
    [{ type: "text", source: "in", is_readonly: true }, "글자 · 2/3 채움 · 고칠 수 없음"],
    [{ type: "text", source: "msg" }, "글자 · 2/3 채움 · 문자 발송"],
  ] as const)("%o → %s", async (over, expected) => {
    await renderMenu({ column: { ...column, ...over } as BoardColumn, rows });
    await openMenu();
    const about = document.querySelector("[data-column-menu-about]")!;
    expect(about.querySelector("p")!.textContent).toBe("지원 금액");
    expect(about.querySelector("p")!.className).toContain("text-[15px]");
    expect(meta()).toBe(expected);
    // 이름 + 회색 한 줄 — 그 밖의 풀이 줄(쓰는 곳 · 예시)은 없다.
    expect(about.querySelectorAll("p")).toHaveLength(2);
    expect(menu()!.getAttribute("aria-describedby")).toBe(about.id);
  });

  it("행을 모르면 채움 수를 말하지 않는다", async () => {
    await renderMenu();
    await openMenu();
    expect(meta()).toBe("금액");
  });

  it("계산 칸이 이 칸을 써도 메뉴에서는 말하지 않는다(지우기 확인 창에서만)", async () => {
    const reviewEnd = { ...column, id: "c-end", key: "expected_review_end", label: "예상 심사 종료", type: "date" } as BoardColumn;
    const dday = { ...column, id: "c-dday", key: "review_dday", label: "ƒ심사 D-day", type: "calc", source: "calc", is_readonly: true } as BoardColumn;
    await renderMenu({ column: reviewEnd, catalog: [reviewEnd, dday] });
    await openMenu("예상 심사 종료");
    expect(menu()!.textContent).not.toContain("심사 D-day");
    expect(menu()!.textContent).not.toContain("쓰는 곳");
  });
});

describe("두 묶음 — 보기 [나만] · 칸 [모두]", () => {
  const sectionLabels = () => [...document.querySelectorAll('[role="menu"] [data-column-menu-section-label]')].map((node) => node.textContent);
  const labels = () => items().map(itemLabel);

  it("칸 관리 권한이 없으면 「보기」 만, 있으면 두 묶음 모두 — 항목은 한 줄씩", async () => {
    await renderMenu({ canManage: false, view: view() });
    await openMenu();
    expect(sectionLabels()).toEqual(["보기나만"]);
    expect(labels()).toEqual(["큰 금액순", "작은 금액순", "숨기기"]);
    expect(item("이름 바꾸기")).toBeUndefined();
    expect(item("지우기")).toBeUndefined();

    await remount({ view: view({ canFilter: true }), rows, move: { canLeft: true, canRight: true, onMove: vi.fn() } });
    await openMenu();
    expect(sectionLabels()).toEqual(["보기나만", "칸모두"]);
    expect(labels()).toEqual([
      "큰 금액순", "작은 금액순", "필터…", "숨기기",
      "이름 바꾸기", "입력 방식 바꾸기", "왼쪽으로", "오른쪽으로", "오른쪽에 칸 추가", "복사하기", "지우기",
    ]);
    // 둘째 줄·예시·결과 풀이가 없다 — 항목 글자 = 이름 하나.
    for (const node of items()) {
      expect(node.querySelectorAll("span")).toHaveLength(1);
      expect(node.textContent).toBe(itemLabel(node));
    }
    expect(item("지우기")!.getAttribute("style")).toContain("var(--mw-error)");
  });

  it("칸 관리 권한만 있고 보기 요청이 없으면 「칸」 묶음만", async () => {
    await renderMenu();
    await openMenu();
    expect(sectionLabels()).toEqual(["칸모두"]);
  });

  it("메뉴 글자에 정렬·그룹·컬럼 같은 말을 쓰지 않는다 — 「필터…」 는 2026-10-09 대표 결정", async () => {
    await renderMenu({ view: view({ canFilter: true }), column: { ...column, type: "select", label: "진행기관", options_jsonb: { options: [{ id: "a", label: "소진공", order: 0 }, { id: "b", label: "신보", order: 1 }] } } as BoardColumn });
    await openMenu("진행기관");
    const text = menu()!.textContent ?? "";
    for (const word of ["정렬", "그룹", "컬럼", "예:"]) expect(text).not.toContain(word);
    expect(labels()).toContain("필터…");
    expect(labels()).toContain("선택지 고치기");
    expect(labels()).toContain("가나다순");
  });

  it("정렬은 이 칸의 방향을 올리고, 걸려 있으면 체크 표시와 「원래 순서로」 가 생긴다", async () => {
    const onRequest = vi.fn();
    await renderMenu({ view: view({ onRequest }), column: { ...column, type: "date", key: "applied_on", label: "신청일" } as BoardColumn });
    await openMenu("신청일");
    expect(labels().slice(0, 2)).toEqual(["가까운 날짜순", "먼 날짜순"]);
    await click(item("먼 날짜순")!);
    expect(onRequest).toHaveBeenCalledWith({ kind: "sort", columnKey: "applied_on", direction: "desc" });
    expect(menu()).toBeNull();
    await nextFrame();
    expect(document.activeElement).toBe(title("신청일"));

    const sorted = vi.fn();
    await remount({ view: view({ onRequest: sorted, sortDirection: "asc" }) });
    await openMenu();
    expect(item("작은 금액순")!.getAttribute("aria-checked")).toBe("true");
    expect(item("큰 금액순")!.getAttribute("aria-checked")).toBe("false");
    await click(item("원래 순서로")!);
    expect(sorted).toHaveBeenCalledWith({ kind: "sort", columnKey: "amount", direction: null });
  });

  it("사람 칸은 「이름순」 하나", async () => {
    await renderMenu({ view: view(), canManage: false, column: { ...column, type: "person", label: "담당" } as BoardColumn });
    await openMenu("담당");
    expect(labels()).toEqual(["이름순", "숨기기"]);
  });

  it("필터… · 숨기기는 이 칸으로 요청을 올린다", async () => {
    const onRequest = vi.fn();
    const institution = { ...column, key: "institution", label: "진행기관", type: "select", options_jsonb: { options: [{ id: "a", label: "소진공", order: 0 }] } } as BoardColumn;
    await renderMenu({ view: view({ onRequest, canFilter: true }), column: institution });
    await openMenu("진행기관");
    await click(item("필터…")!);
    expect(onRequest).toHaveBeenLastCalledWith({ kind: "filter", columnKey: "institution" });
    expect(menu()).toBeNull();
    await openMenu("진행기관");
    await click(item("숨기기")!);
    expect(onRequest).toHaveBeenLastCalledWith({ kind: "hide", columnKey: "institution" });
  });

  it("필터 화면이 이 칸을 못 다루면 「필터…」 를 감춘다", async () => {
    await renderMenu({ view: view({ canFilter: false }), column: { ...column, type: "date", label: "신청일" } as BoardColumn });
    await openMenu("신청일");
    expect(item("필터…")).toBeUndefined();
  });

  it("옮기기는 끝에서 막히고, 고르면 한 칸 옮긴다", async () => {
    const move: ColumnMenuMove = { canLeft: false, canRight: true, onMove: vi.fn() };
    await renderMenu({ move });
    await openMenu();
    expect(item("왼쪽으로")!.getAttribute("aria-disabled")).toBe("true");
    await click(item("왼쪽으로")!);
    expect(move.onMove).not.toHaveBeenCalled();
    await click(item("오른쪽으로")!);
    expect(move.onMove).toHaveBeenCalledWith(1);
  });

  it("방향키로 항목을 오가고 Esc 로 닫으면 이름으로 초점이 돌아온다", async () => {
    await renderMenu({ view: view() });
    await openMenu();
    expect(document.activeElement).toBe(items()[0]);
    await key(menu()!, "ArrowDown");
    expect(document.activeElement).toBe(items()[1]);
    await key(menu()!, "Escape");
    await nextFrame();
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(title());
  });

  it("이름 바꾸기는 머리글의 같은 이름 편집칸을 연다(따로 이름 바꾸기 창이 없다)", async () => {
    await renderMenu();
    await openMenu();
    await click(item("이름 바꾸기")!);
    const input = document.querySelector<HTMLInputElement>('input[aria-label="칸 이름"]')!;
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(menu()).toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "지원 한도");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await key(input, "Enter");
    await act(async () => Promise.resolve());
    expect(rename).toHaveBeenCalledWith("board-a", "column-a", "지원 한도");
    expect(title("지원 한도")).toBeTruthy();
    await nextFrame();
    expect(document.activeElement).toBe(title("지원 한도"));
    expect(source).not.toContain('surface === "rename"');
  });
});

describe("칸 [모두] — 확인·저장 (#604 계약 유지)", () => {
  it("지우기는 window.confirm 이 아니라 제품 확인 창에서 결과를 한두 줄로 말하고 archive 를 보낸다", async () => {
    const reviewEnd = { ...column, key: "expected_review_end", label: "예상 심사 종료", type: "date" } as BoardColumn;
    const dday = { ...column, id: "c-dday", key: "review_dday", label: "ƒ심사 D-day", type: "calc", source: "calc", is_readonly: true } as BoardColumn;
    const dated = [rowOf("r1", { expected_review_end: "2026-10-01" }), rowOf("r2", { expected_review_end: null })];
    await renderMenu({ column: reviewEnd, rows: dated, catalog: [reviewEnd, dday] });
    await openMenu("예상 심사 종료");
    await click(item("지우기")!);
    expect(menu()).toBeNull();
    const dialog = document.querySelector('[role="dialog"]')!;
    const confirm = dialog.querySelector("[data-column-delete-confirm]")!;
    expect(confirm.textContent).toContain("‘예상 심사 종료’ 칸을 지울까요?");
    expect(confirm.textContent).toContain("값 1건이 함께 휴지통으로 가요 · 바로 「되돌리기」로 살릴 수 있어요");
    expect(confirm.textContent).toContain("「심사 D-day」 계산이 멈춰요");
    expect(confirm.textContent).not.toContain("7일");
    expect(source).not.toContain("window.confirm");
    await click([...dialog.querySelectorAll("button")].find((button) => button.textContent === "지우기")!);
    expect((command.mock.calls[0] as [unknown, FormData])[1].get("operation")).toBe("archive");
  });

  it("「입력 방식 바꾸기」 는 입력 방식 바꾸기와 기존 설정 화면을 한 창에 연다", async () => {
    await renderMenu();
    await openMenu();
    await click(item("입력 방식 바꾸기")!);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('section[aria-label="입력 방식"]')).not.toBeNull();
    expect(dialog.querySelector('section[aria-label="지원 금액 컬럼 설정"]')).not.toBeNull();
    await click([...dialog.querySelectorAll("button")].find((button) => button.textContent === "바꾸기")!);
    const sent = (command.mock.calls[0] as [unknown, FormData])[1];
    expect(sent.get("operation")).toBe("type_commit");
    expect(sent.get("targetType")).toBe("money");
  });

  it("명령 창은 서버 실패를 알리고 열린 채로 둔다", async () => {
    command.mockResolvedValueOnce({ ok: false, message: "권한이 없어요." });
    await renderMenu();
    await openMenu();
    await click(item("복사하기")!);
    const apply = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent === "복사하기")!;
    await click(apply);
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("권한이 없어요");
  });

  it("저장 중에는 같은 명령을 두 번 보내지 않는다", async () => {
    let finish: ((value: { ok: boolean; message: string }) => void) | undefined;
    command.mockImplementationOnce(() => new Promise((done) => { finish = done; }));
    await renderMenu();
    await openMenu();
    await click(item("복사하기")!);
    const apply = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent === "복사하기")!;
    act(() => { apply.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await act(async () => Promise.resolve());
    const pending = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "저장 중…")!;
    expect(pending.disabled).toBe(true);
    act(() => { pending.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(command).toHaveBeenCalledTimes(1);
    await act(async () => { finish?.({ ok: true, message: "저장했습니다." }); });
  });

  it("지운 칸의 되돌리기는 보드 쪽 알림이 든다", () => {
    expect(source).toContain("onArchived?.(result.archivedColumnId)");
    expect(workspace).toContain("archivedColumnIds");
    expect(workspace).toContain("칸을 휴지통으로 옮겼어요.");
  });
});
