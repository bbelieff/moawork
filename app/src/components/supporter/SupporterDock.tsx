"use client";

import Link from "next/link";
import { useEffect, useRef, useSyncExternalStore } from "react";
import styles from "./supporter.module.css";
import {
  SUPPORTER_INPUT_MAX_LENGTH,
  useSupporter,
} from "./SupporterProvider";

/**
 * 서포터 열기 버튼. 기본 닫힘이라 이 버튼 한 줄이 닫힘 상태의 전부다.
 */
export function SupporterOpenButton() {
  const { setOpen, openerRef } = useSupporter();
  return (
    <button
      ref={openerRef}
      type="button"
      className={styles.openButton}
      onClick={() => setOpen(true)}
    >
      모아서포터
    </button>
  );
}

const USER_SUGGESTIONS = ["사용법 알려줘", "자동화 연결 안내"];
const OPERATIONS_SUGGESTIONS = ["연결 상태 확인해줘"];

const MOBILE_QUERY = "(max-width: 767px)";
function subscribeMobile(onChange: () => void) {
  const query = window.matchMedia?.(MOBILE_QUERY);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}
const mobileSnapshot = () => window.matchMedia?.(MOBILE_QUERY).matches ?? false;
const serverSnapshot = () => false;

/** 정적 도움말임을 표시하는 짧은 안내 링크 — 실제 제품 경로만 쓴다. */
export const SUPPORTER_HELP_LINKS = [
  { label: "자동화 설정", href: "/settings/automations" },
  { label: "조직관리", href: "/settings/members" },
];

/**
 * 오른쪽 접이식 서포터 패널. 닫힘 상태에서는 null 을 돌려줘
 * 기존 레이아웃에 시각 변경을 남기지 않는다.
 */
export function SupporterDock() {
  const {
    open,
    setOpen,
    mode,
    setMode,
    allowOperations,
    operationsGranted,
    thread,
    setDraft,
    submitNotConfigured,
    sessionNotice,
    requestSessionNotice,
    openerRef,
    statusLine,
  } = useSupporter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const isMobile = useSyncExternalStore(subscribeMobile, mobileSnapshot, serverSnapshot);
  const isOperations = mode === "operations";
  const showOpsToggle = allowOperations && operationsGranted === true;

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Tab" && isMobile) {
        const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), a[href], [tabindex="0"]',
        ) ?? []).filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (first && last && (!panelRef.current?.contains(document.activeElement)
          || (event.shiftKey ? document.activeElement === first : document.activeElement === last))) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
      if (event.key === "Escape") {
        setOpen(false);
        openerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen, openerRef, isMobile]);

  if (!open) return null;

  const suggestions = isOperations ? OPERATIONS_SUGGESTIONS : USER_SUGGESTIONS;

  function close() {
    setOpen(false);
    openerRef.current?.focus();
  }

  return (
    <aside ref={panelRef} role={isMobile ? "dialog" : undefined} aria-modal={isMobile || undefined} aria-label={isOperations ? "운영서포터" : "모아서포터"} className={styles.dock}>
      <div className={`${styles.panelHead} ${isOperations ? styles.panelHeadOps : ""}`}>
        <span className={styles.panelName}>{isOperations ? "운영서포터" : "모아서포터"}</span>
        <span className={styles.statusBadge}>{statusLine}</span>
        <button type="button" aria-label="서포터 닫기" className={styles.closeButton} onClick={close}>
          ✕
        </button>
      </div>

      {showOpsToggle ? (
        <div className={styles.opsRow}>
          <span className={styles.opsLabel}>화면 전환</span>
          <span>모아</span>
          <button
            type="button"
            role="switch"
            aria-checked={isOperations}
            aria-label="운영서포터 전환"
            className={styles.opsSwitch}
            data-on={isOperations}
            onClick={() => setMode(isOperations ? "user" : "operations")}
          >
            <span className={styles.opsKnob} aria-hidden="true" />
          </button>
          <span>운영서포터</span>
        </div>
      ) : null}

      {isOperations ? (
        <div className={styles.sessionRow}>
          <button type="button" className={styles.sessionButton} onClick={requestSessionNotice}>
            현재 세션 불러오기
          </button>
          {sessionNotice ? (
            <span className={styles.sessionNote} role="status">{sessionNotice}</span>
          ) : null}
        </div>
      ) : null}

      <div className={styles.chat} aria-live="polite">
        {thread.messages.map((message) =>
          message.from === "me" ? (
            <div key={message.id} className={`${styles.msg} ${styles.msgMe}`}>
              <span className={styles.msgWho}>나</span>
              {message.text}
            </div>
          ) : (
            <div key={message.id} className={styles.notice}>
              <p className={styles.noticeTitle}>
                {isOperations ? "운영서포터" : "모아서포터"}
                <span className={styles.staticTag}>정적 도움말</span>
              </p>
              <p>{message.text}</p>
              <ul className={styles.helpList}>
                {SUPPORTER_HELP_LINKS.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ),
        )}
      </div>

      {thread.error ? (
        <p role="status" className={styles.submitError}>{thread.error}</p>
      ) : null}

      <div className={styles.sugs}>
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            disabled={thread.pending}
            onClick={() => submitNotConfigured(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>

      <form
        className={styles.foot}
        onSubmit={(event) => {
          event.preventDefault();
          submitNotConfigured(thread.draft);
        }}
      >
        <input
          ref={inputRef}
          type="text"
          maxLength={SUPPORTER_INPUT_MAX_LENGTH}
          placeholder={isOperations ? "개발 세션 기준으로 요청해 보세요" : "모아서포터에게 요청해 보세요"}
          aria-label="서포터 입력"
          value={thread.draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={thread.pending}>보내기</button>
      </form>
      <span className={styles.counter} aria-label="입력 글자 수">
        {thread.draft.length} / {SUPPORTER_INPUT_MAX_LENGTH}
      </span>
    </aside>
  );
}
