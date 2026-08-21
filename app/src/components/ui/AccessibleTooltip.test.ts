import { describe, expect, it } from "vitest";
import { tooltipStateReducer, type TooltipState } from "./AccessibleTooltip";

describe("AccessibleTooltip interaction contract", () => {
  const closed: TooltipState = {
    open: false,
    blockedUntilPointerLeave: false,
    focused: false,
  };

  it("opens for pointer and keyboard focus, and Escape dismisses it", () => {
    expect(tooltipStateReducer(closed, "pointer-enter").open).toBe(true);
    const focused = tooltipStateReducer(closed, "focus");
    expect(focused.open).toBe(true);
    expect(tooltipStateReducer(focused, "escape").open).toBe(false);
  });

  it("closes on route change and cannot reopen under a stationary pointer", () => {
    const open = tooltipStateReducer(closed, "pointer-enter");
    const routed = tooltipStateReducer(open, "route-change");

    expect(routed).toEqual({ open: false, blockedUntilPointerLeave: true, focused: false });
    expect(tooltipStateReducer(routed, "pointer-enter")).toEqual(routed);
    expect(tooltipStateReducer(routed, "pointer-leave"))
      .toEqual({ open: false, blockedUntilPointerLeave: false, focused: false });
  });

  it("keeps the tooltip visible when the pointer leaves a focused trigger", () => {
    const focused = tooltipStateReducer(closed, "focus");
    expect(tooltipStateReducer(focused, "pointer-leave").open).toBe(true);
  });
});
