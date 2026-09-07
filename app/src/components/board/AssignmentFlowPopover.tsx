"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  formatAssignmentMoment,
  orderAssignmentHistory,
  type AssignmentFlowMember,
  type AssignmentFollower,
  type AssignmentHistoryEntry,
  type PendingHandoff,
} from "./assignment-flow-view-model";
import styles from "./assignment-flow-popover.module.css";

export type AssignmentFlowMutationResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; error: string }>;

type Position = Readonly<{ left: number; top: number; width: number; maxHeight: number }>;

export type AssignmentFlowPopoverProps = Readonly<{
  current: AssignmentFlowMember | null;
  history: readonly AssignmentHistoryEntry[];
  nextHandoff: PendingHandoff | null;
  ruleRecipients: readonly AssignmentFlowMember[];
  followers: readonly AssignmentFollower[];
  loading?: boolean;
  error?: string | null;
  readOnly?: boolean;
  triggerLabel?: string;
  onRetry?: () => void;
  onRemoveFollower?: (followerId: string) => AssignmentFlowMutationResult | Promise<AssignmentFlowMutationResult>;
}>;

function initials(label: string): string {
  return label.trim().slice(0, 1) || "멤";
}

function Avatar({ member }: { member: AssignmentFlowMember }) {
  if (member.avatarUrl) {
    return (
      <span
        className={`${styles.avatar} ${styles.avatarImage}`}
        style={{ backgroundImage: `url(${JSON.stringify(member.avatarUrl).slice(1, -1)})` }}
        aria-hidden="true"
      />
    );
  }
  return <span className={styles.avatar} aria-hidden="true">{initials(member.label)}</span>;
}

function Person({
  member,
  meta,
  badge,
  emphasized = false,
}: {
  member: AssignmentFlowMember;
  meta?: string | null;
  badge?: string;
  emphasized?: boolean;
}) {
  return (
    <div className={`${styles.person} ${emphasized ? styles.currentPerson : ""} ${member.active === false ? styles.inactive : ""}`}>
      <Avatar member={member} />
      <span className={styles.personCopy}>
        <b>{member.label}</b>
        <small>{member.active === false ? "비활성 구성원" : meta || member.title || "구성원"}</small>
      </span>
      {badge ? <span className={styles.badge}>{badge}</span> : null}
    </div>
  );
}

