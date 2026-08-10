"use client";

import { SYSTEM_VIEWS, type ViewKind } from "@/lib/view";
import styles from "./view.module.css";

const ICON: Record<ViewKind, string> = { board: "▦", flat: "☰", cal: "▤" };

/** 시스템 뷰 3종 전환 — 보드·표·캘린더(D25). «보드» 실제 렌더는 이 컴포넌트의 몫이 아니다. */
export function ViewTabs({ kind, onSelect }: { kind: ViewKind; onSelect: (kind: ViewKind) => void }) {
  return (
    <nav className={styles.tabs} aria-label="보기 방식">
      {SYSTEM_VIEWS.map((v) => (
        <button key={v.kind} type="button" aria-current={kind === v.kind ? "page" : undefined} onClick={() => onSelect(v.kind)}>
          <span aria-hidden>{ICON[v.kind]}</span>
          <span>{v.name}</span>
        </button>
      ))}
    </nav>
  );
}
