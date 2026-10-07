"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { createTabFromSidebarAction } from "@/app/(app)/boards/actions";
import { INITIAL_CREATE_TAB_ACTION_STATE } from "@/app/(app)/boards/create-tab-action-state";
import type { BoardNavSection } from "@/lib/boards/types";
import { Icon } from "./icons";

/**
 * #849 — 사이드바 업무 묶음 끝의 「새 탭」 줄과 그 팝오버(2026-10-06 승인 목업 L01).
 *
 * - 줄은 다른 중첩 메뉴와 같은 높이·여백·모서리·글자다(흐린 글자색만 다르다).
 * - 팝오버는 사이드바 오른쪽에 뜬다. 사이드바 메뉴는 세로 스크롤 영역이라 그 안에 그리면
 *   잘리므로 body 로 옮겨 그린다(WorkspaceSwitcher·요약 설정과 같은 방식).
 * - 제출은 createTabFromSidebarAction(본문은 createBoardAction 과 같다)으로 간다. 실패는 던지지 않고
 *   폼 아래 한 줄로 돌아온다 — 이 폼은 모든 화면의 사이드바에 있고 그 위에 오류 경계가 없어서,
 *   던지면 셸 전체가 오류 화면으로 덮인다. 성공하면 액션이 새 탭으로 이동시킨다.
 * - 요청 ID 는 «열 때마다 새로» 만든다 — 같은 창에서 두 번 눌러도 탭은 하나만 생기고,
 *   다시 열어 만들면 새 탭이 된다. 실패한 뒤 같은 창에서 다시 누르면 같은 ID 다(응답만 잃은
 *   경우 같은 탭을 돌려받게). 폼 상태(오류 줄)도 열 때마다 새로 시작한다.
 * - 사이드바는 지속 레이아웃이라 화면이 바뀌어도 이 부품이 살아 있다. 그래서 화면(경로)이 바뀌면
 *   닫고 요청 ID 를 버린다 — 만들기 성공 후 새 탭 위에 창이 남아 같은 ID 로 또 보내지 않게.
 */

export const NEW_TAB_PLACE_OPTIONS: ReadonlyArray<{ value: BoardNavSection; label: string }> = [
  { value: "before-contract", label: "업무 › 계약 전" },
  { value: "after-contract", label: "업무 › 계약 후" },
];
export const NEW_TAB_DEFAULT_PLACE: BoardNavSection = "after-contract";
export const NEW_TAB_HINT = "기본 아이템 1개와 기본 열 3개(상태 · 담당 · 마감일)가 함께 만들어져요.";
const NAME_REQUIRED = "탭 이름을 적어 주세요.";
const POPOVER_EVENT = "moawork:popover-open";
/** 화면 가장자리·사이드바와 띄우는 거리(px). 위치 계산에만 쓴다. */
const EDGE = 8;
const SIDEBAR_GAP = 12;
/** 사이드바 요약(summary)과 같은 키보드 초점 표시 — 브라우저 기본 고리 대신 브랜드 색. */
const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--mw-primary)]";

function freshRequestId(): string {
  // 못 만들면 빈 값 — 서버 액션이 그때 자기 ID 를 만든다(두 번 누름 방지만 약해진다).
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : "";
}

function BodyPortal({ children }: { children: ReactNode }) {
  return typeof document === "undefined" ? children : createPortal(children, document.body);
}

function focusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>("input, select, textarea, button, a[href]")]
    .filter((element) => !element.hasAttribute("disabled") && element.getAttribute("type") !== "hidden");
}

function SubmitButton({ pending }: { pending: boolean }) {
  return (
    <button
      type="submit"
      data-mw-cta="primary"
      disabled={pending}
      aria-busy={pending || undefined}
      className={`inline-flex items-center justify-center font-semibold disabled:cursor-wait disabled:opacity-70 ${FOCUS_RING}`}
      style={{
        minHeight: "var(--sp-10)",
        paddingInline: "var(--sp-5)",
        borderRadius: "var(--mw-r-2)",
        background: "var(--mw-primary)",
        color: "var(--mw-on-accent)",
        fontSize: "var(--fs-14)",
      }}
    >
      {pending ? "만드는 중…" : "만들기"}
    </button>
  );
}

type Position = { left: number; top: number; maxHeight: number; caretTop: number | null };

