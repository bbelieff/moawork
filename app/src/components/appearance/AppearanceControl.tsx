"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AccessibleTooltip } from "@/components/ui/AccessibleTooltip";
import {
  APPEARANCE_DEFAULT,
  APPEARANCE_STORAGE_KEY,
  APPEARANCE_PRESET_GRADS,
  APPEARANCE_PRESET_IDS,
  type AppearanceEffects,
  type AppearancePresetId,
} from "@/lib/appearance/vivid";
import {
  APPEARANCE_CHANGE_EVENT,
  readAppearancePreference,
  storeAppearancePreference,
} from "./RouteAppearance";

/** 프리셋 짧은 한글 이름(저장 id·원천 영문명은 lib에 그대로). */
const PRESET_LABEL: Record<AppearancePresetId, string> = {
  signal: "엠버",
  lagoon: "리프",
  graphite: "바이올렛",
  forest: "모스",
  alloy: "스카이",
  orchid: "오키드",
  arctic: "시안",
  aurora: "블루",
  coral: "탠저린",
  amber: "허니",
};

/**
 * 기존 테마 어포던스 옆의 작은 외관 조절기.
 * 본인 외관(회사 강조 프리셋·그라디언트 효과)만 다루고 업무 데이터는 만지지 않는다.
 * 새 설정 페이지 없음 — 버튼+팝오버 하나다.
 */
export function AppearanceControl() {
  const [preset, setPreset] = useState<AppearancePresetId>(APPEARANCE_DEFAULT.preset);
  const [effects, setEffects] = useState<AppearanceEffects>(APPEARANCE_DEFAULT.effects);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dialogId = useId();

  useEffect(() => {
    const sync = () => {
      const stored = readAppearancePreference();
      setPreset(stored.preset);
      setEffects(stored.effects);
    };
    sync();
    const onStorage = (event: StorageEvent) => {
      if (event.key === APPEARANCE_STORAGE_KEY) sync();
    };
    window.addEventListener(APPEARANCE_CHANGE_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(APPEARANCE_CHANGE_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLButtonElement>(`[data-preset="${preset}"]`)
        ?.focus();
    });
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        queueMicrotask(() => buttonRef.current?.focus());
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, preset]);

  const choose = (next: AppearancePresetId) => {
    const stored = storeAppearancePreference({ preset: next, effects });
    setPreset(stored.preset);
    setEffects(stored.effects);
  };
  const toggleEffects = () => {
    const stored = storeAppearancePreference({
      preset,
      effects: effects === "on" ? "off" : "on",
    });
    setPreset(stored.preset);
    setEffects(stored.effects);
  };
  const reset = () => {
    const stored = storeAppearancePreference({ ...APPEARANCE_DEFAULT });
    setPreset(stored.preset);
    setEffects(stored.effects);
  };

  return (
    <div ref={rootRef} className="relative">
      <AccessibleTooltip content="화면 표시 설정" placement="bottom">
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-label="화면 표시 설정"
          aria-pressed={open}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? dialogId : undefined}
          className="flex items-center justify-center gap-1 border"
          style={{
            width: "var(--mw-shell-iconbtn-size)",
            height: "var(--mw-shell-iconbtn-size)",
            borderRadius: "var(--mw-r-2)",
            background: "var(--mw-card)",
            borderColor: "var(--mw-line)",
            color: "var(--mw-fg)",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: APPEARANCE_PRESET_GRADS[preset].grad,
              border: "1px solid var(--mw-line)",
              flex: "none",
            }}
          />
        </button>
      </AccessibleTooltip>

      {open ? (
        <div
          ref={panelRef}
          id={dialogId}
          role="dialog"
          aria-label="화면 표시 설정"
          data-mw-appearance-popover
          className="mw-layer-shell-popover absolute end-0 top-full z-[var(--mw-layer-shell-popover)] mt-2 w-[min(19rem,calc(100vw-2rem))] border bg-mw-card p-3 shadow-lg"
          style={{ borderColor: "var(--mw-line)" }}
        >
          <p className="text-xs font-semibold text-mw-fg">회사 강조색</p>
          <p className="mt-0.5 text-[11px] leading-4 text-mw-sub">
            워크스페이스 표식 링에 쓰입니다. 탭 색은 바뀌지 않습니다.
          </p>
          <div role="radiogroup" aria-label="회사 강조색" className="mt-2 grid grid-cols-5 gap-1.5">
            {APPEARANCE_PRESET_IDS.map((id) => {
              const selected = id === preset;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  tabIndex={selected ? 0 : -1}
                  onKeyDown={(event) => {
                    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
                    if (!keys.includes(event.key)) return;
                    event.preventDefault();
                    const index = APPEARANCE_PRESET_IDS.indexOf(id);
                    const next = event.key === "Home" ? 0 : event.key === "End" ? APPEARANCE_PRESET_IDS.length - 1
                      : (index + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + APPEARANCE_PRESET_IDS.length) % APPEARANCE_PRESET_IDS.length;
                    choose(APPEARANCE_PRESET_IDS[next]);
                  }}
                  aria-checked={selected}
                  data-preset={id}
                  aria-label={`회사 강조색 ${PRESET_LABEL[id]}${selected ? " (선택됨)" : ""}`}
                  onClick={() => choose(id)}
                  className="flex flex-col items-center gap-1 rounded-md p-1.5 hover:bg-mw-bg focus-visible:outline-2 focus-visible:outline-[var(--mw-primary)]"
                  style={selected ? { outline: "2px solid var(--mw-primary)", outlineOffset: 1 } : undefined}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: "50%",
                      background: APPEARANCE_PRESET_GRADS[id].grad,
                      border: "1px solid var(--mw-line)",
                    }}
                  />
                  <span className="text-[10px] leading-3 text-mw-sub">{PRESET_LABEL[id]}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-mw-line pt-3">
            <span id={`${dialogId}-effects-label`} className="text-xs text-mw-fg">
              그라디언트 효과
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={effects === "on"}
              aria-labelledby={`${dialogId}-effects-label`}
              onClick={toggleEffects}
              className="h-6 w-11 shrink-0 rounded-full border border-mw-line bg-mw-bg p-0.5"
            >
              <span
                aria-hidden="true"
                className="block h-full aspect-square rounded-full bg-mw-primary transition-[margin] duration-150"
                style={effects === "on" ? { marginLeft: "auto" } : undefined}
              />
            </button>
          </div>

          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={reset}
              className="rounded-md px-2 py-1 text-xs text-mw-sub hover:bg-mw-bg hover:text-mw-fg"
            >
              기본값으로
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
