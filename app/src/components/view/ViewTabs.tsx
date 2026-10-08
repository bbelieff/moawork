"use client";

/**
 * 뷰 탭 — #845 6단계 보기 줄의 왼쪽 끝. [메인 테이블 · 저장된 뷰(나만/팀) · ＋]
 *
 * · 지금 뷰의 조건이 저장된 것과 다르면 탭에 점이 찍히고 「바뀐 조건 N개」 가 풀이로 뜬다.
 * · 탭이 많으면 앞의 몇 개만 서고 나머지는 「더보기 ▾」 에 들어간다 — 칩·저장·찾기는 제자리를 지킨다.
 * · 지금 뷰를 바꿀 수 있는 사람(만든 사람·관리자)에게만 탭 옆 ▾(이름 바꾸기·지우기)가 있다.
 */

import { BoardAnchoredMenu } from "@/components/board/BoardAnchoredMenu";
import { Chevron, MenuItem, useMenuState } from "@/components/board/BoardHeaderMenus";
import type { SavedBoardView } from "@/lib/view/board-saved";
import { changedConditionsLabel } from "@/lib/view/view-conditions";
import styles from "./view.module.css";

/** 탭 줄에 바로 서는 저장된 뷰 수. 나머지는 「더보기 ▾」. */
export const INLINE_VIEW_TABS = 3;

export function visibilityTag(view: Pick<SavedBoardView, "visibility">): string {
  return view.visibility === "private" ? "나만" : "팀";
}

/** 줄에 설 뷰와 더보기로 갈 뷰. 지금 뷰는 늘 줄에 선다(더보기 안에 숨지 않는다). */
export function splitViewTabs(
  views: readonly SavedBoardView[],
  activeId: string | null,
  inline = INLINE_VIEW_TABS,
): { shown: SavedBoardView[]; more: SavedBoardView[] } {
  if (views.length <= inline) return { shown: [...views], more: [] };
  const shown = views.slice(0, inline);
  const active = views.find((view) => view.id === activeId);
  if (active && !shown.includes(active)) shown[shown.length - 1] = active;
  return { shown, more: views.filter((view) => !shown.includes(view)) };
}

export function ViewTabs({
  boardId = "view-tabs",
  views,
  activeId,
  dirtyCount = 0,
  onSelectMain,
  onSelect,
  onRequestCreate,
  onRequestManage,
}: {
  boardId?: string;
  views: readonly SavedBoardView[];
  activeId: string | null;
  /** 지금 뷰의 바뀐 조건 수(0 이면 점이 없다). */
  dirtyCount?: number;
  onSelectMain: () => void;
  onSelect: (view: SavedBoardView) => void;
  /** ＋ — 지금 조건으로 새 뷰를 만든다. 인자는 작은 저장 칸을 붙일 단추. */
  onRequestCreate?: (anchor: HTMLElement) => void;
  /** 지금 뷰 ▾ — 이름 바꾸기·지우기. 없으면 ▾ 가 없다. */
  onRequestManage?: (view: SavedBoardView, anchor: HTMLElement) => void;
}) {
  const { open: moreOpen, triggerRef: moreTriggerRef, menuRef: moreMenuRef, menuId: moreMenuId, close: moreClose, show: moreShow } = useMenuState(boardId);
  const { shown, more: overflow } = splitViewTabs(views, activeId);
  const activeView = views.find((view) => view.id === activeId) ?? null;
  const dot = (active: boolean) => active && dirtyCount > 0 ? (
    <>
      <span aria-hidden="true" data-view-dirty-dot className={styles.dirtyDot} />
      <span className="sr-only">{changedConditionsLabel(dirtyCount)}</span>
    </>
  ) : null;
  const tip = (active: boolean) => active && dirtyCount > 0 ? changedConditionsLabel(dirtyCount) : undefined;

  return (
    <nav className={styles.tabs} aria-label="뷰">
      <button
        type="button"
        data-view-tab="main"
        aria-current={activeId === null ? "page" : undefined}
        title={tip(activeId === null)}
        onClick={onSelectMain}
      >
        <span>메인 테이블</span>
        {dot(activeId === null)}
      </button>
      {shown.map((view) => {
        const active = view.id === activeId;
        return (
          <span key={view.id} className={styles.tabWrap}>
            <button
              type="button"
              data-view-tab={view.id}
              aria-current={active ? "page" : undefined}
              title={tip(active)}
              onClick={() => onSelect(view)}
            >
              <span>{view.name}</span>
              <small>{visibilityTag(view)}</small>
              {dot(active)}
            </button>
            {active && view.canEdit && onRequestManage ? (
              <button
                type="button"
                className={styles.tabMenu}
                aria-label={`${view.name} 뷰 메뉴`}
                aria-haspopup="menu"
                onClick={(event) => onRequestManage(view, event.currentTarget)}
              >
                <Chevron size={13} />
              </button>
            ) : null}
          </span>
        );
      })}
      {overflow.length > 0 ? (
        <>
          <button
            ref={moreTriggerRef}
            type="button"
            data-view-tab-more
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            aria-controls={moreOpen ? moreMenuId : undefined}
            onClick={() => (moreOpen ? moreClose(false) : moreShow())}
          >
            <span>더보기</span>
            <Chevron size={13} />
          </button>
          <BoardAnchoredMenu id={moreMenuId} open={moreOpen} anchorRef={moreTriggerRef} menuRef={moreMenuRef} label="다른 뷰" onClose={moreClose}>
            {overflow.map((view) => (
              <MenuItem
                key={view.id}
                role="menuitemradio"
                checked={view.id === activeView?.id}
                onClick={() => {
                  moreClose(false);
                  onSelect(view);
                }}
              >
                {view.name} · {visibilityTag(view)}
              </MenuItem>
            ))}
          </BoardAnchoredMenu>
        </>
      ) : null}
      {onRequestCreate ? (
        <button
          type="button"
          data-view-tab-create
          aria-label="새 뷰로 저장"
          onClick={(event) => onRequestCreate(event.currentTarget)}
        >
          ＋
        </button>
      ) : null}
    </nav>
  );
}
