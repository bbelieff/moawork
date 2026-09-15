"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CurrentSessionLogout } from "./CurrentSessionLogout";
import styles from "./account.module.css";
import { DeveloperModeControl, type DeveloperModeAction } from "@/components/mode/DeveloperModeControl";

export type AccountMenuProps = {
  displayName: string;
  loginEmail: string;
  initial: string;
  /** 이전 호출부 호환용이며 계정 메뉴에는 회사명을 표시하지 않는다. */
  workspaceName?: string;
  accountHref: string;
  workspaceHref?: string;
  sessionsHref?: string;
  privacyHref?: string;
  /** Server-confirmed capability and destination are supplied by a later adapter. */
  serverConfirmedCanAccessPlatform?: boolean;
  platformModeAction?: DeveloperModeAction;
};

export function AccountMenu({
  displayName,
  loginEmail,
  initial,
  accountHref,
  workspaceHref,
  sessionsHref,
  privacyHref,
  serverConfirmedCanAccessPlatform = false,
  platformModeAction,
}: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    rootRef.current
      ?.querySelector<HTMLElement>("[data-account-menu-item]")
      ?.focus();

    function closeOnOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutside);
    return () => document.removeEventListener("pointerdown", closeOnOutside);
  }, [open]);

  function moveFocus(key: "ArrowDown" | "ArrowUp" | "Home" | "End") {
    const items = Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>(
        "[data-account-menu-item]",
      ) ?? [],
    );
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next =
      key === "Home"
        ? 0
        : key === "End"
          ? items.length - 1
          : key === "ArrowDown"
            ? (current + 1 + items.length) % items.length
            : (current - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  return (
    <div ref={rootRef} className={styles.menuRoot}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.menuButton}
        aria-label="계정 메뉴 열기"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="account-menu"
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.avatar} aria-hidden="true">
          {initial}
        </span>
        <span className={styles.menuIdentity}>
          <strong>{displayName}</strong>
          <small>{loginEmail}</small>
        </span>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>

      <div
        id="account-menu"
        className={styles.menuPanel}
        role="menu"
        hidden={!open}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            buttonRef.current?.focus();
          } else if (
            ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
          ) {
            event.preventDefault();
            moveFocus(
              event.key as "ArrowDown" | "ArrowUp" | "Home" | "End",
            );
          }
        }}
      >
        <div className={styles.menuSummary}>
          <strong>{displayName}</strong>
          <small>{loginEmail}</small>
        </div>
        <ul className={styles.menuList}>
          <li>
            <Link
              href={accountHref}
              role="menuitem"
              data-account-menu-item
              className={styles.menuItem}
              onClick={() => setOpen(false)}
            >
              내 계정
            </Link>
          </li>
          {workspaceHref ? (
            <li>
              <Link
                href={workspaceHref}
                role="menuitem"
                data-account-menu-item
                className={styles.menuItem}
                onClick={() => setOpen(false)}
              >
                내 회사 관리
              </Link>
            </li>
          ) : null}
          {sessionsHref ? (
            <li>
              <Link
                href={sessionsHref}
                role="menuitem"
                data-account-menu-item
                className={styles.menuItem}
                onClick={() => setOpen(false)}
              >
                로그인 기기
              </Link>
            </li>
          ) : null}
          {privacyHref ? (
            <li>
              <Link
                href={privacyHref}
                role="menuitem"
                data-account-menu-item
                className={styles.menuItem}
                onClick={() => setOpen(false)}
              >
                개인정보와 데이터
              </Link>
            </li>
          ) : null}
          {serverConfirmedCanAccessPlatform && platformModeAction?.mode === "platform" ? (
            <li><DeveloperModeControl mode="user" serverConfirmedPlatform action={platformModeAction} /></li>
          ) : null}
          <li>
            <CurrentSessionLogout className={styles.menuItem} menuItem />
          </li>
        </ul>
      </div>
    </div>
  );
}