export function AssignmentFlowPopover({
  current,
  history,
  nextHandoff,
  ruleRecipients,
  followers,
  loading = false,
  error = null,
  readOnly = false,
  triggerLabel,
  onRetry,
  onRemoveFollower,
}: AssignmentFlowPopoverProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position>({ left: 8, top: 8, width: 432, maxHeight: 680 });
  const [pendingFollower, setPendingFollower] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const orderedHistory = useMemo(() => orderAssignmentHistory(history), [history]);

  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const inset = 8;
    const width = Math.min(432, Math.max(280, window.innerWidth - inset * 2));
    const maxHeight = Math.max(280, Math.min(680, window.innerHeight - inset * 2));
    const left = Math.max(inset, Math.min(rect.left, window.innerWidth - width - inset));
    const measured = popoverRef.current?.getBoundingClientRect().height;
    const height = Math.min(maxHeight, measured && measured > 0 ? measured : 620);
    const below = rect.bottom + 6;
    const top = below + height <= window.innerHeight - inset
      ? below
      : Math.max(inset, rect.top - height - 6);
    setPosition({ left, top, width, maxHeight });
  }, []);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    setMutationError(null);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  function show() {
    setMutationError(null);
    setOpen(true);
    window.requestAnimationFrame(() => {
      place();
      closeRef.current?.focus();
    });
  }

  async function removeFollower(follower: AssignmentFollower) {
    if (readOnly || !onRemoveFollower || pendingFollower) return;
    setPendingFollower(follower.id);
    setMutationError(null);
    try {
      const result = await onRemoveFollower(follower.id);
      if (!result.ok) setMutationError(result.error || "알림 대상에서 제외하지 못했습니다.");
    } catch {
      setMutationError("알림 대상에서 제외하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setPendingFollower(null);
    }
  }

  useEffect(() => {
    if (!open) return;
    const reposition = () => place();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reposition);
    if (popoverRef.current) resizeObserver?.observe(popoverRef.current);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [close, open, place]);

  const popover = open ? (
    <div
      ref={popoverRef}
      role="dialog"
      aria-modal="false"
      aria-label="담당자 흐름"
      aria-busy={loading || undefined}
      className={styles.popover}
      style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight }}
    >
      <header className={styles.header}>
        <div>
          <strong>담당자 흐름</strong>
          <span>인계 이력과 변경 알림 대상을 확인합니다.</span>
        </div>
        <button ref={closeRef} type="button" onClick={() => close()} aria-label="담당자 흐름 닫기">×</button>
      </header>

      {error ? (
        <div className={styles.alert} role="alert">
          <span><b>담당자 흐름을 불러오지 못했습니다.</b>{error}</span>
          {onRetry ? <button type="button" onClick={onRetry}>다시 시도</button> : null}
        </div>
      ) : null}

      {readOnly ? <p className={styles.readOnly}><span aria-hidden="true">🔒</span> 보기만 가능합니다. 담당자와 알림 대상은 변경할 수 없습니다.</p> : null}

      <div className={styles.body}>
        {loading ? (
          <div className={styles.skeletons} aria-label="담당자 흐름 불러오는 중">
            {Array.from({ length: 5 }, (_, index) => <span key={index} className={styles.skeleton} />)}
          </div>
        ) : (
          <>
            <section className={styles.section} aria-labelledby="assignment-flow-history">
              <h3 id="assignment-flow-history">이전 담당자</h3>
              {orderedHistory.length > 0 ? (
                <ol className={styles.timeline}>
                  {orderedHistory.map((entry) => (
                    <li key={entry.id}>
                      <span className={styles.timelineDot} aria-hidden="true" />
                      <Person member={entry.member} meta={formatAssignmentMoment(entry.unassignedAt || entry.assignedAt)} />
                    </li>
                  ))}
                </ol>
              ) : <p className={styles.empty}>이전 담당 이력이 없습니다.</p>}
            </section>

            <section className={styles.section} aria-labelledby="assignment-flow-current">
              <h3 id="assignment-flow-current">현재 담당자</h3>
              {current ? <Person member={current} badge="현재" emphasized /> : <p className={styles.empty}>미배정</p>}
            </section>

            <section className={styles.section} aria-labelledby="assignment-flow-next">
              <h3 id="assignment-flow-next">다음 인계 예정</h3>
              {nextHandoff ? (
                <Person member={nextHandoff.member} meta={formatAssignmentMoment(nextHandoff.scheduledFor)} badge="예정" />
              ) : <p className={styles.empty}>예정된 인계가 없습니다.</p>}
            </section>

            <section className={styles.section} aria-labelledby="assignment-flow-notifications">
              <h3 id="assignment-flow-notifications">알림 대상</h3>
              {ruleRecipients.length > 0 ? (
                <div className={styles.recipientGroup} aria-label="규칙에 따라 받는 사람">
                  <b>규칙 수신자 <span aria-hidden="true">🔒</span></b>
                  {ruleRecipients.map((member) => <Person key={member.id} member={member} badge="잠김" />)}
                </div>
              ) : null}
              {followers.length > 0 ? (
                <div className={styles.recipientGroup} aria-label="직접 추가한 알림 대상">
                  <b>직접 추가</b>
                  {followers.map((follower) => (
                    <div key={follower.id} className={styles.followerRow}>
                      <Person member={follower.member} />
                      {!readOnly && onRemoveFollower ? (
                        <button
                          type="button"
                          className={styles.remove}
                          disabled={pendingFollower !== null}
                          aria-label={`${follower.member.label}님을 알림 대상에서만 제외`}
                          title="알림 대상에서만 제외 · 담당 이력은 유지"
                          onClick={() => void removeFollower(follower)}
                        >
                          {pendingFollower === follower.id ? <span className={styles.spinner} aria-label="제외 중" /> : "×"}
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {ruleRecipients.length === 0 && followers.length === 0 ? <p className={styles.empty}>알림 대상이 없습니다.</p> : null}
              {mutationError ? <p className={styles.mutationError} role="alert">{mutationError}</p> : null}
              <p className={styles.note}>알림 대상에서 제외해도 담당 배정 이력은 유지됩니다.</p>
            </section>
          </>
        )}
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => open ? close() : show()}
      >
        {current ? <><Avatar member={current} /><span>{triggerLabel || current.label}</span></> : <span>{triggerLabel || "미배정"}</span>}
      </button>
      {typeof document !== "undefined" && popover ? createPortal(popover, document.body) : popover}
    </>
  );
}
