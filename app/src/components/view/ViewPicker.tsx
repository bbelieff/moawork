"use client";

import { dynamicBadge, isSystemView, splitByVisibility, type ResolvedView, type TabView } from "@/lib/view";
import styles from "./view.module.css";

/**
 * «화면» 드롭다운(D25) — 회사 공용 / 나만 보기로 갈라 보여준다.
 * D26: dynamicBadge 로 «나»/«내 팀» 표시 — 보는 사람에 따라 결과가 달라진다는 신호.
 * 목록 자체는 이미 RLS로 걸러져 들어온다(나만 뷰는 본인 것만) — 여기서 다시 권한 판단을 하지 않는다.
 */
export function ViewPicker({
  views,
  current,
  currentUserId,
  hiddenCount,
  onSelect,
  onRequestSave,
}: {
  views: readonly TabView[];
  current: ResolvedView;
  currentUserId: string;
  /** 조회 범위 밖이라 숨겨진 건수(D24). 0 또는 undefined면 배지를 안 보여준다. */
  hiddenCount?: number;
  onSelect: (view: ResolvedView) => void;
  onRequestSave: () => void;
}) {
  const { shared, private: mine } = splitByVisibility(views, currentUserId);
  const label = isSystemView(current) ? "전체" : current.name;

  const row = (view: TabView) => {
    const badge = dynamicBadge(view);
    const isCurrent = !isSystemView(current) && current.id === view.id;
    return (
      <button key={view.id} type="button" className={styles.pickerItem} aria-current={isCurrent} onClick={() => onSelect(view)}>
        <span style={{ flex: 1 }}>
          {view.name}
          {badge ? <span className={styles.pickerBadge}>{badge}</span> : null}
        </span>
        {isCurrent ? <span aria-hidden>✓</span> : null}
      </button>
    );
  };

  return (
    <details className={styles.picker}>
      <summary>
        <span className={styles.pickerLabel}>화면</span>
        {label}
      </summary>
      <div className={styles.pickerMenu}>
        <button type="button" className={styles.pickerItem} onClick={() => onSelect({ system: true, kind: isSystemView(current) ? current.kind : "board", name: "전체" })}>
          <span style={{ flex: 1 }}>
            전체
            <span className={styles.pickerHint}>조건 없이 모두</span>
          </span>
          {isSystemView(current) ? <span aria-hidden>✓</span> : null}
        </button>
        {shared.length ? (
          <>
            <div className={styles.pickerGroup}>회사 공용</div>
            {shared.map(row)}
          </>
        ) : null}
        {mine.length ? (
          <>
            <div className={styles.pickerGroup}>나만 보기</div>
            {mine.map(row)}
          </>
        ) : null}
        <button type="button" className={styles.pickerNew} onClick={onRequestSave}>
          + 지금 조건을 저장
        </button>
      </div>
      {hiddenCount ? (
        <span className={styles.hiddenNotice} role="status">
          🔒 권한 밖 {hiddenCount}건 숨김
        </span>
      ) : null}
    </details>
  );
}
