"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelAssignmentHandoffAction,
  readAssignmentLineageAction,
  reassignAssignmentAction,
  scheduleAssignmentHandoffAction,
  setAssignmentFollowerAction,
  type AssignmentLineageActionResult,
  type AssignmentLineageRef,
} from "@/app/(app)/boards/assignment-lineage-actions";
import type { AssignmentLineageSnapshot } from "@/lib/assignment-lineage";
import { MemberPicker, type MemberPickerMember } from "./MemberPicker";
import { formatAssignmentMoment } from "./assignment-flow-view-model";
import styles from "./assignment-flow-popover.module.css";

type Position = Readonly<{ left: number; top: number; width: number; maxHeight: number }>;
type MutationResult = AssignmentLineageActionResult<Record<string, unknown>>;
const TRANSPORT_ERROR = "요청을 완료할 수 없습니다. 잠시 후 다시 시도해 주세요.";

export type AssignmentLineagePopoverProps = AssignmentLineageRef & Readonly<{
  currentAssigneeId: string | null;
  members: readonly MemberPickerMember[];
  readOnly?: boolean;
}>;

function initials(label: string): string {
  return label.trim().slice(0, 1) || "멤";
}

function Person({ member, meta, badge, current = false }: {
  member: MemberPickerMember;
  meta?: string | null;
  badge?: string;
  current?: boolean;
}) {
  return (
    <div className={`${styles.person} ${current ? styles.currentPerson : ""} ${member.active === false ? styles.inactive : ""}`}>
      <span className={styles.avatar} aria-hidden="true">{initials(member.label)}</span>
      <span className={styles.personCopy}>
        <b>{member.label}</b>
        <small>{member.active === false ? "비활성 또는 탈퇴한 구성원" : meta || member.title || member.groupLabel || "구성원"}</small>
      </span>
      {badge ? <span className={styles.badge}>{badge}</span> : null}
    </div>
  );
}

function selection(form: HTMLFormElement): string | null {
  const values = new FormData(form).getAll("value").filter((value): value is string => typeof value === "string" && value.length > 0);
  return values.at(-1) ?? null;
}

/**
 * 고른 «전부» 를 돌려준다 (#657).
 *
 * 담당자는 한 명이라 selection() 이 마지막 하나만 집어도 됐지만, 알림 대상은 여럿이다.
 * 전에는 여기서도 마지막 하나만 집어서, 세 명을 골라도 한 명만 추가됐다.
 * MemberPicker 는 이미 multiple 모드(「연관담당 선택 · N명 선택」)를 갖추고 있었고
 * 이 화면만 multiple={false} 로 그걸 막고 있었다.
 */
function selections(form: HTMLFormElement): string[] {
  const values = new FormData(form).getAll("value").filter((value): value is string => typeof value === "string" && value.length > 0);
  return [...new Set(values)];
}