export function SidebarNewTab({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [requestId, setRequestId] = useState(() => (defaultOpen ? freshRequestId() : ""));
  /** 열 때마다 1씩 — 폼을 새로 그려(키) 지난번 오류 줄·입력·제출 상태를 남기지 않는다. */
  const [openCount, setOpenCount] = useState(0);
  const [position, setPosition] = useState<Position>({ left: EDGE, top: EDGE, maxHeight: 0, caretTop: null });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  /** 지금 열린 팝오버의 위치 계산. 폼 안 오류 줄이 생기고 없어질 때 폼이 부른다. */
  const placeRef = useRef<() => void>(() => {});
  const pathname = usePathname();
  const seenPathRef = useRef(pathname);
  const id = useId();
  const panelId = `${id}-panel`;
  const titleId = `${id}-title`;

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) queueMicrotask(() => triggerRef.current?.focus());
  }, []);

  // 화면(경로)이 바뀌면 닫고 요청 ID 를 버린다. 만들기가 성공하면 액션이 새 탭으로 이동시키는데,
  // 사이드바는 지속 레이아웃이라 이 부품의 상태가 그대로 살아남는다 — 닫지 않으면 새 탭 위에 창이 남고,
  // 거기서 또 보내면 같은 요청 ID 에 다른 내용이라 서버가 거절한다(request_replay_conflict).
  useEffect(() => {
    if (seenPathRef.current === pathname) return;
    seenPathRef.current = pathname;
    close(false);
    setRequestId("");
  }, [close, pathname]);

  // 다른 팝오버(회사 전환·필터 등)가 열리면 닫는다 — 둘이 겹쳐 뜨지 않게.
  useEffect(() => {
    const closeOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) close(false);
    };
    window.addEventListener(POPOVER_EVENT, closeOther);
    return () => window.removeEventListener(POPOVER_EVENT, closeOther);
  }, [close, id]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [close, open]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = triggerRef.current;
      const rect = trigger?.getBoundingClientRect();
      if (!trigger || !rect) return;
      const panel = panelRef.current;
      const width = panel?.offsetWidth ?? 0;
      const height = panel?.offsetHeight ?? 0;
      // 사이드바 오른쪽 바깥 — 사이드바가 화면을 다 차지하면(좁은 창) 화면 안쪽으로 당긴다.
      const sidebarRight = trigger.closest("aside")?.getBoundingClientRect().right ?? rect.right;
      const besideSidebar = sidebarRight + SIDEBAR_GAP;
      const left = besideSidebar + width <= window.innerWidth - EDGE
        ? besideSidebar
        : Math.max(EDGE, window.innerWidth - width - EDGE);
      const top = Math.max(EDGE, Math.min(rect.top - EDGE, window.innerHeight - height - EDGE));
      // 꼬리는 줄이 팝오버 높이 안에 보일 때만 — 줄이 스크롤로 밖에 있으면 허공을 가리키게 된다.
      const pointAt = rect.top + rect.height / 2 - top;
      const caretTop = left === besideSidebar && pointAt >= SIDEBAR_GAP * 2 && pointAt <= height - SIDEBAR_GAP * 2
        ? pointAt
        : null;
      setPosition({ left, top, maxHeight: Math.max(0, window.innerHeight - EDGE * 2), caretTop });
    };
    // 팝오버는 이 커밋에서 이미 그려져 있어 크기를 바로 잴 수 있다. 오류 줄이 생기고 없어질 때는
    // 폼이 placeRef 로 다시 맞춘다 — 키가 늘어 아래가 화면 밖으로 나가지 않게. 글꼴 로딩처럼 그 밖의
    // 크기 변화는 ResizeObserver 가 잡는다.
    placeRef.current = place;
    place();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    if (panelRef.current) resize?.observe(panelRef.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      placeRef.current = () => {};
      resize?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // 열리면 탭 이름 칸으로 간다(목업 L01: 닫히면 「새 탭」 줄로 돌아온다).
  // 다음 프레임을 기다리지 않는다 — 칸은 커밋 때 이미 있고, 프레임이 멈춘 창에서도 옮겨져야 한다.
  useEffect(() => {
    if (open) nameRef.current?.focus();
  }, [open]);

  const replace = useCallback(() => placeRef.current(), []);
  const cancel = useCallback(() => close(), [close]);

  function toggle() {
    if (open) {
      close();
      return;
    }
    setRequestId(freshRequestId());
    setOpenCount((count) => count + 1);
    seenPathRef.current = pathname;
    setOpen(true);
    window.dispatchEvent(new CustomEvent(POPOVER_EVENT, { detail: id }));
  }

  // 대화상자 안에서 Tab 이 맴돈다 — body 끝에 그려져서 밖으로 나가면 페이지 맨 끝으로 튄다.
  function onPanelKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const items = focusables(panelRef.current);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div data-nav-new-tab="">
      <button
        ref={triggerRef}
        type="button"
        data-nav-key="new-tab"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={toggle}
        className={`flex w-full items-center text-left hover:bg-[var(--mw-bg)] ${FOCUS_RING}`}
        style={{
          gap: "var(--sp-2)",
          height: "var(--mw-shell-item-h)",
          borderRadius: "var(--mw-r-3)",
          paddingLeft: "var(--sp-6)",
          paddingRight: "var(--sp-3)",
          fontSize: "var(--mw-shell-item-fs)",
          color: open ? "var(--mw-fg)" : "var(--mw-sub)",
          background: open ? "var(--mw-bg)" : undefined,
        }}
      >
        <Icon name="plus" />
        <span className="flex-1 truncate">새 탭</span>
      </button>

      {open ? (
        <BodyPortal>
          <section
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-labelledby={titleId}
            data-sidebar-new-tab-dialog=""
            onKeyDown={onPanelKeyDown}
            className="mw-layer-shell-popover fixed"
            style={{
              left: position.left,
              top: position.top,
              width: "min(25rem, calc(100vw - 1rem))",
            }}
          >
            {/* 꼬리 — 「새 탭」 줄을 가리킨다. 스크롤 상자 밖에 둬야 잘리지 않는다. */}
            {position.caretTop !== null ? (
              <span
                aria-hidden="true"
                className="absolute rotate-45 border-b border-l"
                style={{
                  left: "calc(var(--sp-3) / -2)",
                  top: `calc(${position.caretTop}px - var(--sp-3) / 2)`,
                  width: "var(--sp-3)",
                  height: "var(--sp-3)",
                  background: "var(--mw-card)",
                  borderColor: "var(--mw-line)",
                  zIndex: 1,
                }}
              />
            ) : null}
            <div
              className="flex flex-col overflow-y-auto border"
              style={{
                maxHeight: position.maxHeight || undefined,
                gap: "var(--sp-4)",
                padding: "var(--sp-5)",
                borderRadius: "var(--mw-r-3)",
                borderColor: "var(--mw-line)",
                background: "var(--mw-card)",
                color: "var(--mw-fg)",
                boxShadow: "var(--mw-sh-pop)",
              }}
            >
              <h2 id={titleId} className="font-bold" style={{ fontSize: "var(--fs-16)", color: "var(--mw-fg)" }}>
                새 탭 만들기
              </h2>
              <NewTabForm
                key={openCount}
                requestId={requestId}
                nameRef={nameRef}
                onCancel={cancel}
                onLayoutChange={replace}
              />
            </div>
          </section>
        </BodyPortal>
      ) : null}
    </div>
  );
}

