"use client";

import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useReducer,
  useRef,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
} from "react";
import { usePathname } from "next/navigation";

type TriggerProps = {
  "aria-describedby"?: string;
  onBlur?: (event: FocusEvent<HTMLElement>) => void;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  onPointerEnter?: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (event: PointerEvent<HTMLElement>) => void;
};

export type TooltipState = {
  open: boolean;
  blockedUntilPointerLeave: boolean;
  focused: boolean;
};
export type TooltipEvent =
  | "blur"
  | "escape"
  | "focus"
  | "pointer-enter"
  | "pointer-leave"
  | "route-change";

export function tooltipStateReducer(state: TooltipState, event: TooltipEvent): TooltipState {
  switch (event) {
    case "route-change":
      return { open: false, blockedUntilPointerLeave: true, focused: false };
    case "pointer-enter":
      return state.blockedUntilPointerLeave ? state : { ...state, open: true };
    case "pointer-leave":
      return { ...state, open: state.focused, blockedUntilPointerLeave: false };
    case "focus":
      return { open: true, blockedUntilPointerLeave: false, focused: true };
    case "blur":
      return { ...state, open: false, focused: false };
    case "escape":
      return { ...state, open: false, focused: false };
  }
}

type Props = {
  children: ReactElement<TriggerProps>;
  content: string;
  fill?: boolean;
  placement?: "bottom" | "sidebar";
};

export function AccessibleTooltip({ children, content, fill = false, placement = "sidebar" }: Props) {
  const pathname = usePathname();
  const previousPathname = useRef(pathname);
  const tooltipId = useId();
  const [state, dispatch] = useReducer(tooltipStateReducer, {
    open: false,
    blockedUntilPointerLeave: false,
    focused: false,
  });

  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    dispatch("route-change");
  }, [pathname]);

  if (!isValidElement(children)) return children;

  const trigger = cloneElement(children, {
    "aria-describedby": [children.props["aria-describedby"], tooltipId]
      .filter(Boolean)
      .join(" "),
    onPointerEnter: (event) => {
      children.props.onPointerEnter?.(event);
      dispatch("pointer-enter");
    },
    onPointerLeave: (event) => {
      children.props.onPointerLeave?.(event);
      dispatch("pointer-leave");
    },
    onFocus: (event) => {
      children.props.onFocus?.(event);
      dispatch("focus");
    },
    onBlur: (event) => {
      children.props.onBlur?.(event);
      dispatch("blur");
    },
    onKeyDown: (event) => {
      children.props.onKeyDown?.(event);
      if (event.key === "Escape") dispatch("escape");
    },
  });

  const position = placement === "bottom"
    ? { right: 0, top: "calc(100% + var(--sp-2))" }
    : { left: "var(--sp-2)", top: "calc(100% + var(--sp-1))" };

  return (
    <span
      className={fill ? "relative flex w-full" : "relative inline-flex"}
      style={{ zIndex: state.open ? 60 : undefined }}
    >
      {trigger}
      <span
        id={tooltipId}
        role="tooltip"
        data-tooltip-open={state.open ? "true" : "false"}
        className="pointer-events-none absolute z-50 whitespace-nowrap border text-left shadow-sm"
        style={{
          ...position,
          borderColor: "var(--mw-line)",
          borderRadius: "var(--mw-r-2)",
          background: "var(--mw-fg)",
          color: "var(--mw-card)",
          fontSize: "var(--fs-11)",
          lineHeight: 1.4,
          padding: "var(--sp-1) var(--sp-2)",
          opacity: state.open ? 1 : 0,
          visibility: state.open ? "visible" : "hidden",
        }}
      >
        {content}
      </span>
    </span>
  );
}
