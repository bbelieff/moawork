"use client";

// 회사 전환 스위처 — 좌상단 사이드바 헤더 (D-S1~S5 확정안)
//
// 확정 사항(belie 2026-07-27):
//  D-S1 위치 = 좌상단(사이드바 헤더). 우상단 계정 메뉴는 사람 축만 담당한다.
//  D-S2 우상단 칩에서 회사명 표기 제거.
//  D-S3 UI 어휘 = "회사". URL·코드의 workspace 는 그대로 둔다.
//  D-S4 메뉴 = 내 소속 목록 + 구분선 + 새 회사 만들기 / 기존 회사에 합류하기.
//  D-S5 전환·만들기·합류 모두 2클릭.
//
// 보안 규약:
//  · 목록은 **내 소속만**. 검색·전체목록 없음(열거 방지 계약과 일관).
//  · 요청 중(pending)은 표시하되 진입 불가(aria-disabled).
//  · inactive 소속은 표시하지 않는다.
//  · 전환 목적지는 /w/{slug} **루트**. 현재 경로를 승계하지 않는다
//    (회사마다 권한·기능이 달라 같은 경로가 유효하지 않을 수 있다).
//
// 작성: MWC(코워크). 코드 리뷰·머지·배포는 코덱스.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { WorkspaceMark } from "./WorkspaceMark";
import styles from "./workspace-switcher.module.css";

export type SwitcherRole = "owner" | "admin" | "member";

export type SwitcherWorkspace = {
  orgId: string;
  slug: string;
  name: string;
  role: SwitcherRole;
  iconUrl: string | null;
  /** 액션 필요 건수(뱃지 숫자). 0이면 표시하지 않는다. */
  actionCount?: number;
  /** 미확인 변화 유무(점). actionCount 가 있으면 숫자가 우선한다. */
  hasUpdates?: boolean;
};

export type SwitcherPendingRequest = {
  requestId: string;
  /** 합류 요청은 회사명, 생성 요청은 희망 이름 */
  name: string;
  kind: "join" | "create";
};

type Props = {
  current: SwitcherWorkspace;
  /** 현재 회사를 포함한 활성 소속 전체. 정렬은 호출부에서 최근 사용순으로 넘긴다. */
  workspaces: SwitcherWorkspace[];
  pending?: SwitcherPendingRequest[];
  /** 플랫폼 관리자에게만 true. 일반 사용자에게는 항목 자체가 렌더되지 않는다. */
  isPlatformAdmin?: boolean;
};

const ROLE_LABEL: Record<SwitcherRole, string> = {
  owner: "오너",
  admin: "관리자",
  member: "멤버",
};

export function WorkspaceSwitcher({
  current,
  workspaces,
  pending = [],
  isPlatformAdmin = false,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const close = useCallback(() => setOpen(false), []);

  // 바깥 클릭 · Esc 로 닫기. Esc 는 트리거로 포커스를 되돌린다.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close();
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  function switchTo(workspace: SwitcherWorkspace) {
    if (workspace.slug === current.slug) {
      close();
      return;
    }
    setBusySlug(workspace.slug);
    close();
    // 현재 경로 승계 금지 — 반드시 루트로.
    router.push(`/w/${workspace.slug}`);
  }

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <WorkspaceMark name={current.name} iconUrl={current.iconUrl} size={32} />
        <span className={styles.triggerText}>
          <span className={styles.name}>{current.name}</span>
          <span className={styles.sub}>{ROLE_LABEL[current.role]} · 내 회사</span>
        </span>
        <span className={styles.chevron} aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <div className={styles.menu} id={menuId} role="menu" aria-label="회사 전환">
          <p className={styles.menuLabel}>내 회사</p>

          {workspaces.map((workspace) => {
            const isCurrent = workspace.slug === current.slug;
            return (
              <button
                key={workspace.orgId}
                type="button"
                role="menuitem"
                className={isCurrent ? `${styles.item} ${styles.itemCurrent}` : styles.item}
                onClick={() => switchTo(workspace)}
                disabled={busySlug !== null}
              >
                <WorkspaceMark name={workspace.name} iconUrl={workspace.iconUrl} size={28} />
                <span className={styles.itemText}>
                  <span className={styles.name}>{workspace.name}</span>
                  <span className={styles.sub}>{ROLE_LABEL[workspace.role]}</span>
                </span>
                <span className={styles.itemRight}>
                  <Badge count={workspace.actionCount} hasUpdates={workspace.hasUpdates} />
                  {isCurrent ? (
                    <span className={styles.currentTag}>사용 중</span>
                  ) : (
                    <span aria-hidden="true">→</span>
                  )}
                </span>
              </button>
            );
          })}

          {/* 요청 중 — 보이되 진입 불가(승인 전 접근 권한 없음) */}
          {pending.map((request) => (
            <div
              key={request.requestId}
              role="menuitem"
              aria-disabled="true"
              className={`${styles.item} ${styles.itemPending}`}
            >
              <WorkspaceMark name={request.name} iconUrl={null} size={28} muted />
              <span className={styles.itemText}>
                <span className={styles.name}>{request.name}</span>
                <span className={styles.sub}>
                  {request.kind === "create" ? "회사 만들기 요청함" : "합류 요청함"}
                </span>
              </span>
              <span className={styles.itemRight}>
                <span className={styles.pendingTag}>승인 대기</span>
              </span>
            </div>
          ))}

          <hr className={styles.divider} />

          <Link href="/workspace-entry?intent=create" className={styles.action} role="menuitem" onClick={close}>
            <span className={styles.actionIcon} aria-hidden="true">
              +
            </span>
            새 회사 만들기
          </Link>
          <Link href="/workspace-entry?intent=join" className={styles.action} role="menuitem" onClick={close}>
            <span className={styles.actionIcon} aria-hidden="true">
              ↳
            </span>
            기존 회사에 합류하기
          </Link>

          {isPlatformAdmin ? (
            <>
              <hr className={styles.divider} />
              <Link href="/platform" className={styles.action} role="menuitem" onClick={close}>
                <span className={styles.actionIcon} aria-hidden="true">
                  ⚙
                </span>
                플랫폼 관리
              </Link>
            </>
          ) : null}

          <p className={styles.note}>
            승인 전에는 회사에 들어갈 수 없어요. 목록에는 내 소속만 보여요.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 뱃지 규칙(C2 계약):
 *  · 숫자 = 내가 할 일. 화면 진입만으로 사라지지 않는다.
 *  · 점   = 안 본 변화.
 *  · 숫자가 있으면 점은 표시하지 않는다.
 */
function Badge({ count, hasUpdates }: { count?: number; hasUpdates?: boolean }) {
  if (count && count > 0) {
    const label = count > 99 ? "99+" : String(count);
    return (
      <span className={styles.badge} aria-label={`처리할 일 ${label}건`}>
        {label}
      </span>
    );
  }
  if (hasUpdates) {
    return <span className={styles.dot} aria-label="새로운 변화 있음" />;
  }
  return null;
}
