"use client";

/**
 * 탭 머리말 — #845 개선안(2026-10-08 대표 결정, 승인 목업 「개선안」 Header 판).
 *
 *   [←] [아이콘 22px] 탭 이름 [▾] [ⓘ] ……………… [탭 설정] [＋ 새 항목]
 *
 * 그 아래 보기 줄(뷰 탭 · 보기 조건 칩 · 저장 · 찾기)은 #845 6단계부터 BoardViewBar 한 줄이 맡는다
 * (예전 둘째 줄의 테이블·칸반 탭과 「담당자 · 전체 ▾」 는 그 줄의 「표 ▾」·「담당」 칩이 되었다).
 *
 * · 바탕은 화면 바탕 그대로다 — 색 띠·색 칸이 없다. 탭 색은 아이콘 선·주 단추·선택 표시에만 쓴다.
 *   채운 단추는 주 단추 하나(그라디언트 없이 탭 색 단색).
 * · 아이콘은 이모지 대신 선 아이콘 한 벌(lib/boards/board-icons.ts)이다. 옛 저장값(💡 등)도 같은 그림으로 그린다.
 * · 탭에 대한 일(이름·아이콘·설명·설정·휴지통)은 제목 옆 ▾ 메뉴에 모은다. 설명은 ⓘ 에 올리면 보인다.
 * · 「＋ 새 항목」 은 헤더 줄 안의 버튼이고 입력은 그 자리에 붙는 팝오버다(원칙 3 — 떠 있는 분리형 패널 금지).
 *
 * 이 줄이 시각 계약의 board-header 블록이다(제목·주 단추가 한 줄).
 */

import { useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { BoardGroup } from "@/lib/boards/types";
import { resolveBoardIconKey } from "@/lib/boards/board-icons";
import { addItemAction } from "@/app/(app)/boards/actions";
import { renameBoardTitleAction } from "@/app/(app)/boards/title-actions";
import { BoardInlineTitleEditor, type BoardInlineTitleEditorHandle } from "./BoardInlineTitleEditor";
import { DescriptionHint, TabSettingsButton, TabTitleMenu } from "./BoardHeaderMenus";
import { TabIcon } from "./TabIcon";
import { useTabChrome, type TabSettingsOpenRequest } from "./tab-chrome";

export function BoardHeader({
  boardId,
  icon,
  source,
  name,
  description,
  groups,
  readOnly,
  backSlot,
  helpSlot,
  addItemSlot,
  canEditTitle = false,
  onOpenSettings,
  onRequestTrash,
}: {
  boardId: string;
  /** 보드에 저장된 아이콘 값(아이콘 키·옛 이모지·빈 값). 그릴 때만 해석한다. */
  icon: string | null;
  /** 탭 출처 — 저장된 아이콘이 없거나 모를 때 기본 아이콘을 정한다. */
  source?: string | null;
  name: string;
  description: string | null;
  /** 상위 화면으로 돌아가는 링크(서버에서 렌더해 내려준다). */
  backSlot?: ReactNode;
  /** 제목 바로 옆의 짧은 도움말. */
  helpSlot?: ReactNode;
  /** 보드별 기본 등록 폼. 신규리드는 회사 기본 정보를 함께 저장하는 전용 폼을 쓴다. */
  addItemSlot?: ReactNode;
  groups: readonly BoardGroup[];
  readOnly: boolean;
  canEditTitle?: boolean;
  /**
   * 「탭 설정」 을 연다. 없으면 감싼 TabChromeProvider 의 것을 쓰고, 그것도 없으면
   * 오른쪽 위 단추와 ▾ 메뉴의 설정 항목을 감춘다.
   */
  onOpenSettings?: (request: TabSettingsOpenRequest) => void;
  /** 「휴지통으로 이동」 확인을 연다. 없으면 제공자의 것, 그것도 없으면 ▾ 메뉴에서 감춘다(권한 없음·시스템 보드). */
  onRequestTrash?: (opener: HTMLElement | null) => void;
}) {
  const titleRef = useRef<BoardInlineTitleEditorHandle>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  // 이름 편집을 ▾ 메뉴에서 시작했는가 — 끝나면 초점을 그 ▾ 로, 아니면 제목으로 돌려준다.
  const renameFromMenuRef = useRef(false);
  const chrome = useTabChrome();
  const openSettings = onOpenSettings ?? chrome?.openSettings;
  const requestTrash = onRequestTrash ?? chrome?.requestTrash;
  // 제공자가 정한 칸만 연다 — 일반 칸이 없으면(탭 관리 권한 없음) 「아이콘·설명」 항목을 감춘다.
  const canEditGeneral = onOpenSettings ? true : Boolean(chrome?.settingsSections.includes("general"));
  const iconKey = resolveBoardIconKey(icon, source);

  return (
    <div ref={headerRef} data-visual-block="board-header" className="relative flex min-w-0 max-w-full items-center gap-3">
      <div className="mw-board-inline-scroll flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-x-auto overflow-y-hidden pe-2 [scroll-padding-inline-end:0.5rem]">
        {backSlot}

        <h1 className="flex shrink-0 items-center gap-2 text-[length:var(--fs-18)] font-semibold tracking-[var(--ls-tight)] text-mw-fg sm:text-[length:var(--fs-22)]">
          <TabIcon name={iconKey} size={22} style={{ color: "var(--mw-tab-icon, var(--mw-record))" }} />
          {canEditTitle ? (
            <BoardInlineTitleEditor
              ref={titleRef}
              name={name}
              label="보드 이름"
              onSave={(value) => renameBoardTitleAction(boardId, value)}
              onEditEnd={() => {
                const fromMenu = renameFromMenuRef.current;
                renameFromMenuRef.current = false;
                window.requestAnimationFrame(() => {
                  // 편집칸이 사라져 초점을 잃었을 때만 돌려준다(그새 다른 곳을 눌렀으면 그대로).
                  const active = document.activeElement;
                  if (active && active !== document.body) return;
                  headerRef.current?.querySelector<HTMLElement>(fromMenu ? "button[data-board-tab-menu-trigger]" : "h1 button")?.focus();
                });
              }}
            />
          ) : (
            <span>{name}</span>
          )}
        </h1>
        <TabTitleMenu
          boardId={boardId}
          tabName={name}
          onRename={canEditTitle ? () => {
            renameFromMenuRef.current = true;
            titleRef.current?.beginEdit();
          } : undefined}
          onOpenSettings={openSettings}
          canEditGeneral={canEditGeneral}
          onRequestTrash={requestTrash}
        />
        {description ? <DescriptionHint text={description} /> : null}
        {helpSlot}
      </div>

      <div data-board-action-rail className="mw-layer-board-header relative z-[var(--mw-layer-board-header)] flex shrink-0 items-center gap-2 bg-mw-bg">
        {openSettings ? <TabSettingsButton onOpen={(opener) => openSettings({ opener })} /> : null}

        {!readOnly && groups.length > 0 && (addItemSlot ?? (
          <details name="mw-board-header" className="relative shrink-0">
            <summary data-mw-cta="primary" className="flex h-[34px] cursor-pointer select-none items-center rounded-[var(--mw-r-2)] bg-mw-primary px-3.5 text-[length:var(--fs-13)] font-semibold text-mw-on-accent list-none [&::-webkit-details-marker]:hidden">
              ＋ 새 항목
            </summary>

            <form
              action={addItemAction}
              className="mw-layer-page-popover absolute end-0 top-full mt-1 flex w-64 flex-col gap-2 rounded-md border border-mw-line bg-mw-card p-2 shadow-lg"
            >
              <input type="hidden" name="boardId" value={boardId} />
              <input
                name="title"
                required
                placeholder="항목 이름"
                aria-label="항목 이름"
                className="h-9 rounded-lg border border-mw-line bg-mw-card px-2 text-xs text-mw-fg outline-none focus:border-mw-record"
              />
              <select
                name="groupId"
                defaultValue={groups[0]?.id ?? ""}
                aria-label="그룹"
                className="h-9 rounded-lg border border-mw-line bg-mw-card px-2 text-xs text-mw-fg outline-none focus:border-mw-record"
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <AddItemSubmitButton />
            </form>
          </details>
        ))}
      </div>
    </div>
  );
}

/** Issue 857 — 저장하는 동안 잠그고 그렇다고 말한다. 전에는 1~5초 동안 아무 표시가 없어 두 번 눌렸다. */
function AddItemSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      data-mw-cta="primary"
      disabled={pending}
      aria-busy={pending || undefined}
      className="h-9 rounded-lg bg-mw-primary text-xs font-semibold text-mw-on-accent disabled:opacity-60"
    >
      {pending ? "추가하는 중…" : "추가"}
    </button>
  );
}