/**
 * 팝오버 안의 폼. 열 때마다 키가 바뀌어 새로 그려진다 — 지난번 실패 줄·입력·제출 상태를 끌고 오지 않는다.
 */
function NewTabForm({
  requestId,
  nameRef,
  onCancel,
  onLayoutChange,
}: {
  requestId: string;
  nameRef: RefObject<HTMLInputElement | null>;
  onCancel: () => void;
  onLayoutChange: () => void;
}) {
  const [state, formAction, pending] = useActionState(createTabFromSidebarAction, INITIAL_CREATE_TAB_ACTION_STATE);
  // 입력은 상태로 쥔다 — React 는 폼 액션이 끝나면 «제어되지 않는» 칸을 비운다. 서버가 거절했을 때
  // 적던 이름·고른 자리가 사라지면 처음부터 다시 써야 한다.
  const [name, setName] = useState("");
  const [place, setPlace] = useState<BoardNavSection>(NEW_TAB_DEFAULT_PLACE);
  const [nameError, setNameError] = useState(false);
  const id = useId();
  const nameId = `${id}-name`;
  const nameErrorId = `${id}-name-error`;
  const placeId = `${id}-place`;
  const placeHintId = `${id}-place-hint`;
  const actionErrorId = `${id}-action-error`;

  // 오류 줄이 생기고 없어지면 팝오버 키가 바뀐다 — 위치를 다시 맞춘다.
  useLayoutEffect(() => {
    onLayoutChange();
  }, [nameError, state.error, onLayoutChange]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const value = new FormData(event.currentTarget).get("name");
    if (typeof value === "string" && value.trim()) return;
    // 비었거나 공백뿐이면 보내지 않는다 — 서버까지 갈 필요가 없는 실패다.
    event.preventDefault();
    setNameError(true);
    nameRef.current?.focus();
  }

  const labelStyle = { color: "var(--mw-fg)", fontSize: "var(--fs-13)" } as const;
  const fieldStyle = {
    minHeight: "var(--sp-10)",
    paddingInline: "var(--sp-3)",
    borderRadius: "var(--mw-r-2)",
    border: `1px solid ${nameError ? "var(--mw-error)" : "var(--mw-line)"}`,
    background: "var(--mw-card)",
    color: "var(--mw-fg)",
    fontSize: "var(--fs-14)",
  } as const;

  return (
    <form
      action={formAction}
      onSubmit={onSubmit}
      noValidate
      aria-describedby={state.error ? actionErrorId : undefined}
      className="flex flex-col"
      style={{ gap: "var(--sp-4)" }}
    >
      <input type="hidden" name="requestId" value={requestId} />

      <div className="flex flex-col" style={{ gap: "var(--sp-1)" }}>
        <label htmlFor={nameId} className="font-medium" style={labelStyle}>탭 이름</label>
        <input
          ref={nameRef}
          id={nameId}
          name="name"
          type="text"
          required
          maxLength={100}
          autoComplete="off"
          aria-invalid={nameError || undefined}
          aria-describedby={nameError ? nameErrorId : undefined}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (nameError) setNameError(false);
          }}
          className={FOCUS_RING}
          style={fieldStyle}
        />
        {nameError ? (
          <p id={nameErrorId} role="alert" style={{ color: "var(--mw-error)", fontSize: "var(--fs-13)" }}>
            {NAME_REQUIRED}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col" style={{ gap: "var(--sp-1)" }}>
        <label htmlFor={placeId} className="font-medium" style={labelStyle}>어디에 둘까요</label>
        <select
          id={placeId}
          name="nav_section"
          value={place}
          onChange={(event) => setPlace(event.target.value === "before-contract" ? "before-contract" : "after-contract")}
          aria-describedby={placeHintId}
          className={`cursor-pointer ${FOCUS_RING}`}
          style={{ ...fieldStyle, border: "1px solid var(--mw-line)" }}
        >
          {NEW_TAB_PLACE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <p id={placeHintId} style={{ color: "var(--mw-sub)", fontSize: "var(--fs-12)" }}>
          사이드바 업무 아래 고른 묶음 맨 끝에 들어가요.
        </p>
      </div>

      <p
        className="flex items-start"
        style={{
          gap: "var(--sp-2)",
          padding: "var(--sp-2) var(--sp-3)",
          borderRadius: "var(--mw-r-2)",
          background: "var(--mw-tint-blue)",
          color: "var(--mw-body)",
          fontSize: "var(--fs-13)",
        }}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ width: "var(--mw-icon-size)", height: "var(--mw-icon-size)", flex: "0 0 var(--mw-icon-size)", color: "var(--mw-primary)", marginTop: "calc(var(--sp-1) / 2)" }}
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8h.01" />
        </svg>
        <span>{NEW_TAB_HINT}</span>
      </p>

      {/* 서버가 거절한 이유(권한·입력·일시 오류). 던지지 않고 여기 한 줄로 — 셸이 오류 화면으로 덮이지 않게. */}
      {state.error ? (
        <p id={actionErrorId} role="alert" data-new-tab-error="" style={{ color: "var(--mw-error)", fontSize: "var(--fs-13)" }}>
          {state.error}
        </p>
      ) : null}

      <div className="flex flex-wrap justify-end" style={{ gap: "var(--sp-2)" }}>
        <button
          type="button"
          onClick={onCancel}
          className={`inline-flex items-center justify-center border font-medium hover:bg-[var(--mw-bg)] ${FOCUS_RING}`}
          style={{
            minHeight: "var(--sp-10)",
            paddingInline: "var(--sp-4)",
            borderRadius: "var(--mw-r-2)",
            borderColor: "var(--mw-line)",
            background: "var(--mw-card)",
            color: "var(--mw-fg)",
            fontSize: "var(--fs-14)",
          }}
        >
          취소
        </button>
        <SubmitButton pending={pending} />
      </div>
    </form>
  );
}
