// @vitest-environment jsdom
/**
 * #845 개선안(2026-10-08) — 「탭 설정」 대화상자와 「휴지통으로 이동」 확인을 «그려진 결과와 행동» 으로 잰다.
 *   · 모달: 열면 초점이 안으로, Esc·바깥 누르기로 닫히고, 닫히면 연 단추로 초점이 돌아온다.
 *   · 칸: 일반 · 항목 · 단계 (탭 목록, 화살표로 옮김). 머리말에 칸 이름과 「바꾸면 바로 저장돼요」.
 *   · 일반: 이름(Enter·칸 떠나기 저장) · 아이콘 16개(누르면 바로 저장) · 설명. 고치던 글자의 Esc 는 되돌리기만.
 *   · 단계: ↑↓·이름 바꾸기·단계 추가가 각각 맞는 액션을 부른다. 지우기는 잠겨 있고 이유를 말한다.
 *   · 휴지통: 처음 초점은 「취소」, 확인하면 deleteBoardAction 폼이 boardId 를 보낸다.
 */
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardHeader } from "./BoardHeader";
import { TabSettingsDialog } from "./TabSettingsDialog";
import { TabSettingsGeneral } from "./TabSettingsGeneral";
import { TabSettingsStages } from "./TabSettingsStages";
import { TabTrashDialog } from "./TabTrashDialog";
import { TabChromeProvider, type TabSettingsSection } from "./tab-chrome";
import { TAB_ICON_KEYS } from "@/lib/boards/board-icons";
import type { TabStageRow } from "@/lib/boards/tab-settings";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

const stages: TabStageRow[] = [
  { id: "g1", name: "준비", accent: "var(--mw-tab-a-1)", rowCount: 2 },
  { id: "g2", name: "심사 중", accent: "var(--mw-tab-a-3)", rowCount: 0 },
  { id: "g3", name: "승인", accent: "var(--mw-tab-a-5)", rowCount: 1 },
];

function actions() {
  return {
    rename: vi.fn(async (_boardId: string, value: string) => ({ ok: true as const, name: value })),
    identity: vi.fn(async (_boardId: string, patch: { icon?: string; description?: string }) => ({ ok: true as const, ...patch })),
    reorder: vi.fn(async (formData: FormData) => { void formData; }),
    renameStage: vi.fn(async (_boardId: string, _groupId: string, value: string) => ({ ok: true as const, name: value })),
    add: vi.fn(async (formData: FormData) => { void formData; }),
    trash: vi.fn(async (formData: FormData) => { void formData; }),
  };
}

async function mount({
  sections = ["general", "fields", "stages"],
  withTrash = true,
  calls = actions(),
}: { sections?: TabSettingsSection[]; withTrash?: boolean; calls?: ReturnType<typeof actions> } = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const headerProps: ComponentProps<typeof BoardHeader> = {
    boardId: "b",
    icon: "💰",
    source: "core.default-tab/contact",
    name: "리드컨택 관리",
    description: "리드를 담당자와 계약 상황에 따라 관리한다",
    people: [],
    selected: [],
    groups: [],
    readOnly: true,
    canEditTitle: true,
  };
  await act(async () => root!.render(
    <TabChromeProvider
      settingsSections={sections}
      settings={(
        <TabSettingsDialog
          subtitles={{ general: "이름 · 아이콘 · 설명", fields: "3개", stages: "3개 · 진행현황과 연결" }}
          general={<TabSettingsGeneral boardId="b" name="리드컨택 관리" icon="💰" source="core.default-tab/contact" description="처음 설명" renameAction={calls.rename} identityAction={calls.identity} />}
          fields={<p>항목 관리 내용</p>}
          stages={<TabSettingsStages boardId="b" stages={stages} note="단계 = 보드예요." reorderAction={calls.reorder} renameAction={calls.renameStage} addAction={calls.add} />}
        />
      )}
      trash={withTrash ? (
        <TabTrashDialog boardId="b" title="‘리드컨택 관리’를 휴지통으로 옮길까요?" deleteAction={calls.trash}>
          <p>행 6 · 메모 4</p>
        </TabTrashDialog>
      ) : undefined}
    >
      <BoardHeader {...headerProps} />
    </TabChromeProvider>,
  ));
  return { host, calls };
}

