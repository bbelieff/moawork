"use client";

// BBE-105 · 이중 잠금 켜기/끄기 설정 행 — D66.
//
// belie 지적(온보딩 녹취): "이 허들은 조금 없애 달라라고 하면 없애줄 수는 있는데" —
// MoaWork 는 여러 회사가 쓰는 제품이라 이 안전장치를 원하지 않는 회사도 있다. 대신
// ①왜 있는지 한 줄로 보여주고 ②끌 때 사유를 받아 ③끈 기록을 남긴다.
//
// 영속화 경계: 이 컴포넌트는 저장을 모른다. `enabled`·`lastAudit` 는 props 로 받고,
// 제출은 `onSubmit` 콜백에 위임한다(실제 RPC·마이그레이션은 이 카드 리스 밖).

import { useState } from "react";
import type { LockToggleAudit } from "@/lib/automation/lock";
import styles from "./lock.module.css";

export interface LockToggleSettingsRowProps {
  enabled: boolean;
  /** 가장 최근 스위치 변경 기록. 없으면 아직 아무도 바꾸지 않았다. */
  lastAudit?: LockToggleAudit | null;
  /** 끌 때는 reason 이 채워져 있다(부모가 decideLockToggle 로 검증한 뒤 호출해도 되고,
   * 이 컴포넌트가 먼저 빈 사유를 막아 제출 자체를 보낸다). */
  onSubmit: (next: { enabled: boolean; reason: string | null }) => void;
  /** 끄기를 제출했지만 사유가 비어 있어 상위에서 거부했을 때 보여줄 문구. */
  error?: string | null;
}

export function LockToggleSettingsRow({
  enabled,
  lastAudit,
  onSubmit,
  error,
}: Readonly<LockToggleSettingsRowProps>) {
  const [reasonDraft, setReasonDraft] = useState("");
  const [showReasonForm, setShowReasonForm] = useState(false);

  function handleToggleClick() {
    if (enabled) {
      setShowReasonForm(true);
      return;
    }
    onSubmit({ enabled: true, reason: null });
  }

  function handleReasonSubmit() {
    onSubmit({ enabled: false, reason: reasonDraft });
  }

  return (
    <div className={styles.toggleRow}>
      <div className={styles.toggleCopy}>
        <strong>이중 잠금</strong>
        <span>
          대표 직인 승인 전에는 리드컨택 건이 업무관리로 넘어가지 않아요. 오클릭으로
          준비 안 된 건이 실무로 넘어가는 사고를 막는 안전장치예요.
        </span>
        {lastAudit ? (
          <span className={styles.audit}>
            마지막 변경: {lastAudit.actor} · {lastAudit.enabled ? "켬" : "끔"}
            {lastAudit.reason ? ` · ${lastAudit.reason}` : ""}
          </span>
        ) : null}
        {showReasonForm ? (
          <div className={styles.reasonForm}>
            <textarea
              aria-label="이중 잠금을 끄는 이유"
              placeholder="왜 끄는지 적어주세요 — 이 기록은 남습니다"
              value={reasonDraft}
              onChange={(event) => setReasonDraft(event.target.value)}
            />
            {error ? <p className={styles.error}>{error}</p> : null}
            <div className={styles.actions}>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleReasonSubmit}>
                끄고 기록 남기기
              </button>
              <button
                type="button"
                className={styles.btn}
                onClick={() => {
                  setShowReasonForm(false);
                  setReasonDraft("");
                }}
              >
                취소
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className={`${styles.toggleSwitch} ${enabled ? styles.toggleSwitchOn : ""}`}
        aria-pressed={enabled}
        onClick={handleToggleClick}
      >
        {enabled ? "켜짐" : "꺼짐"}
      </button>
    </div>
  );
}
