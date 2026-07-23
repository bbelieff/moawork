"use client";

import { useId, useRef } from "react";
import styles from "./account.module.css";

type Props = {
  className?: string;
  menuItem?: boolean;
};

export function CurrentSessionLogout({ className, menuItem = false }: Props) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  function openDialog() {
    dialogRef.current?.showModal();
    requestAnimationFrame(() => cancelRef.current?.focus());
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className ?? styles.secondaryAction}
        role={menuItem ? "menuitem" : undefined}
        data-account-menu-item={menuItem ? "" : undefined}
        onClick={openDialog}
      >
        이 기기에서 로그아웃
      </button>
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClose={() => triggerRef.current?.focus()}
      >
        <div className={styles.dialogBody}>
          <h2 id={titleId}>이 기기에서 로그아웃할까요?</h2>
          <p id={descriptionId}>
            이 브라우저의 로그인만 끝나요. 다른 기기에서는 계속 사용할 수
            있어요.
          </p>
        </div>
        <div className={styles.dialogActions}>
          <button
            ref={cancelRef}
            type="button"
            className={styles.secondaryAction}
            onClick={closeDialog}
          >
            계속 사용하기
          </button>
          <form action="/auth/signout" method="post">
            <button type="submit" className={styles.dangerAction}>
              이 기기에서 로그아웃
            </button>
          </form>
        </div>
      </dialog>
    </>
  );
}