const nextFrame = () => act(async () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())));
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="탭 설정"]');
const settingsButton = (host: ParentNode) => host.querySelector<HTMLButtonElement>("button[data-board-tab-settings]")!;
const tab = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((node) => node.textContent === label)!;
const press = (target: Element, key: string, init: KeyboardEventInit = {}) =>
  act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })); });
const buttonNamed = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const typeInto = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

async function openFromHeader(host: HTMLElement) {
  const opener = settingsButton(host);
  opener.focus();
  await act(async () => opener.click());
  await nextFrame();
  return opener;
}

describe("탭 설정 대화상자 — 모달", () => {
  it("닫혀 있다가 「탭 설정」 을 누르면 열리고, 초점이 지금 칸의 탭으로 들어간다", async () => {
    const { host } = await mount();
    expect(dialog()).toBeNull();
    await openFromHeader(host);
    const surface = dialog()!;
    expect(surface.getAttribute("aria-modal")).toBe("true");
    expect(surface.parentElement).toBe(document.body);
    expect(document.activeElement).toBe(tab("일반"));
    expect(surface.textContent).toContain("바꾸면 바로 저장돼요");
    expect(surface.querySelector("h2")?.textContent).toBe("일반");
    expect(surface.textContent).toContain("이름 · 아이콘 · 설명");
  });

  it("Esc 로 닫히고 연 단추로 초점이 돌아온다", async () => {
    const { host } = await mount();
    const opener = await openFromHeader(host);
    await press(document.activeElement!, "Escape");
    expect(dialog()).toBeNull();
    await nextFrame();
    expect(document.activeElement).toBe(opener);
  });

  it("바깥(덮개)을 누르면 닫히고, 「닫기」 단추도 닫는다", async () => {
    const { host } = await mount();
    await openFromHeader(host);
    await act(async () => {
      document.querySelector("[data-board-modal-scrim]")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(dialog()).toBeNull();
    await openFromHeader(host);
    await act(async () => buttonNamed("닫기").click());
    expect(dialog()).toBeNull();
  });

  it("Tab 은 대화상자 안에서만 돈다", async () => {
    const { host } = await mount();
    await openFromHeader(host);
    const focusables = [...dialog()!.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),[tabindex]:not([tabindex='-1'])")];
    const last = focusables[focusables.length - 1];
    last.focus();
    await press(last, "Tab");
    expect(dialog()!.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(focusables[0]);
  });

  it("▾ 메뉴로 열면 닫힌 뒤 ▾ 단추로 초점이 돌아온다", async () => {
    const { host } = await mount();
    const trigger = host.querySelector<HTMLButtonElement>("button[data-board-tab-menu-trigger]")!;
    await act(async () => trigger.click());
    const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((node) => node.textContent === "탭 설정…")!;
    await act(async () => item.click());
    await nextFrame();
    expect(dialog()).not.toBeNull();
    await press(document.activeElement!, "Escape");
    await nextFrame();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("탭 설정 대화상자 — 칸 바꾸기", () => {
  it("탭을 누르거나 화살표로 칸을 바꾸고, 마지막 칸을 기억한다", async () => {
    const { host } = await mount();
    await openFromHeader(host);
    expect(tab("일반").getAttribute("aria-selected")).toBe("true");
    await act(async () => tab("항목").click());
    expect(dialog()!.querySelector('[role="tabpanel"]')?.textContent).toContain("항목 관리 내용");
    expect(dialog()!.querySelector("h2")?.textContent).toBe("항목(컬럼)");

    tab("항목").focus();
    await press(tab("항목"), "ArrowDown");
    expect(tab("단계").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("단계"));
    expect(dialog()!.textContent).toContain("3개 · 진행현황과 연결");
    await press(tab("단계"), "ArrowDown");
    expect(tab("일반").getAttribute("aria-selected")).toBe("true");
    await press(tab("일반"), "End");
    expect(tab("단계").getAttribute("aria-selected")).toBe("true");

    await press(document.activeElement!, "Escape");
    await nextFrame();
    await openFromHeader(host);
    expect(tab("단계").getAttribute("aria-selected")).toBe("true");
  });

  it("권한이 있는 칸만 보인다", async () => {
    const { host } = await mount({ sections: ["fields"] });
    await openFromHeader(host);
    expect([...document.querySelectorAll('[role="tab"]')].map((node) => node.textContent)).toEqual(["항목"]);
  });
});

describe("탭 설정 › 일반", () => {
  it("아이콘 16개 중 저장된 것(옛 이모지도)이 골라져 있고, 누르면 바로 저장한다", async () => {
    const { host, calls } = await mount();
    await openFromHeader(host);
    const options = [...dialog()!.querySelectorAll<HTMLButtonElement>("[data-tab-icon-option]")];
    expect(options.map((node) => node.dataset.tabIconOption)).toEqual([...TAB_ICON_KEYS]);
    expect(options.filter((node) => node.getAttribute("aria-pressed") === "true").map((node) => node.dataset.tabIconOption)).toEqual(["phone"]);
    await act(async () => buttonNamed("별").click());
    expect(calls.identity).toHaveBeenCalledWith("b", { icon: "star" });
    expect(buttonNamed("별").getAttribute("aria-pressed")).toBe("true");
    expect(buttonNamed("전화").getAttribute("aria-pressed")).toBe("false");
    expect(dialog()!.querySelector("[data-tab-settings-notice]")?.textContent).toContain("아이콘");
  });

  it("저장이 거절되면 원래 아이콘으로 돌아가고 이유를 알린다", async () => {
    const calls = actions();
    calls.identity.mockResolvedValueOnce({ ok: false, message: "탭을 고칠 권한이 없어요." } as never);
    const { host } = await mount({ calls });
    await openFromHeader(host);
    await act(async () => buttonNamed("깃발").click());
    expect(buttonNamed("깃발").getAttribute("aria-pressed")).toBe("false");
    expect(buttonNamed("전화").getAttribute("aria-pressed")).toBe("true");
    const notice = dialog()!.querySelector("[data-tab-settings-notice]")!;
    expect(notice.getAttribute("role")).toBe("alert");
    expect(notice.textContent).toBe("탭을 고칠 권한이 없어요.");
  });

  it("「아이콘 바꾸기」·「설명 고치기」 로 열면 그 칸에 초점이 간다", async () => {
    const { host } = await mount();
    const trigger = host.querySelector<HTMLButtonElement>("button[data-board-tab-menu-trigger]")!;
    await act(async () => trigger.click());
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((node) => node.textContent === "아이콘 바꾸기")!.click());
    await nextFrame();
    expect(document.activeElement).toBe(buttonNamed("전화"));
    await press(document.activeElement!, "Escape");
    await nextFrame();
    await act(async () => trigger.click());
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((node) => node.textContent === "설명 고치기")!.click());
    await nextFrame();
    expect((document.activeElement as HTMLInputElement).value).toBe("처음 설명");
  });

  it("이름은 Enter 로, 설명은 칸을 떠날 때 저장한다", async () => {
    const { host, calls } = await mount();
    await openFromHeader(host);
    const [name, description] = [...dialog()!.querySelectorAll<HTMLInputElement>("[data-tab-settings-general] input")];
    name.focus();
    await typeInto(name, "  새 이름 ");
    await press(name, "Enter");
    expect(calls.rename).toHaveBeenCalledWith("b", "새 이름");
    expect(name.value).toBe("새 이름");
    expect(document.activeElement).toBe(name);

    description.focus();
    await typeInto(description, "바뀐 설명");
    await act(async () => { description.blur(); });
    expect(calls.identity).toHaveBeenCalledWith("b", { description: "바뀐 설명" });
  });

  it("고치던 글자가 있을 때 Esc 는 되돌리기만 하고, 다음 Esc 에 닫힌다", async () => {
    const { host, calls } = await mount();
    await openFromHeader(host);
    const name = dialog()!.querySelector<HTMLInputElement>("[data-tab-settings-general] input")!;
    name.focus();
    await typeInto(name, "고치는 중");
    await press(name, "Escape");
    expect(dialog()).not.toBeNull();
    expect(name.value).toBe("리드컨택 관리");
    expect(calls.rename).not.toHaveBeenCalled();
    await press(name, "Escape");
    expect(dialog()).toBeNull();
  });

  it("빈 이름은 저장하지 않는다", async () => {
    const { host, calls } = await mount();
    await openFromHeader(host);
    const name = dialog()!.querySelector<HTMLInputElement>("[data-tab-settings-general] input")!;
    name.focus();
    await typeInto(name, "   ");
    await press(name, "Enter");
    expect(calls.rename).not.toHaveBeenCalled();
    expect(name.value).toBe("리드컨택 관리");
    expect(dialog()!.querySelector("[data-tab-settings-notice]")?.textContent).toBe("탭 이름을 입력해 주세요.");
  });

  it("휴지통 안내는 지울 수 있을 때만 보인다", async () => {
    const first = await mount();
    await openFromHeader(first.host);
    expect(dialog()!.textContent).toContain("제목 옆 ▾ 메뉴에서 「휴지통으로 이동」");
    await act(async () => root?.unmount());
    root = null;
    document.body.replaceChildren();
    const second = await mount({ withTrash: false });
    await openFromHeader(second.host);
    expect(dialog()!.textContent).not.toContain("휴지통으로 이동");
  });
});

describe("탭 설정 › 단계", () => {
  async function openStages() {
    const mounted = await mount();
    await openFromHeader(mounted.host);
    await act(async () => tab("단계").click());
    return mounted;
  }
  const rowNames = () => [...dialog()!.querySelectorAll("[data-tab-stage-row]")].map((row) => row.getAttribute("data-tab-stage-row"));

  it("한 줄 안내·색 점·행 수를 보이고, ↑↓ 는 그룹 순서 저장 액션을 부른다", async () => {
    const { calls } = await openStages();
    expect(dialog()!.querySelector("[data-tab-stage-note]")?.textContent).toContain("단계 = 보드예요.");
    expect((dialog()!.querySelector("[data-tab-stage-dot]") as HTMLElement).style.background).toBe("var(--mw-tab-a-1)");
    expect(dialog()!.textContent).toContain("2건");

    await act(async () => buttonNamed("심사 중 아래로").click());
    expect(rowNames()).toEqual(["g1", "g3", "g2"]);
    const sent = calls.reorder.mock.calls[0][0];
    expect(sent.get("boardId")).toBe("b");
    expect(JSON.parse(String(sent.get("groupIds")))).toEqual(["g1", "g3", "g2"]);

    // 맨 위의 「위로」 는 잠겨 있고 눌러도 부르지 않는다(초점은 그대로 둔다).
    const up = buttonNamed("준비 위로");
    expect(up.getAttribute("aria-disabled")).toBe("true");
    await act(async () => up.click());
    expect(calls.reorder).toHaveBeenCalledTimes(1);
  });

  it("「이름 바꾸기」 는 그 자리 입력칸을 열고 Enter 로 그룹 이름 액션을 부른다 — Esc 는 취소", async () => {
    const { calls } = await openStages();
    await act(async () => buttonNamed("승인 이름 바꾸기").click());
    const input = dialog()!.querySelector<HTMLInputElement>('input[aria-label="승인 단계 이름"]')!;
    expect(document.activeElement).toBe(input);
    await typeInto(input, "최종 승인");
    await press(input, "Enter");
    expect(calls.renameStage).toHaveBeenCalledWith("b", "g3", "최종 승인");
    expect(dialog()!.textContent).toContain("최종 승인");

    await act(async () => buttonNamed("준비 이름 바꾸기").click());
    const second = dialog()!.querySelector<HTMLInputElement>('input[aria-label="준비 단계 이름"]')!;
    await typeInto(second, "버릴 이름");
    await press(second, "Escape");
    expect(dialog()).not.toBeNull();
    expect(dialog()!.querySelector('input[aria-label="준비 단계 이름"]')).toBeNull();
    expect(calls.renameStage).toHaveBeenCalledTimes(1);
  });

  it("「단계 추가」 는 이름을 받아 그룹 추가 액션을 부른다", async () => {
    const { calls } = await openStages();
    await act(async () => dialog()!.querySelector<HTMLButtonElement>("[data-tab-stage-add]")!.click());
    const input = dialog()!.querySelector<HTMLInputElement>('input[aria-label="새 단계 이름"]')!;
    await typeInto(input, "서류 준비");
    await act(async () => { dialog()!.querySelector<HTMLFormElement>("[data-tab-stage-add-form]")!.requestSubmit(); });
    const sent = calls.add.mock.calls[0][0];
    expect(sent.get("boardId")).toBe("b");
    expect(sent.get("name")).toBe("서류 준비");
    expect(input.value).toBe("");
  });

  it("지우기는 잠겨 있고, 행이 남은 단계는 이유를 말한다", async () => {
    await openStages();
    const remove = buttonNamed("준비 지우기");
    expect(remove.getAttribute("aria-disabled")).toBe("true");
    const reason = document.getElementById(remove.getAttribute("aria-describedby")!)!;
    expect(reason.textContent).toContain("행이 2건 남아 있어 지울 수 없어요");
    expect(buttonNamed("심사 중 지우기").getAttribute("aria-disabled")).toBe("true");
  });
});

describe("「휴지통으로 이동」 확인", () => {
  it("▾ 메뉴로 열면 처음 초점이 「취소」 이고, 취소하면 ▾ 로 돌아온다", async () => {
    const { host, calls } = await mount();
    const trigger = host.querySelector<HTMLButtonElement>("button[data-board-tab-menu-trigger]")!;
    await act(async () => trigger.click());
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((node) => node.textContent === "휴지통으로 이동")!.click());
    await nextFrame();
    const confirm = document.querySelector<HTMLElement>("[data-tab-trash-dialog]")!;
    expect(confirm.closest('[role="dialog"]')?.getAttribute("aria-labelledby")).toBe(confirm.querySelector("h2")?.id);
    expect(confirm.textContent).toContain("‘리드컨택 관리’를 휴지통으로 옮길까요?");
    expect(confirm.textContent).toContain("행 6 · 메모 4");
    expect(document.activeElement?.textContent).toBe("취소");
    await act(async () => (document.activeElement as HTMLButtonElement).click());
    expect(document.querySelector("[data-tab-trash-dialog]")).toBeNull();
    expect(calls.trash).not.toHaveBeenCalled();
    await nextFrame();
    expect(document.activeElement).toBe(trigger);
  });

  it("확인하면 같은 휴지통 액션이 boardId 를 받는다", async () => {
    const { host, calls } = await mount();
    await act(async () => host.querySelector<HTMLButtonElement>("button[data-board-tab-menu-trigger]")!.click());
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((node) => node.textContent === "휴지통으로 이동")!.click());
    const form = document.querySelector<HTMLFormElement>("[data-tab-trash-dialog] form")!;
    const submit = [...form.querySelectorAll("button")].find((node) => node.textContent === "휴지통으로 이동")!;
    await act(async () => { form.requestSubmit(submit); });
    expect(calls.trash).toHaveBeenCalledTimes(1);
    expect(calls.trash.mock.calls[0][0].get("boardId")).toBe("b");
  });

  it("지울 권한이 없으면 메뉴에 「휴지통으로 이동」 이 없다", async () => {
    const { host } = await mount({ withTrash: false });
    await act(async () => host.querySelector<HTMLButtonElement>("button[data-board-tab-menu-trigger]")!.click());
    expect([...document.querySelectorAll('[role="menuitem"]')].map((node) => node.textContent)).not.toContain("휴지통으로 이동");
  });
});
