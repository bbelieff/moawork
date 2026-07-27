"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { WorkspaceMark } from "./WorkspaceMark";
import styles from "./workspace-switcher.module.css";

export type WorkspaceRole = "owner" | "admin" | "member";
export type WorkspaceMembershipStatus = "active" | "inactive" | "suspended";

export type SwitcherWorkspace = {
  orgId: string;
  slug: string;
  name: string;
  role: WorkspaceRole;
  status: WorkspaceMembershipStatus;
  signedImageUrl?: string | null;
};

export type SwitcherPendingRequest = {
  requestId: string;
  name: string;
  kind: "create" | "join";
};

/** B3 통합 뒤 서버가 확정해 전달하는 신뢰된 진입점이다. */
export type WorkspaceSwitcherDestinations = {
  createHref: string;
  joinHref: string;
  platformHref?: string;
};

type WorkspaceListResult =
  | { ok: true; current: SwitcherWorkspace; workspaces: SwitcherWorkspace[] }
  | { ok: false };

export type WorkspaceSwitcherProps = {
  currentOrgId: string;
  workspaces: readonly SwitcherWorkspace[];
  pendingRequests?: readonly SwitcherPendingRequest[];
  destinations: WorkspaceSwitcherDestinations;
  /** 서버가 확인한 platform capability가 true일 때만 platform 행을 렌더한다. */
  serverConfirmedCanAccessPlatform?: boolean;
  /** 실패하면 reject해야 하며 컴포넌트는 busy를 풀고 선택창을 복구한다. */
  onNavigate: (destination: string) => Promise<void>;
  defaultOpen?: boolean;
};

const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: "대표",
  admin: "관리자",
  member: "구성원",
};

const CANONICAL_SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/u;

export function prepareWorkspaceList(
  currentOrgId: string,
  memberships: readonly SwitcherWorkspace[],
): WorkspaceListResult {
  const active = memberships.filter((workspace) => workspace.status === "active");
  const orgIds = new Set<string>();
  const slugs = new Set<string>();

  for (const workspace of active) {
    if (
      !workspace.orgId ||
      !workspace.name.trim() ||
      !CANONICAL_SLUG.test(workspace.slug) ||
      orgIds.has(workspace.orgId) ||
      slugs.has(workspace.slug)
    ) {
      return { ok: false };
    }
    orgIds.add(workspace.orgId);
    slugs.add(workspace.slug);
  }

  const currentMatches = active.filter(
    (workspace) => workspace.orgId === currentOrgId,
  );
  if (currentMatches.length !== 1) return { ok: false };

  const current = currentMatches[0];
  return {
    ok: true,
    current,
    workspaces: [
      current,
      ...active.filter((workspace) => workspace.orgId !== currentOrgId),
    ],
  };
}

function safePendingRequests(
  requests: readonly SwitcherPendingRequest[],
): SwitcherPendingRequest[] {
  const seen = new Set<string>();
  return requests.filter((request) => {
    if (!request.requestId || !request.name.trim() || seen.has(request.requestId)) {
      return false;
    }
    seen.add(request.requestId);
    return true;
  });
}

