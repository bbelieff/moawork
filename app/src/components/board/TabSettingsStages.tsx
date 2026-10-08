"use client";

/**
 * 탭 설정 › 단계 — 그룹(단계)의 순서·이름·추가를 한곳에서 (#845 개선안, 2026-10-08).
 *
 * 옛 보드 설정의 「그룹 순서」(이름과 달리 추가 칸뿐이었다)와 「업무 흐름」 안내 상자를 대신한다.
 *   · 순서: 손잡이를 끌거나 ↑↓ 단추 → reorderGroupsAction (표의 그룹 머리말 ↑↓ 와 같은 저장 경로)
 *   · 이름: 「이름 바꾸기」 → 그 자리 입력칸, Enter·칸 떠나기로 저장 / Esc 로 취소
 *          (renameGroupTitleAction — 그룹 머리말 이름 편집과 같은 권한·같은 서비스 호출)
 *   · 추가: 「＋ 단계 추가」 → addGroupAction
 *   · 지우기: 지금은 그룹을 지우는 액션이 없다. 새 파괴 경로를 만들지 않고 단추를 잠가 이유만 알려 준다
 *     (행이 남아 있으면 «먼저 다른 단계로 옮겨 주세요»).
 * 단계와 진행현황이 연결된 탭(계약업체 실무)은 이름·순서를 바꾸면 진행현황 선택지도 같이 바뀐다 —
 * 맨 위 한 줄 안내가 그것을 말한다. 저장 함수는 바꿔 끼울 수 있다(시각 픽스처).
 */

