"use client";

import { noticeLive, noticeRole } from "@/lib/ui/result-notice";

import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { WorkspaceMark } from "./WorkspaceMark";
import styles from "./workspace-switcher.module.css";
import { DeveloperModeControl } from "@/components/mode/DeveloperModeControl";
import { NAVIGATION_STALL_MS } from "@/lib/workspace/switch-navigation";

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

function BodyPortal({ children }: { children: ReactNode }) {
  return typeof document === "undefined" ? children : createPortal(children, document.body);
}

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
  const [dialogPosition, setDialogPosition] = useState({ left: 8, top: 8, maxHeight: 480 });
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
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
      if (
        event.target instanceof Node
        && !rootRef.current?.contains(event.target)
        && !dialogRef.current?.contains(event.target)
      ) {
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

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, Math.max(280, window.innerWidth - 16));
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const top = Math.min(rect.bottom + 6, window.innerHeight - 8);
      setDialogPosition({ left, top, maxHeight: Math.max(160, window.innerHeight - top - 8) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    const closeOtherPopover = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== dialogId) close(false);
    };
    window.addEventListener("moawork:popover-open", closeOtherPopover);
    return () => window.removeEventListener("moawork:popover-open", closeOtherPopover);
  }, [close, dialogId]);

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

  /*
   * #671 — 「눌렀는데 계속 멈춘다」.
   *
   * 전에는 busy 를 켜 두고 «이동이 일어나 이 컴포넌트가 사라지는 것» 에만 기대고 있었다.
   * 성공 경로에서 busy 를 푸는 코드가 아예 없었다. 그래서 이동이 안 되면
   * 팝오버는 닫혀 있고, 트리거는 disabled 이고, 오류 문구도 없다 —
   * 사용자 눈에는 **그냥 멈춘 것**이다. 그리고 다시는 안 눌린다.
   *
   * ★ 그래서 시한을 둔다. 그 안에 페이지가 안 떠나면 스스로 풀고 이유를 말한다.
   *   되돌릴 길 없는 상태를 만들지 않는다.
   */
  async function navigate(destination: string, key: string) {
    if (!destination || busyKey) return;
    setNavigationError("");
    setBusyKey(key);
    close(false);
    const stall = window.setTimeout(() => {
      setBusyKey(null);
      setNavigationError("이동이 시작되지 않았어요. 다시 선택해 주세요.");
      setOpen(true);
    }, NAVIGATION_STALL_MS);
    try {
      await onNavigate(destination);
    } catch {
      window.clearTimeout(stall);
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
          setOpen((value) => {
            const next = !value;
            if (next) window.dispatchEvent(new CustomEvent("moawork:popover-open", { detail: dialogId }));
            return next;
          });
        }}
      >
        <WorkspaceMark name={current.name} signedImageUrl={current.signedImageUrl} size={32} />
        <span className={styles.triggerText}>
          <span className={styles.name}>{current.name}</span>
          <span className={styles.sub}>{ROLE_LABEL[current.role]} · 내 회사</span>
        </span>
        <span className={styles.chevron} aria-hidden="true">⌄</span>
      </button>

      {/* ★ 실패를 status 로 읽어주면 보조기술 사용자는 «이동됐다» 로 듣는다(BBE-208).
          바로 아래 254행은 색으로 실패를 «보여주고» 있었는데 이 라이브 리전만 판정을 안 읽었다 —
          같은 화면이 두 사용자에게 다른 사실을 말하던 자리다. */}
      <span
        className={styles.visuallyHidden}
        role={noticeRole(!navigationError)}
        aria-live={noticeLive(!navigationError)}
      >
        {navigationError}
      </span>

      {open ? (
        <BodyPortal>
          <>
          <div className={styles.mobileBackdrop} aria-hidden="true" onPointerDown={() => close()} />
          <section
            ref={dialogRef}
            id={dialogId}
            className={styles.dialog}
            role="dialog"
            aria-labelledby={titleId}
            data-workspace-switcher-dialog
            style={{
              "--mw-workspace-switcher-left": `${dialogPosition.left}px`,
              "--mw-workspace-switcher-top": `${dialogPosition.top}px`,
              "--mw-workspace-switcher-max-height": `${dialogPosition.maxHeight}px`,
            } as CSSProperties}
          >
            <div className={styles.dialogHeader}>
              <div>
                <h2 id={titleId}>회사 전환</h2>
                <p className={styles.commandHint}>활성 회사만 선택할 수 있어요.</p>
              </div>
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
                          <span className={styles.sub}>{request.kind === "create" ? "새 회사 만들기 요청을 확인하고 있어요" : "기존 회사 합류 요청을 확인하고 있어요"}</span>
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
                <span className={styles.itemText}>
                  <span className={styles.name}>새 회사 만들기</span>
                  <span className={styles.sub}>새 워크스페이스를 시작해요</span>
                </span>
              </button>
              <button type="button" className={styles.action} data-destination={destinations.joinHref} onClick={() => void navigate(destinations.joinHref, "join")} disabled={!destinations.joinHref || busyKey !== null}>
                <span className={styles.actionIcon} aria-hidden="true">↳</span>
                <span className={styles.itemText}>
                  <span className={styles.name}>기존 회사에 합류하기</span>
                  <span className={styles.sub}>초대 정보로 안전하게 찾아요</span>
                </span>
              </button>
            </div>

            {serverConfirmedCanAccessPlatform && destinations.platformHref ? (
              <>
                <div className={styles.divider} />
                <DeveloperModeControl mode="user" serverConfirmedPlatform action={{ mode: "platform", next: destinations.platformHref }} />
              </>
            ) : null}

            <p className={styles.note}>승인 전에는 회사에 들어갈 수 없어요. 목록에는 내 소속만 보여요.</p>
          </section>
          </>
        </BodyPortal>
      ) : null}
    </div>
  );
}