export function WorkspaceSwitcher({
  currentOrgId,
  workspaces,
  pendingRequests = [],
  destinations,
  serverConfirmedCanAccessPlatform = false,
  onNavigate,
  defaultOpen = false,
}: WorkspaceSwitcherProps) {
  const list = useMemo(
    () => prepareWorkspaceList(currentOrgId, workspaces),
    [currentOrgId, workspaces],
  );
  const pending = useMemo(
    () => safePendingRequests(pendingRequests),
    [pendingRequests],
  );
  const [open, setOpen] = useState(defaultOpen);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [navigationError, setNavigationError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstChoiceRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const titleId = useId();

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) {
      queueMicrotask(() => triggerRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => firstChoiceRef.current?.focus());

    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        close();
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close, open]);

  if (!list.ok) {
    return (
      <div className={styles.root} data-switcher-state="invalid">
        <button type="button" className={styles.trigger} disabled>
          <span className={styles.invalidMark} aria-hidden="true">!</span>
          <span className={styles.triggerText}>
            <span className={styles.name}>회사를 확인할 수 없어요</span>
            <span className={styles.sub}>새로고침한 뒤 다시 확인해 주세요.</span>
          </span>
        </button>
      </div>
    );
  }

  const { current } = list;

  async function navigate(destination: string, key: string) {
    if (!destination || busyKey) return;
    setNavigationError("");
    setBusyKey(key);
    close(false);
    try {
      await onNavigate(destination);
    } catch {
      setBusyKey(null);
      setNavigationError("이동하지 못했어요. 연결을 확인하고 다시 선택해 주세요.");
      setOpen(true);
    }
  }

  function chooseWorkspace(workspace: SwitcherWorkspace) {
    if (workspace.orgId === current.orgId) {
      close();
      return;
    }
    void navigate(`/w/${workspace.slug}`, `workspace:${workspace.orgId}`);
  }

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        aria-busy={busyKey ? true : undefined}
        disabled={busyKey !== null}
        onClick={() => {
          setNavigationError("");
          setOpen((value) => !value);
        }}
      >
        <WorkspaceMark name={current.name} signedImageUrl={current.signedImageUrl} size={32} />
        <span className={styles.triggerText}>
          <span className={styles.name}>{current.name}</span>
          <span className={styles.sub}>{ROLE_LABEL[current.role]} · 내 회사</span>
        </span>
        <span className={styles.chevron} aria-hidden="true">⌄</span>
      </button>

      <span className={styles.visuallyHidden} role="status" aria-live="polite">
        {navigationError}
      </span>

      {open ? (
        <>
          <div className={styles.mobileBackdrop} aria-hidden="true" onPointerDown={() => close()} />
          <section id={dialogId} className={styles.dialog} role="dialog" aria-labelledby={titleId}>
            <div className={styles.dialogHeader}>
              <h2 id={titleId}>내 회사</h2>
              <button type="button" className={styles.closeButton} onClick={() => close()} aria-label="회사 전환 닫기">
                ×
              </button>
            </div>

            {navigationError ? <p className={styles.errorMessage}>{navigationError}</p> : null}

            <ul className={styles.workspaceList} aria-label="활성 회사 목록">
              {list.workspaces.map((workspace, index) => {
                const isCurrent = workspace.orgId === current.orgId;
                return (
                  <li key={workspace.orgId}>
                    <button
                      ref={index === 0 ? firstChoiceRef : undefined}
                      type="button"
                      className={`${styles.item} ${isCurrent ? styles.itemCurrent : ""}`}
                      data-destination={`/w/${workspace.slug}`}
                      onClick={() => chooseWorkspace(workspace)}
                      disabled={busyKey !== null}
                    >
                      <WorkspaceMark name={workspace.name} signedImageUrl={workspace.signedImageUrl} size={28} />
                      <span className={styles.itemText}>
                        <span className={styles.name}>{workspace.name}</span>
                        <span className={styles.sub}>{ROLE_LABEL[workspace.role]}</span>
                      </span>
                      <span className={styles.itemState}>{isCurrent ? "사용 중" : "전환"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {pending.length > 0 ? (
              <>
                <p className={styles.sectionLabel}>승인 기다리는 중</p>
                <ul className={styles.pendingList} aria-label="승인 대기 회사 목록">
                  {pending.map((request) => (
                    <li key={request.requestId}>
                      <button type="button" className={styles.pendingItem} disabled aria-disabled="true">
                        <WorkspaceMark name={request.name} size={28} muted />
                        <span className={styles.itemText}>
                          <span className={styles.name}>{request.name}</span>
                          <span className={styles.sub}>{request.kind === "create" ? "회사 만들기 요청함" : "합류 요청함"}</span>
                        </span>
                        <span className={styles.pendingState}>승인 대기</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            <div className={styles.divider} />
            <div className={styles.actions}>
              <button type="button" className={styles.action} data-destination={destinations.createHref} onClick={() => void navigate(destinations.createHref, "create")} disabled={!destinations.createHref || busyKey !== null}>
                <span className={styles.actionIcon} aria-hidden="true">+</span>
                새 회사 만들기
              </button>
              <button type="button" className={styles.action} data-destination={destinations.joinHref} onClick={() => void navigate(destinations.joinHref, "join")} disabled={!destinations.joinHref || busyKey !== null}>
                <span className={styles.actionIcon} aria-hidden="true">↳</span>
                기존 회사에 합류하기
              </button>
            </div>

            {serverConfirmedCanAccessPlatform && destinations.platformHref ? (
              <>
                <div className={styles.divider} />
                <button type="button" className={styles.action} data-destination={destinations.platformHref} onClick={() => void navigate(destinations.platformHref!, "platform")} disabled={busyKey !== null}>
                  <span className={styles.actionIcon} aria-hidden="true">⌘</span>
                  플랫폼 관리
                </button>
              </>
            ) : null}

            <p className={styles.note}>승인 전에는 회사에 들어갈 수 없어요. 목록에는 내 소속만 보여요.</p>
          </section>
        </>
      ) : null}
    </div>
  );
}
