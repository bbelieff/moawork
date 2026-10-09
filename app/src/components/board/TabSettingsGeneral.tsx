"use client";

/**
 * 탭 설정 › 일반 — 탭 이름 · 아이콘 · 설명 (#845 개선안, 2026-10-08).
 *
 * · 이름은 머리말 제목과 같은 저장 경로(renameBoardTitleAction)다. 칸을 떠나거나 Enter 로 저장한다.
 * · 아이콘은 선 아이콘 한 벌(16개) 중 하나를 누르면 바로 저장한다. 옛 이모지 저장값은 같은 그림이 골라진 채로 보인다.
 * · 설명은 200자까지, 칸을 떠나거나 Enter 로 저장한다. 비우면 지운다.
 * · 고치던 글자가 있을 때 Esc 는 그 글자를 되돌린다(대화상자는 닫히지 않는다). 다시 누르면 닫힌다.
 * · 바깥 누르기·닫기로 창이 먼저 닫혀도 고치던 글자는 그때 한 번 저장한다.
 * 저장 함수는 바꿔 끼울 수 있다 — 시각 픽스처가 저장소 경계만 대신한다.
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { renameBoardTitleAction, updateBoardIdentityAction, type BoardIdentityPatch, type BoardIdentityResult, type InlineTitleResult } from "@/app/(app)/boards/title-actions";
import { resolveBoardIconKey, TAB_ICON_KEYS, TAB_ICON_LABELS, type TabIconKey } from "@/lib/boards/board-icons";
import { noticeLive, noticeRole, type ResultNotice } from "@/lib/ui/result-notice";
import { TabIcon } from "./TabIcon";
import { OWNS_ESCAPE_ATTRIBUTE, useTabChrome } from "./tab-chrome";

const DESCRIPTION_MAX = 200;
/** 넓은 화면의 한 줄 칸 수 — 그려진 격자를 읽지 못할 때 쓴다(640px 아래는 6칸). */
const ICON_COLUMNS = 8;
const INPUT = "h-[38px] w-full rounded-[9px] border border-mw-line bg-mw-card px-3 text-[length:var(--fs-14)] font-normal text-mw-fg outline-none focus:border-[color:var(--mw-tab-icon,var(--mw-record))] focus:ring-2 focus:ring-mw-primary/30 aria-busy:opacity-60";

