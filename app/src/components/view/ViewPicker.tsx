"use client";

import { useState } from "react";
import type { SavedBoardView } from "@/lib/view/board-saved";
import styles from "./view.module.css";

/** 활성 저장 뷰의 관리 메뉴. 앱 이동이나 뷰 선택을 다시 복제하지 않는다. */
export function ViewPicker({
  view,
  editable,
  onRename,
  onDelete,
}: {
  view: SavedBoardView | null;
  editable: boolean;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(view?.name ?? "");
  if (!view) return null;
  return (
    <details className={styles.picker}>
      <summary aria-label={`${view.name} 뷰 관리`}>뷰 관리</summary>
      <div className={styles.pickerMenu}>
        <label className={styles.field}>
          <span>이름</span>
          <input value={name} disabled={!editable} onChange={(event) => setName(event.target.value)} />
        </label>
        {editable ? (
          <>
            <button type="button" className={styles.pickerItem} disabled={!name.trim()} onClick={() => onRename(name.trim())}>이름 저장</button>
            <button type="button" className={styles.pickerNew} onClick={onDelete}>뷰 삭제</button>
          </>
        ) : null}
        {!editable ? <p className={styles.pickerHint}>공용 뷰는 만든 사람 또는 회사 관리자가 편집합니다.</p> : null}
      </div>
    </details>
  );
}