import { useId, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { addGroupAction, reorderGroupsAction } from "@/app/(app)/boards/actions";
import { renameGroupTitleAction, type InlineTitleResult } from "@/app/(app)/boards/title-actions";
import { presentLabel } from "@/lib/boards/label-presentation";
import type { TabStageRow } from "@/lib/boards/tab-settings";
import { noticeLive, noticeRole, type ResultNotice } from "@/lib/ui/result-notice";
import { OWNS_ESCAPE_ATTRIBUTE } from "./tab-chrome";

// 잠근 단추도 aria-disabled 로 둔다 — disabled 는 누르던 단추의 초점을 대화상자 밖으로 떨어뜨린다
// (맨 위로 옮긴 순간 「위로」 가 잠긴다).
const SMALL_BUTTON = "grid size-8 shrink-0 place-items-center rounded-lg text-mw-sub hover:bg-[color:var(--mw-board-canvas)] hover:text-mw-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mw-primary aria-disabled:cursor-not-allowed aria-disabled:opacity-35 aria-disabled:hover:bg-transparent";

export function TabSettingsStages({
  boardId,
  stages,
  note,
  reorderAction = reorderGroupsAction,
  renameAction = renameGroupTitleAction,
  addAction = addGroupAction,
}: {
  boardId: string;
  /** 그룹 순서대로. 행 수는 화면에 보이는(권한 안의) 행만 센다. */
  stages: readonly TabStageRow[];
  /** 맨 위 한 줄 안내(업무 흐름). 없으면 그리지 않는다. */
  note?: string | null;
  reorderAction?: (formData: FormData) => Promise<void>;
  renameAction?: (boardId: string, groupId: string, value: string) => Promise<InlineTitleResult>;
  addAction?: (formData: FormData) => Promise<void>;
}) {
  // 서버가 새 순서를 내려줄 때까지 누른 대로 먼저 보여 준다(낙관적). 서버 값이 오면 그것을 따른다.
  const [observed, setObserved] = useState(stages);
  const [order, setOrder] = useState(stages);
  const [names, setNames] = useState<Readonly<Record<string, string>>>({});
  if (stages !== observed) {
    setObserved(stages);
    setOrder(stages);
    setNames({});
  }
  const [notice, setNotice] = useState<ResultNotice | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const draggedRef = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  const nameOf = (stage: TabStageRow) => names[stage.id] ?? stage.name;

  const persist = (next: readonly TabStageRow[], moved: TabStageRow) => {
    setOrder(next);
    const position = next.findIndex((stage) => stage.id === moved.id) + 1;
    setNotice({ ok: true, message: `‘${presentLabel(nameOf(moved))}’ 단계를 ${position}번째로 옮겼어요.` });
    const formData = new FormData();
    formData.set("boardId", boardId);
    formData.set("groupIds", JSON.stringify(next.map((stage) => stage.id)));
    void reorderAction(formData).catch(() => {
      setOrder(stages);
      setNotice({ ok: false, message: "순서를 저장하지 못했어요. 새로고침 후 다시 시도해 주세요." });
    });
  };

  const move = (index: number, delta: -1 | 1) => {
    const to = index + delta;
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    const [moved] = next.splice(index, 1);
    next.splice(to, 0, moved);
    persist(next, moved);
  };

  const drop = (targetId: string) => {
    const draggedId = draggedRef.current;
    draggedRef.current = null;
    setDropTarget(null);
    if (!draggedId || draggedId === targetId) return;
    const from = order.findIndex((stage) => stage.id === draggedId);
    const to = order.findIndex((stage) => stage.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    persist(next, moved);
  };

  const rename = async (stage: TabStageRow, value: string): Promise<boolean> => {
    const result = await renameAction(boardId, stage.id, value).catch(() => ({ ok: false as const, message: "이름을 저장하지 못했어요. 다시 시도해 주세요." }));
    if (result.ok) {
      setNames((current) => ({ ...current, [stage.id]: result.name }));
      setNotice({ ok: true, message: `단계 이름을 ‘${presentLabel(result.name)}’(으)로 바꿨어요.` });
      return true;
    }
    setNotice({ ok: false, message: result.message });
    return false;
  };

  return (
    <div className="flex flex-col gap-2.5" data-tab-settings-stages>
      {note ? (
        <p data-tab-stage-note className="flex items-start gap-2.5 rounded-[10px] bg-[color:var(--mw-accent-soft,var(--mw-tint-blue))] px-3.5 py-3 text-[length:var(--fs-13)] leading-6 text-[color:var(--mw-accent-ink,var(--mw-fg))]">
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true" focusable="false" style={{ flex: "none", marginTop: 4 }}>
            <path d="M4 12h16M14 6l6 6-6 6" />
          </svg>
          <span>{note}</span>
        </p>
      ) : null}

      <div className="overflow-hidden rounded-[10px] border border-mw-line">
        {order.length === 0 ? (
          <p className="px-3 py-3 text-[length:var(--fs-13)] text-mw-sub">아직 단계가 없어요. 아래에서 추가해요.</p>
        ) : (
          <ol ref={listRef} aria-label="단계 순서" className="flex flex-col">
            {order.map((stage, index) => (
              <StageRow
                key={stage.id}
                stage={stage}
                name={nameOf(stage)}
                index={index}
                count={order.length}
                editing={editing === stage.id}
                dropActive={dropTarget === stage.id}
                onMove={(delta) => move(index, delta)}
                onBeginEdit={() => setEditing(stage.id)}
                onEndEdit={() => setEditing(null)}
                onRename={(value) => rename(stage, value)}
                onDragStart={() => { draggedRef.current = stage.id; }}
                onDragOver={(event) => {
                  if (!draggedRef.current) return;
                  event.preventDefault();
                  setDropTarget(stage.id);
                }}
                onDragLeave={() => setDropTarget((current) => (current === stage.id ? null : current))}
                onDrop={(event) => {
                  event.preventDefault();
                  drop(stage.id);
                }}
                onDragEnd={() => {
                  draggedRef.current = null;
                  setDropTarget(null);
                }}
              />
            ))}
          </ol>
        )}
        <AddStage boardId={boardId} addAction={addAction} onNotice={setNotice} />
      </div>

      <span className="text-[length:var(--fs-12)] text-mw-sub">행이 남아 있는 단계는 지울 수 없어요 — 먼저 다른 단계로 옮겨 주세요.</span>
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

function StageRow({
  stage,
  name,
  index,
  count,
  editing,
  dropActive,
  onMove,
  onBeginEdit,
  onEndEdit,
  onRename,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: {
  stage: TabStageRow;
  name: string;
  index: number;
  count: number;
  editing: boolean;
  dropActive: boolean;
  onMove(delta: -1 | 1): void;
  onBeginEdit(): void;
  onEndEdit(): void;
  onRename(value: string): Promise<boolean>;
  onDragStart(): void;
  onDragOver(event: DragEvent<HTMLLIElement>): void;
  onDragLeave(): void;
  onDrop(event: DragEvent<HTMLLIElement>): void;
  onDragEnd(): void;
}) {
  const shown = presentLabel(name);
  const renameButtonRef = useRef<HTMLButtonElement>(null);
  // 입력칸이 사라지면 초점이 문서로 떨어진다 — 그때만 「이름 바꾸기」 로 돌려준다(그새 다른 곳을 눌렀으면 그대로 둔다).
  const restoreFocus = () => window.requestAnimationFrame(() => {
    const active = document.activeElement;
    if (!active || active === document.body) renameButtonRef.current?.focus();
  });
  const reasonId = `${useId().replace(/:/gu, "")}-delete-reason`;
  const deleteReason = stage.rowCount > 0
    ? `행이 ${stage.rowCount}건 남아 있어 지울 수 없어요. 먼저 다른 단계로 옮겨 주세요.`
    : "단계 지우기는 아직 이 화면에서 할 수 없어요.";

  return (
    <li
      data-tab-stage-row={stage.id}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`group flex min-h-11 items-center gap-2.5 border-b border-mw-line px-3 last:border-b-0 hover:bg-[color:var(--mw-board-canvas)] max-sm:gap-1 max-sm:px-2 ${dropActive ? "shadow-[inset_0_2px_0_var(--mw-tab-icon,var(--mw-record))]" : ""}`}
    >
      <span
        draggable
        aria-hidden="true"
        title="끌어서 순서 바꾸기"
        data-tab-stage-handle
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", stage.id);
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        className="flex cursor-grab text-mw-sub/60 active:cursor-grabbing"
      >
        <svg width={12} height={14} viewBox="0 0 12 18" fill="currentColor" aria-hidden="true" focusable="false">
          <circle cx="3" cy="3" r="1.5" /><circle cx="9" cy="3" r="1.5" />
          <circle cx="3" cy="9" r="1.5" /><circle cx="9" cy="9" r="1.5" />
          <circle cx="3" cy="15" r="1.5" /><circle cx="9" cy="15" r="1.5" />
        </svg>
      </span>
      <span aria-hidden="true" data-tab-stage-dot className="size-3 shrink-0 rounded-[4px]" style={{ background: stage.accent }} />
      {editing ? (
        <StageNameInput
          initial={name}
          label={`${shown} 단계 이름`}
          onCancel={() => {
            onEndEdit();
            restoreFocus();
          }}
          onSave={async (value) => {
            const ok = await onRename(value);
            onEndEdit();
            restoreFocus();
            return ok;
          }}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate text-[length:var(--fs-13)] font-semibold text-mw-fg">{shown}</span>
      )}
      <span className="w-14 shrink-0 text-right text-[length:var(--fs-12)] text-mw-sub max-sm:w-auto max-sm:pe-1">{stage.rowCount}건</span>
      <button type="button" aria-label={`${shown} 위로`} aria-disabled={index === 0} onClick={() => { if (index > 0) onMove(-1); }} className={SMALL_BUTTON}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
      </button>
      <button type="button" aria-label={`${shown} 아래로`} aria-disabled={index === count - 1} onClick={() => { if (index < count - 1) onMove(1); }} className={SMALL_BUTTON}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12l7 7 7-7" /></svg>
      </button>
      {editing ? null : (
        <button
          ref={renameButtonRef}
          type="button"
          aria-label={`${shown} 이름 바꾸기`}
          onClick={onBeginEdit}
          className="grid h-8 shrink-0 place-items-center rounded-lg px-2 text-[length:var(--fs-12)] font-semibold text-[color:var(--mw-tab-icon,var(--mw-record))] hover:bg-[color:var(--mw-board-canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mw-primary max-sm:size-8 max-sm:px-0"
        >
          {/* 좁은 화면은 연필 아이콘만 — 글자 단추가 줄을 밀어내지 않게 한다(터치로도 누를 수 있다). */}
          <span className="max-sm:hidden">이름 바꾸기</span>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className="sm:hidden"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" /></svg>
        </button>
      )}
      <button
        type="button"
        aria-label={`${shown} 지우기`}
        aria-disabled="true"
        aria-describedby={reasonId}
        title={deleteReason}
        data-tab-stage-delete
        onClick={(event) => event.preventDefault()}
        className={SMALL_BUTTON}
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
      </button>
      <span id={reasonId} className="sr-only">{deleteReason}</span>
    </li>
  );
}

function StageNameInput({
  initial,
  label,
  onSave,
  onCancel,
}: {
  initial: string;
  label: string;
  onSave(value: string): Promise<boolean>;
  onCancel(): void;
}) {
  const [draft, setDraft] = useState(initial);
  const [pending, setPending] = useState(false);
  const doneRef = useRef(false);

  const commit = async () => {
    if (doneRef.current) return;
    const next = draft.trim();
    if (!next || next === initial) {
      doneRef.current = true;
      onCancel();
      return;
    }
    doneRef.current = true;
    setPending(true);
    await onSave(next);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      doneRef.current = true;
      onCancel();
    }
  };

  return (
    <input
      autoFocus
      value={draft}
      aria-label={label}
      maxLength={100}
      readOnly={pending}
      aria-busy={pending || undefined}
      {...{ [OWNS_ESCAPE_ATTRIBUTE]: "true" }}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={onKeyDown}
      className="h-8 min-w-0 flex-1 rounded-lg border border-[color:var(--mw-tab-icon,var(--mw-record))] bg-mw-card px-2 text-[length:var(--fs-13)] text-mw-fg outline-none focus:ring-2 focus:ring-mw-primary/30"
    />
  );
}

function AddStage({
  boardId,
  addAction,
  onNotice,
}: {
  boardId: string;
  addAction: (formData: FormData) => Promise<void>;
  onNotice(notice: ResultNotice): void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);

  const close = () => {
    setOpen(false);
    setDraft("");
    window.requestAnimationFrame(() => openerRef.current?.focus());
  };

  const submit = async () => {
    const name = draft.trim();
    if (!name || pending) return;
    setPending(true);
    const formData = new FormData();
    formData.set("boardId", boardId);
    formData.set("name", name);
    try {
      await addAction(formData);
      onNotice({ ok: true, message: `‘${name}’ 단계를 추가했어요.` });
      setDraft("");
    } catch {
      onNotice({ ok: false, message: "단계를 추가하지 못했어요. 다시 시도해 주세요." });
    } finally {
      setPending(false);
    }
  };

  if (!open) {
    return (
      <button
        ref={openerRef}
        type="button"
        data-tab-stage-add
        onClick={() => setOpen(true)}
        className="flex h-11 w-full items-center gap-2 px-3 text-left text-[length:var(--fs-13)] font-semibold text-[color:var(--mw-tab-icon,var(--mw-record))] hover:bg-[color:var(--mw-board-canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-mw-primary"
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" /></svg>
        단계 추가
      </button>
    );
  }

  return (
    <form
      data-tab-stage-add-form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="flex flex-wrap items-center gap-2 border-t border-mw-line px-3 py-2"
    >
      <input
        autoFocus
        value={draft}
        aria-label="새 단계 이름"
        placeholder="예: 서류 준비"
        maxLength={100}
        readOnly={pending}
        {...{ [OWNS_ESCAPE_ATTRIBUTE]: draft ? "true" : "false" }}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && draft) {
            event.preventDefault();
            setDraft("");
          }
        }}
        className="h-9 min-w-0 flex-1 rounded-lg border border-mw-line bg-mw-card px-2.5 text-[length:var(--fs-13)] text-mw-fg outline-none focus:border-[color:var(--mw-tab-icon,var(--mw-record))]"
      />
      <button
        type="submit"
        disabled={!draft.trim() || pending}
        className="h-9 shrink-0 rounded-lg bg-mw-primary px-3.5 text-[length:var(--fs-13)] font-semibold text-mw-on-accent disabled:opacity-50"
      >
        {pending ? "추가 중…" : "추가"}
      </button>
      <button
        type="button"
        onClick={close}
        className="h-9 shrink-0 rounded-lg border border-mw-line px-3 text-[length:var(--fs-13)] text-mw-body hover:bg-[color:var(--mw-board-canvas)]"
      >
        닫기
      </button>
    </form>
  );
}
