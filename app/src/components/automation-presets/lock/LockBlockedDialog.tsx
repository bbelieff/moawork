"use client";

// BBE-105 · 차단 다이얼로그 — D36.
//
// 핵심 규칙(카드 원문): "막기만 하면 실패다. «무엇이 빠졌는지» 와 «어디를 눌러 채우는지» 를
// 같이 보여줘야 한다." 그래서 이 컴포넌트는 막힌 사유 각각에 «채우러 가기» 버튼을 붙여
// 렌더링한다. 이동 대상(어느 화면·어느 칸으로 갈지)은 이 컴포넌트가 모른다 — 호출부가
// `onNavigateToCondition` 으로 받는다. 그래야 어떤 보드에서 쓰이든 재사용된다.
//
// 조용한 실패 금지(카드 원문) — 조건이 없으면(unmet 비어있음) 아무것도 그리지 않는다.
// 즉 "떠 있다 = 실제로 막혔다"가 항상 성립한다.

import type { LockCondition } from "@/lib/automation/lock";
import styles from "./lock.module.css";

export interface LockBlockedDialogProps {
  /** 이번 시도에서 미충족인 조건 전부. 비어 있으면 아무것도 렌더링하지 않는다. */
  unmet: readonly LockCondition[];
  /** «‹조건 이름› 채우러 가기» 클릭 — 그 조건을 채울 화면/칸으로 이동시킨다. */
  onNavigateToCondition: (key: string) => void;
  /** 있으면 조건별로 "요청 보내기" 보조 액션을 추가로 보여준다(목업의 «직인 승인 요청 보내기»). */
  onRequestApproval?: (key: string) => void;
  canNavigateToCondition?: (key: string) => boolean;
  approvalPending?: boolean;
  approvalFeedback?: { ok: boolean; message: string } | null;
  onClose: () => void;
}

export function LockBlockedDialog({
  unmet,
  onNavigateToCondition,
  onRequestApproval,
  canNavigateToCondition = () => true,
  approvalPending = false,
  approvalFeedback = null,
  onClose,
}: Readonly<LockBlockedDialogProps>) {
  if (unmet.length === 0) return null;

  return (
    <div className={styles.overlay} role="presentation" onClick={onClose}>
      <div
        className={styles.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="lock-blocked-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h4 id="lock-blocked-title">아직 넘길 수 없습니다</h4>

        {unmet.map((condition) => (
          <div key={condition.key}>
            <p className={styles.reason}>
              <b>{condition.label}</b>이 먼저 필요합니다. 현재{" "}
              <b>
                {condition.label} = {condition.currentValueLabel}
              </b>{" "}
              상태입니다.
            </p>
            <div className={styles.reasonActions}>
              <button
                type="button"
                className={styles.btn}
                onClick={() => onNavigateToCondition(condition.key)}
                disabled={!canNavigateToCondition(condition.key)}
              >
                {canNavigateToCondition(condition.key) ? `${condition.label} 채우러 가기` : `${condition.label} 대상 없음`}
              </button>
              {onRequestApproval ? (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={() => onRequestApproval(condition.key)}
                  disabled={approvalPending}
                >
                  {approvalPending ? "요청 보내는 중…" : `${condition.label} 요청 보내기`}
                </button>
              ) : null}
            </div>
          </div>
        ))}

        <p className={styles.footnote}>
          조건 {unmet.length}개가 모두 충족돼야 다음 단계로 넘어갑니다. 채운 뒤 같은 버튼을
          다시 누르면 통과합니다.
        </p>
        {approvalFeedback ? (
          <p role={approvalFeedback.ok ? "status" : "alert"} className={approvalFeedback.ok ? styles.success : styles.error}>
            {approvalFeedback.message}
          </p>
        ) : null}

        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