export function AssignmentLineagePopover({
  boardId,
  dealId,
  itemId,
  currentAssigneeId,
  members,
  readOnly = false,
}: AssignmentLineagePopoverProps) {
  const ref = useMemo(() => ({ boardId, dealId, itemId }), [boardId, dealId, itemId]);
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<AssignmentLineageSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [position, setPosition] = useState<Position>({ left: 8, top: 8, width: 432, maxHeight: 680 });
  const retryRef = useRef<(() => Promise<MutationResult>) | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const byId = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const resolveMember = useCallback((id: string | null): MemberPickerMember | null => {
    if (!id) return null;
    return byId.get(id) ?? { id, label: "구성원 정보 없음", active: false };
  }, [byId]);

  const current = resolveMember(snapshot?.currentAssigneeId ?? currentAssigneeId);
  const history = useMemo(() => snapshot?.transitions
    .map((event) => ({ event, member: resolveMember(event.fromUserId) }))
    .filter((entry): entry is { event: AssignmentLineageSnapshot["transitions"][number]; member: MemberPickerMember } => Boolean(entry.member)) ?? [],
  [resolveMember, snapshot]);
  const directFollowers = useMemo(() => snapshot?.followers
    .filter((follower) => follower.userId !== snapshot.currentAssigneeId)
    .map((follower) => ({ follower, member: resolveMember(follower.userId) }))
    .filter((entry): entry is { follower: AssignmentLineageSnapshot["followers"][number]; member: MemberPickerMember } => Boolean(entry.member)) ?? [],
  [resolveMember, snapshot]);
  const pendingMember = resolveMember(snapshot?.pendingHandoff?.toUserId ?? null);

  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const inset = 8;
    const width = Math.min(432, Math.max(300, window.innerWidth - inset * 2));
    const maxHeight = Math.max(300, Math.min(680, window.innerHeight - inset * 2));
    const height = Math.min(maxHeight, popoverRef.current?.getBoundingClientRect().height || 650);
    const left = Math.max(inset, Math.min(rect.left, window.innerWidth - width - inset));
    const below = rect.bottom + 6;
    const top = below + height <= window.innerHeight - inset ? below : Math.max(inset, rect.top - height - 6);
    setPosition({ left, top, width, maxHeight });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setReadError(null);
    try {
      const result = await readAssignmentLineageAction(ref);
      if (result.ok) setSnapshot(result.data);
      else setReadError(result.error);
    } catch {
      setReadError(TRANSPORT_ERROR);
    } finally {
      setLoading(false);
    }
  }, [ref]);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    setMutationError(null);
    setRetryAvailable(false);
    retryRef.current = null;
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const show = useCallback(() => {
    setOpen(true);
    setMutationError(null);
    void load();
    window.requestAnimationFrame(() => {
      place();
      closeRef.current?.focus();
    });
  }, [load, place]);

  const mutate = useCallback(async (label: string, operation: () => Promise<MutationResult>) => {
    if (pendingLabel) return;
    setPendingLabel(label);
    setMutationError(null);
    setRetryAvailable(false);
    retryRef.current = operation;
    try {
      const result = await operation();
      if (result.ok) {
        retryRef.current = null;
        setRetryAvailable(false);
        await load();
      } else if (result.code === "unavailable") {
        setMutationError(result.error);
        setRetryAvailable(true);
      } else {
        retryRef.current = null;
        setRetryAvailable(false);
        setMutationError(result.error);
        if (result.code === "conflict") await load();
      }
    } catch {
      setMutationError(TRANSPORT_ERROR);
      setRetryAvailable(true);
    } finally {
      setPendingLabel(null);
    }
  }, [load, pendingLabel]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => place();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reposition);
    if (popoverRef.current) resizeObserver?.observe(popoverRef.current);
    const nestedPickerOpen = () => Boolean(document.querySelector('[role="dialog"][aria-label$=" 선택"]'));
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target) || nestedPickerOpen()) return;
      close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || nestedPickerOpen()) return;
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

  const controlsDisabled = readOnly || loading || readError !== null || pendingLabel !== null || !snapshot;
  const activeCandidates = members.filter((member) => member.active !== false);
  const followerCandidates = activeCandidates.filter((member) =>
    member.id !== snapshot?.currentAssigneeId && !snapshot?.followers.some((follower) => follower.userId === member.id));

  const dialog = open ? (
    <div
      ref={popoverRef}
      role="dialog"
      aria-modal="false"
      aria-label="담당자 흐름"
      aria-busy={loading || pendingLabel !== null || undefined}
      className={styles.popover}
      style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight }}
    >
      <header className={styles.header}>
        <div><strong>담당자 흐름</strong><span>현재 배정, 인계 이력과 변경 알림 대상을 함께 관리합니다.</span></div>
        <button ref={closeRef} type="button" onClick={() => close()} aria-label="담당자 흐름 닫기">×</button>
      </header>

      {readOnly ? <p className={styles.readOnly}><span aria-hidden="true">🔒</span> 보기만 가능합니다. 담당자와 알림 대상은 변경할 수 없습니다.</p> : null}
      {readError ? (
        <div className={styles.alert} role="alert">
          <span><b>담당자 흐름을 불러오지 못했습니다.</b>{readError}</span>
          <button type="button" onClick={() => void load()}>다시 시도</button>
        </div>
      ) : null}
      {mutationError ? (
        <div className={styles.alert} role="alert">
          <span><b>변경을 저장하지 못했습니다.</b>{mutationError}</span>
          {retryAvailable ? <button type="button" disabled={pendingLabel !== null} onClick={() => retryRef.current && void mutate("재시도 중", retryRef.current)}>같은 요청 다시 시도</button> : null}
        </div>
      ) : null}

      <div className={styles.body}>
        {loading && !snapshot ? (
          <div className={styles.skeletons} aria-label="담당자 흐름 불러오는 중">
            {Array.from({ length: 5 }, (_, index) => <span key={index} className={styles.skeleton} />)}
          </div>
        ) : readError && !snapshot ? null : (
          <>
            <section className={styles.section} aria-labelledby={`assignment-history-${itemId}`}>
              <h3 id={`assignment-history-${itemId}`}>이전 담당자</h3>
              {history.length ? (
                <ol className={styles.timeline}>
                  {history.map(({ event, member }) => (
                    <li key={event.id}><span className={styles.timelineDot} aria-hidden="true" /><Person member={member} meta={formatAssignmentMoment(event.createdAt)} /></li>
                  ))}
                </ol>
              ) : <p className={styles.empty}>도입 이후 담당 변경 이력이 없습니다.</p>}
            </section>

            <section className={styles.section} aria-labelledby={`assignment-current-${itemId}`}>
              <h3 id={`assignment-current-${itemId}`}>현재 담당자</h3>
              {current ? <Person member={current} badge="현재" current /> : <p className={styles.empty}>미배정</p>}
              {!controlsDisabled ? (
                <form onSubmit={(event) => {
                  event.preventDefault();
                  const assignedTo = selection(event.currentTarget);
                  const requestId = crypto.randomUUID();
                  void mutate("담당자 변경 중", () => reassignAssignmentAction({ ...ref, assignedTo, expectedAssignedTo: snapshot.currentAssigneeId, expectedVersion: snapshot.version, requestId }));
                }}>
                  <MemberPicker label="현재 담당자" members={activeCandidates} value={snapshot.currentAssigneeId} multiple={false} triggerLabel="담당자 변경" />
                </form>
              ) : null}
            </section>

            <section className={styles.section} aria-labelledby={`assignment-next-${itemId}`}>
              <h3 id={`assignment-next-${itemId}`}>다음 인계 예정</h3>
              {snapshot?.pendingHandoff && pendingMember ? (
                <div>
                  <Person member={pendingMember} meta={formatAssignmentMoment(snapshot.pendingHandoff.createdAt)} badge="예정" />
                  {!controlsDisabled ? (
                    <button type="button" className="mt-1 rounded border border-mw-line px-2 py-1 text-[0.65rem] font-bold text-mw-sub" onClick={() => {
                      const handoffId = snapshot.pendingHandoff?.id;
                      if (!handoffId) return;
                      const requestId = crypto.randomUUID();
                      void mutate("인계 취소 중", () => cancelAssignmentHandoffAction({ ...ref, handoffId, requestId }));
                    }}>인계 예정 취소</button>
                  ) : null}
                </div>
              ) : (
                <>
                  <p className={styles.empty}>예정된 인계가 없습니다.</p>
                  {!controlsDisabled ? (
                    <form onSubmit={(event) => {
                      event.preventDefault();
                      const toUserId = selection(event.currentTarget);
                      if (!toUserId) return;
                      const requestId = crypto.randomUUID();
                      void mutate("인계 예약 중", () => scheduleAssignmentHandoffAction({ ...ref, toUserId, expectedAssignedTo: snapshot.currentAssigneeId, expectedVersion: snapshot.version, requestId }));
                    }}>
                      <MemberPicker label="다음 인계 담당자" members={activeCandidates.filter((member) => member.id !== snapshot.currentAssigneeId)} value={null} multiple={false} triggerLabel="다음 담당자 지정" />
                    </form>
                  ) : null}
                </>
              )}
            </section>

            <section className={styles.section} aria-labelledby={`assignment-followers-${itemId}`}>
              <h3 id={`assignment-followers-${itemId}`}>알림 대상</h3>
              {current ? <div className={styles.recipientGroup}><b>규칙 수신자 <span aria-hidden="true">🔒</span></b><Person member={current} badge="잠김" /></div> : null}
              {directFollowers.length ? (
                <div className={styles.recipientGroup}>
                  <b>직접 추가</b>
                  {directFollowers.map(({ follower, member }) => (
                    <div key={follower.userId} className={styles.followerRow}>
                      <Person member={member} />
                      {!controlsDisabled ? (
                        <button
                          type="button"
                          className={styles.remove}
                          aria-label={`${member.label}님을 알림 대상에서만 제외`}
                          title="알림 대상에서만 제외 · 담당 이력은 유지"
                          onClick={() => {
                            const requestId = crypto.randomUUID();
                            void mutate("알림 대상 제외 중", () => setAssignmentFollowerAction({ ...ref, userId: follower.userId, follow: false, requestId }));
                          }}
                        >×</button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {!current && directFollowers.length === 0 ? <p className={styles.empty}>알림 대상이 없습니다.</p> : null}
              {!controlsDisabled && followerCandidates.length ? (
                <form onSubmit={(event) => {
                  event.preventDefault();
                  const userIds = selections(event.currentTarget);
                  if (userIds.length === 0) return;
                  /*
                   * ★ 한 번의 mutate 안에서 «순차» 로 처리한다.
                   *   mutate 는 pendingLabel 로 동시 실행을 막으므로 여러 번 부르면 두 번째부터 조용히 버려진다.
                   *   requestId 는 사람마다 새로 만든다 — 멱등 키를 돌려쓰면 두 번째가 «재시도» 로 읽힌다.
                   * ★ 하나라도 실패하면 거기서 멈추고 그 오류를 그대로 올린다.
                   *   나머지를 계속 밀어붙이면 «몇 명은 됐고 몇 명은 안 된» 상태를 아무도 모르게 된다.
                   */
                  void mutate(
                    userIds.length > 1 ? `알림 대상 ${userIds.length}명 추가 중` : "알림 대상 추가 중",
                    async () => {
                      let last: MutationResult | null = null;
                      for (const userId of userIds) {
                        last = await setAssignmentFollowerAction({ ...ref, userId, follow: true, requestId: crypto.randomUUID() });
                        if (!last.ok) return last;
                      }
                      return last as MutationResult;
                    },
                  );
                }}>
                  <MemberPicker label="알림 대상" members={followerCandidates} value={null} multiple triggerLabel="알림 대상 추가" ruleRecipients={current ? [current] : []} />
                </form>
              ) : null}
              <p className={styles.note}>현재 담당자는 항상 알림을 받습니다. ×는 알림에서만 제외하며 담당 이력은 유지합니다.</p>
            </section>
          </>
        )}
      </div>
      {pendingLabel ? <p className={styles.readOnly} role="status">{pendingLabel}</p> : null}
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
        onPointerDown={(event) => event.stopPropagation()}
        onDragStart={(event) => event.preventDefault()}
        onClick={() => open ? close() : show()}
      >
        {current ? <><span className={styles.avatar} aria-hidden="true">{initials(current.label)}</span><span>{current.label}</span></> : <span>미배정</span>}
      </button>
      {typeof document !== "undefined" && dialog ? createPortal(dialog, document.body) : dialog}
    </>
  );
}
