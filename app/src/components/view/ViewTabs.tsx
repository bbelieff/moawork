"use client";

import type { SavedBoardView } from "@/lib/view/board-saved";
import styles from "./view.module.css";

export function ViewTabs({
  views,
  activeId,
  onSelectMain,
  onSelect,
  onRequestCreate,
}: {
  views: readonly SavedBoardView[];
  activeId: string | null;
  onSelectMain: () => void;
  onSelect: (view: SavedBoardView) => void;
  onRequestCreate: () => void;
}) {
  return (
    <nav className={styles.tabs} aria-label="현재 보드의 저장 뷰">
      <button type="button" aria-current={activeId === null ? "page" : undefined} onClick={onSelectMain}>
        <span aria-hidden>▦</span><span>메인 테이블</span>
      </button>
      {views.map((view) => (
        <button key={view.id} type="button" aria-current={activeId === view.id ? "page" : undefined} onClick={() => onSelect(view)}>
          <span>{view.name}</span>
          <small>{view.visibility === "private" ? "나만" : "공용"}</small>
        </button>
      ))}
      <button type="button" aria-label="새 저장 뷰 만들기" onClick={onRequestCreate}>＋</button>
    </nav>
  );
}