export function TabSettingsGeneral({
  boardId,
  name,
  icon,
  source,
  description,
  renameAction = renameBoardTitleAction,
  identityAction = updateBoardIdentityAction,
}: {
  boardId: string;
  name: string;
  /** 저장된 아이콘 값(아이콘 키·옛 이모지·빈 값). */
  icon: string | null;
  source?: string | null;
  description: string | null;
  renameAction?: (boardId: string, value: string) => Promise<InlineTitleResult>;
  identityAction?: (boardId: string, patch: BoardIdentityPatch) => Promise<BoardIdentityResult>;
}) {
  const chrome = useTabChrome();
  const field = chrome?.settingsField ?? null;
  const base = useId().replace(/:/gu, "");
  const [notice, setNotice] = useState<ResultNotice | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const iconGridRef = useRef<HTMLDivElement>(null);

  // ▾ 메뉴의 「아이콘 바꾸기」·「설명 고치기」 로 열었으면 그 칸에 바로 초점을 준다.
  useEffect(() => {
    if (field === "name") nameRef.current?.focus();
    else if (field === "description") descriptionRef.current?.focus();
    else if (field === "icon") iconGridRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
    // 연 순간 한 번만.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-[18px]" data-tab-settings-general>
      <TextSetting
        inputRef={nameRef}
        label="탭 이름"
        value={name}
        maxLength={100}
        requiredMessage="탭 이름을 입력해 주세요."
        onSave={async (value) => {
          const result = await renameAction(boardId, value);
          if (result.ok) return { ok: true, value: result.name, message: "탭 이름을 저장했어요." };
          return { ok: false, message: result.message };
        }}
        onNotice={setNotice}
      />

      <IconPicker
        gridRef={iconGridRef}
        labelId={`${base}-icon-label`}
        stored={icon}
        initial={resolveBoardIconKey(icon, source)}
        onSave={async (key) => {
          const result = await identityAction(boardId, { icon: key });
          return result.ok ? { ok: true, message: `아이콘을 ‘${TAB_ICON_LABELS[key]}’(으)로 바꿨어요.` } : { ok: false, message: result.message };
        }}
        onNotice={setNotice}
      />

      <TextSetting
        inputRef={descriptionRef}
        label="설명"
        hint="제목 옆 ⓘ 에 보여요"
        value={description ?? ""}
        maxLength={DESCRIPTION_MAX}
        onSave={async (value) => {
          const result = await identityAction(boardId, { description: value });
          if (result.ok) return { ok: true, value: result.description ?? "", message: value ? "설명을 저장했어요." : "설명을 지웠어요." };
          return { ok: false, message: result.message };
        }}
        onNotice={setNotice}
      />

      {chrome?.requestTrash ? (
        <p className="flex items-center gap-2.5 rounded-[10px] bg-[color:var(--mw-board-canvas)] px-3.5 py-3 text-[length:var(--fs-13)] text-mw-body">
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true" focusable="false" style={{ flex: "none" }}>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8h.01M11 12h1v4h1" />
          </svg>
          탭을 휴지통으로 옮기려면 제목 옆 ▾ 메뉴에서 「휴지통으로 이동」을 골라요.
        </p>
      ) : null}

      <p
        role={notice ? noticeRole(notice.ok) : "status"}
        aria-live={notice ? noticeLive(notice.ok) : "polite"}
        data-tab-settings-notice
        className={`min-h-5 text-[length:var(--fs-12)] ${notice && !notice.ok ? "text-mw-error" : "text-mw-sub"}`}
      >
        {notice?.message ?? ""}
      </p>
    </div>
  );
}

type SaveOutcome = { ok: true; value?: string; message: string } | { ok: false; message: string };

function TextSetting({
  inputRef,
  label,
  hint,
  value,
  maxLength,
  requiredMessage,
  onSave,
  onNotice,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  label: string;
  hint?: string;
  value: string;
  maxLength: number;
  /** 있으면 빈 값을 저장하지 않고 이 말을 보인다. */
  requiredMessage?: string;
  onSave(value: string): Promise<SaveOutcome>;
  onNotice(notice: ResultNotice): void;
}) {
  const [saved, setSaved] = useState(value);
  const [observed, setObserved] = useState(value);
  const [draft, setDraft] = useState(value);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  // 서버가 새 값을 내려주면(다른 곳에서 고침) 고치던 중이 아닐 때만 따라간다.
  if (value !== observed && !pending && draft === saved) {
    setObserved(value);
    setSaved(value);
    setDraft(value);
  }
  const dirty = draft !== saved;

  // 바깥 누르기는 pointerdown 에서 대화상자를 닫는다 — 입력칸은 blur 없이 사라진다. 고치던 글자는 그때 저장한다
  // (칸을 떠나 이미 저장 중이면 다시 보내지 않는다). 창이 닫혔으니 결과 알림은 없다.
  const latestRef = useRef({ draft, saved, requiredMessage, onSave });
  useEffect(() => {
    latestRef.current = { draft, saved, requiredMessage, onSave };
  });
  useEffect(() => () => {
    if (pendingRef.current) return;
    const latest = latestRef.current;
    const next = latest.draft.trim();
    if (next === latest.saved.trim() || (latest.requiredMessage && !next)) return;
    void latest.onSave(next).catch(() => undefined);
  }, []);

  const commit = async () => {
    if (pendingRef.current) return;
    const next = draft.trim();
    if (next === saved.trim()) {
      setDraft(saved);
      return;
    }
    if (requiredMessage && !next) {
      onNotice({ ok: false, message: requiredMessage });
      setDraft(saved);
      return;
    }
    pendingRef.current = true;
    setPending(true);
    try {
      const result = await onSave(next);
      if (result.ok) {
        const stored = result.value ?? next;
        setSaved(stored);
        setDraft(stored);
      } else {
        setDraft(saved);
      }
      onNotice(result.ok ? { ok: true, message: result.message } : { ok: false, message: result.message });
    } catch {
      setDraft(saved);
      onNotice({ ok: false, message: "저장하지 못했어요. 다시 시도해 주세요." });
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void commit();
    } else if (event.key === "Escape" && dirty) {
      // 고치던 글자만 되돌린다 — 대화상자는 다음 Esc 에 닫힌다.
      event.preventDefault();
      setDraft(saved);
    }
  };

  return (
    <label className="flex flex-col gap-1.5 text-[length:var(--fs-13)] font-semibold text-mw-fg">
      <span className="flex items-baseline gap-2">
        {label}
        {hint ? <span className="text-[length:var(--fs-12)] font-normal text-mw-sub">{hint}</span> : null}
      </span>
      <input
        ref={inputRef}
        value={draft}
        maxLength={maxLength}
        // 저장하는 동안 잠그되 초점은 지킨다 — disabled 는 초점을 대화상자 밖(문서)으로 떨어뜨린다.
        readOnly={pending}
        aria-busy={pending || undefined}
        {...{ [OWNS_ESCAPE_ATTRIBUTE]: dirty ? "true" : "false" }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={onKeyDown}
        className={INPUT}
      />
    </label>
  );
}

/** 격자 한 줄의 칸 수 — 화면이 그린 열을 센다. 읽을 수 없으면 넓은 화면의 8칸으로 본다. */
function iconColumns(grid: HTMLElement | null): number {
  const tracks = grid ? getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/u).filter((track) => /^\d/u.test(track)).length : 0;
  return tracks > 0 ? tracks : ICON_COLUMNS;
}

function IconPicker({
  gridRef,
  labelId,
  stored,
  initial,
  onSave,
  onNotice,
}: {
  gridRef: RefObject<HTMLDivElement | null>;
  labelId: string;
  /** 저장소에 적힌 값 그대로(아이콘 키·옛 이모지·빈 값). */
  stored: string | null;
  initial: TabIconKey;
  onSave(key: TabIconKey): Promise<{ ok: boolean; message: string }>;
  onNotice(notice: ResultNotice): void;
}) {
  const [observed, setObserved] = useState({ stored, initial });
  const [selected, setSelected] = useState(initial);
  // 실제로 저장된 값 — 옛 이모지·빈 값은 같은 그림이 골라져 보여도 아직 아이콘 키가 아니다.
  const [savedRaw, setSavedRaw] = useState(stored);
  const [focusIndex, setFocusIndex] = useState(() => Math.max(0, TAB_ICON_KEYS.indexOf(initial)));
  const [pending, setPending] = useState(false);
  if ((stored !== observed.stored || initial !== observed.initial) && !pending) {
    setObserved({ stored, initial });
    setSelected(initial);
    setSavedRaw(stored);
  }

  const pick = async (key: TabIconKey) => {
    // 이미 그 키로 저장돼 있을 때만 건너뛴다 — 옛 값으로 보이던 그림을 누르면 키로 고쳐 저장한다.
    if (pending || (key === selected && savedRaw === key)) return;
    const previous = selected;
    setSelected(key);
    setPending(true);
    try {
      const result = await onSave(key);
      if (result.ok) setSavedRaw(key);
      else setSelected(previous);
      onNotice(result);
    } catch {
      setSelected(previous);
      onNotice({ ok: false, message: "아이콘을 저장하지 못했어요. 다시 시도해 주세요." });
    } finally {
      setPending(false);
    }
  };

  // 한 칸만 Tab 으로 들어오고, 그 안에서는 화살표로 옮긴다(↑↓ 는 그려진 한 줄 — 8칸, 640px 아래 6칸).
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = TAB_ICON_KEYS.length - 1;
    const columns = iconColumns(gridRef.current);
    const next = event.key === "ArrowRight" ? Math.min(last, index + 1)
      : event.key === "ArrowLeft" ? Math.max(0, index - 1)
        : event.key === "ArrowDown" ? Math.min(last, index + columns)
          : event.key === "ArrowUp" ? Math.max(0, index - columns)
            : event.key === "Home" ? 0
              : event.key === "End" ? last
                : null;
    if (next === null) return;
    event.preventDefault();
    setFocusIndex(next);
    gridRef.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  };

  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-[length:var(--fs-13)] font-semibold text-mw-fg">아이콘</span>
      <div
        ref={gridRef}
        role="group"
        aria-labelledby={labelId}
        data-tab-icon-picker
        className="grid grid-cols-[repeat(8,44px)] gap-2 max-sm:grid-cols-[repeat(6,44px)]"
      >
        {TAB_ICON_KEYS.map((key, index) => {
          const isSelected = key === selected;
          return (
            <button
              key={key}
              type="button"
              aria-label={TAB_ICON_LABELS[key]}
              aria-pressed={isSelected}
              tabIndex={index === focusIndex ? 0 : -1}
              title={TAB_ICON_LABELS[key]}
              data-tab-icon-option={key}
              disabled={pending && !isSelected}
              onFocus={() => setFocusIndex(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
              onClick={() => void pick(key)}
              className={`grid size-11 place-items-center rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mw-primary disabled:opacity-60 ${isSelected
                ? "bg-[color:var(--mw-accent-soft,var(--mw-tint-blue))] text-[color:var(--mw-tab-icon,var(--mw-record))] shadow-[inset_0_0_0_2px_var(--mw-tab-icon,var(--mw-record))]"
                : "bg-[color:var(--mw-board-canvas)] text-mw-body hover:shadow-[inset_0_0_0_1px_var(--mw-sub)]"}`}
            >
              <TabIcon name={key} size={20} />
            </button>
          );
        })}
      </div>
      <span className="text-[length:var(--fs-12)] text-mw-sub">색은 탭마다 정해진 색을 따라요(사이드바·머리말이 같이 바뀌어요).</span>
    </div>
  );
}
