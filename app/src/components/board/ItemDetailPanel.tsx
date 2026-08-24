"use client";

import {
  useCallback,
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import type {
  BoardColumn,
  CellValue,
  ItemWithValues,
} from "@/lib/boards/types";
import type { DetailLayoutEntry } from "@/lib/boards/detail-layout";
import {
  moveDetailEntry,
  unplacedDetailKeys,
} from "@/lib/boards/detail-layout";
import { formatCell } from "@/lib/boards/cells";
import { isSourceEditable } from "@/lib/field/source";
import {
  addDetailFieldAction,
  addUnplacedDetailEntryAction,
  promoteDetailFieldAction,
  resetGroupDetailLayoutAction,
  saveDetailLayoutAction,
} from "@/app/(app)/boards/actions";
import {
  advanceNewLeadFromDetailAction,
  updateNewLeadMetaAction,
} from "@/app/(app)/boards/new-lead-actions";
import {
  addItemDetailEventAction,
  addItemDetailLinkAction,
  loadItemDetailAction,
  saveItemDetailFieldAction,
  uploadItemDetailFileAction,
  type ItemDetailSnapshot,
} from "@/app/(app)/boards/item-detail-actions";

function AutoSaveField({
  boardId,
  itemId,
  fieldKey,
  source,
  type,
  initialValue,
}: {
  boardId: string;
  itemId: string;
  fieldKey: string;
  source: "column" | "detail";
  type: string;
  initialValue: string | number;
}) {
  const [value, setValue] = useState(String(initialValue));
  const [status, setStatus] = useState("✓ 자동 저장됨");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedRef = useRef(String(initialValue));
  const valueRef = useRef(String(initialValue));
  const savingRef = useRef(false);
  const queuedRef = useRef<string | null>(null);

  async function drain() {
    if (savingRef.current) return;
    savingRef.current = true;
    while (queuedRef.current !== null) {
      const next = queuedRef.current;
      queuedRef.current = null;
      if (next === savedRef.current) continue;
      setStatus("저장 중…");
      const result = await saveItemDetailFieldAction({
        boardId,
        itemId,
        fieldKey,
        source,
        value: next,
      });
      if (!result.ok) {
        setStatus(result.message);
        if (queuedRef.current === null && valueRef.current !== next) {
          queuedRef.current = valueRef.current;
        }
        continue;
      }
      savedRef.current = next;
      setStatus(
        valueRef.current === next && queuedRef.current === null
          ? "✓ 자동 저장됨"
          : "저장 대기…",
      );
      if (queuedRef.current === null && valueRef.current !== next) {
        queuedRef.current = valueRef.current;
      }
    }
    savingRef.current = false;
  }

  function save(next: string) {
    if (next === savedRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    queuedRef.current = next;
    void drain();
  }

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <div className="grid gap-1">
      <input
        id={`${itemId}-${fieldKey}`}
        value={value}
        type={inputType(type)}
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          valueRef.current = next;
          setStatus("저장 대기…");
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => save(valueRef.current), 700);
        }}
        onBlur={() => save(valueRef.current)}
        className="min-h-11 w-full rounded-lg border border-mw-line bg-mw-card px-3 text-sm text-mw-fg"
      />
      <span
        aria-live="polite"
        className={`text-right text-[11px] ${status.startsWith("✓") ? "text-mw-success" : status.includes("중") || status.includes("대기") ? "text-mw-sub" : "text-mw-error"}`}
      >
        {status}
      </span>
    </div>
  );
}

function inputType(type: string | undefined): string {
  if (type === "number" || type === "money") return "number";
  if (type === "date") return "date";
  if (type === "datetime") return "datetime-local";
  if (type === "email") return "email";
  if (type === "url") return "url";
  if (type === "phone") return "tel";
  return "text";
}

function inputValue(value: CellValue | undefined): string | number {
  if (value === null || value === undefined) return "";
  return typeof value === "number" ? value : String(value);
}

function DialogPortal({ children }: { children: ReactNode }) {
  return typeof document === "undefined"
    ? children
    : createPortal(children, document.body);
}

type FocusTarget = Pick<HTMLElement, "focus">;

export function focusDetailPanelElement(target: FocusTarget | null) {
  target?.focus();
}

export function restoreDetailPanelOpener(
  open: boolean,
  wasOpen: boolean,
  opener: FocusTarget | null,
) {
  if (!open && wasOpen) opener?.focus();
}

export function isDetailPanelBackdrop(
  target: EventTarget | null,
  currentTarget: EventTarget,
) {
  return target === currentTarget;
}

function SaveLayoutForm({
  boardId,
  groupId,
  layout,
  label,
  disabled,
}: {
  boardId: string;
  groupId: string | null;
  layout: DetailLayoutEntry[];
  label: string;
  disabled?: boolean;
}) {
  return (
    <form action={saveDetailLayoutAction}>
      <input type="hidden" name="boardId" value={boardId} />
      <input type="hidden" name="groupId" value={groupId ?? ""} />
      <input type="hidden" name="layout" value={JSON.stringify(layout)} />
      <button
        type="submit"
        disabled={disabled}
        className="min-h-9 rounded-lg border border-mw-line px-2 text-xs text-mw-body disabled:opacity-40"
      >
        {label}
      </button>
    </form>
  );
}

export function ItemDetailPanel({
  boardId,
  row,
  columns,
  boardLayout,
  layout,
  inherited,
  canEditItems,
  canManageColumns,
  defaultOpen = false,
  canonicalNewLead = false,
  memberOptions = [],
  previousItem,
  nextItem,
}: {
  boardId: string;
  row: ItemWithValues;
  columns: BoardColumn[];
  boardLayout: DetailLayoutEntry[];
  layout: DetailLayoutEntry[];
  inherited: boolean;
  canEditItems: boolean;
  canManageColumns: boolean;
  defaultOpen?: boolean;
  canonicalNewLead?: boolean;
  memberOptions?: readonly { id: string; label: string }[];
  previousItem?: { id: string; title: string };
  nextItem?: { id: string; title: string };
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [detail, setDetail] = useState<ItemDetailSnapshot>({
    ok: true,
    events: [],
    links: [],
    files: [],
    members: [],
  });
  const [detailPending, startDetailTransition] = useTransition();
  const [composer, setComposer] = useState("");
  const [composerKind, setComposerKind] = useState<"memo" | "call">("memo");
  const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([]);
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);
  const [fileRequestId, setFileRequestId] = useState(() => crypto.randomUUID());
  const [advanceState, advanceAction, advancePending] = useActionState(
    advanceNewLeadFromDetailAction,
    { ok: false, message: "" },
  );
  const [advanceRequestId] = useState(() => crypto.randomUUID());
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(open);
  const hashPushedRef = useRef(false);
  const columnsByKey = new Map(columns.map((column) => [column.key, column]));
  const unplaced = unplacedDetailKeys(row.values, layout).filter(
    (key) => !canonicalNewLead || (key !== "contact_move" && key !== "consult_status"),
  );

  const closeDrawer = useCallback(() => {
    setOpen(false);
    if (window.location.hash !== `#item-${row.id}`) return;
    if (hashPushedRef.current) {
      window.history.back();
      return;
    }
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
  }, [row.id]);

  function openDrawer() {
    if (window.location.hash === `#item-${row.id}`) {
      setOpen(true);
      return;
    }
    hashPushedRef.current = true;
    setOpen(true);
    window.location.hash = `item-${row.id}`;
  }

  useEffect(() => {
    const syncFromHash = () => {
      const matches = window.location.hash === `#item-${row.id}`;
      setOpen(matches);
      if (!matches) hashPushedRef.current = false;
    };
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, [row.id]);

  useEffect(() => {
    if (!open) return;
    startDetailTransition(async () =>
      setDetail(await loadItemDetailAction(boardId, row.id)),
    );
    focusDetailPanelElement(closeButtonRef.current);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDrawer();
      if (event.key === "Tab") {
        const focusable = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
          ) ?? [],
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [boardId, closeDrawer, open, row.id]);

  const refreshDetail = (next: ItemDetailSnapshot) => {
    if (next.ok) setDetail(next);
    else
      setDetail((current) => ({
        ...current,
        ok: false,
        message: next.message,
      }));
  };

  function submitEvent() {
    const body = composer.trim();
    if (!body) return;
    startDetailTransition(async () => {
      const next = await addItemDetailEventAction({
        boardId,
        itemId: row.id,
        kind: composerKind,
        body,
        requestId: crypto.randomUUID(),
        mentionedUserIds,
      });
      refreshDetail(next);
      if (next.ok) {
        setComposer("");
        setMentionedUserIds([]);
      }
    });
  }

  function submitLink() {
    if (!linkLabel.trim() || !linkUrl.trim()) return;
    startDetailTransition(async () => {
      const next = await addItemDetailLinkAction({
        boardId,
        itemId: row.id,
        label: linkLabel,
        url: linkUrl,
        requestId: crypto.randomUUID(),
      });
      refreshDetail(next);
      if (next.ok) {
        setLinkLabel("");
        setLinkUrl("");
      }
    });
  }

  const exportText = () => {
    const fields = layout.map(
      (entry) =>
        `${entry.label ?? columnsByKey.get(entry.key)?.label ?? entry.key}: ${String(row.values[entry.key] ?? "—")}`,
    );
    const history = detail.events.map(
      (event) =>
        `[${event.created_at}] ${event.kind === "call" ? "통화" : event.kind === "field_change" ? "자동 변경" : "메모"}: ${event.body}`,
    );
    return [
      `회사: ${row.title}`,
      "",
      ...fields,
      "",
      "히스토리",
      ...history,
    ].join("\n");
  };

  function download(filename: string, content: string, type: string) {
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(new Blob([content], { type }));
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  function openSibling(id: string) {
    window.location.hash = `item-${id}`;
    window.requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>(`[data-item-detail-trigger="${id}"]`)
        ?.click(),
    );
  }

  async function copyDeepLink() {
    const url = new URL(window.location.href);
    url.hash = `item-${row.id}`;
    await navigator.clipboard.writeText(url.toString());
    setLinkCopied(true);
    window.setTimeout(() => setLinkCopied(false), 1600);
  }

  useEffect(() => {
    restoreDetailPanelOpener(open, wasOpenRef.current, triggerRef.current);
    wasOpenRef.current = open;
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openDrawer}
        className="min-h-8 shrink-0 rounded-lg border border-mw-line px-2 text-xs font-semibold text-mw-record hover:bg-mw-tint-blue"
        aria-label={`${row.title} 상세 열기`}
        data-item-detail-trigger={row.id}
      >
        열기 ↗
      </button>
      {open && (
        <DialogPortal>
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={`${row.title} 상세`}
            className="mw-layer-dialog fixed inset-0 flex justify-end bg-black/40"
            onPointerDown={(event) => {
              if (isDetailPanelBackdrop(event.target, event.currentTarget))
                closeDrawer();
            }}
          >
            <section className="h-full w-full max-w-[74rem] overflow-y-auto bg-mw-card p-4 shadow-2xl sm:p-6">
              <header className="flex items-start justify-between gap-4 border-b border-mw-line pb-4">
                <div>
                  <p className="text-xs font-semibold text-mw-record">
                    회사 상세 · {row.group_id ? "보드 아이템" : "미분류"}
                  </p>
                  <h2 className="mt-1 text-xl font-bold text-mw-fg">
                    {row.title}
                  </h2>
                  <p className="mt-1 text-xs text-mw-sub">
                    {inherited
                      ? "보드 기본 배치를 상속 중"
                      : "이 아이템만의 배치를 사용 중"}
                  </p>
                </div>
                <nav
                  aria-label="회사 상세 탐색"
                  className="ml-auto flex items-center gap-2"
                >
                  <button
                    type="button"
                    disabled={!previousItem}
                    onClick={() => previousItem && openSibling(previousItem.id)}
                    aria-label={
                      previousItem
                        ? `이전 회사 ${previousItem.title} 열기`
                        : "이전 회사 없음"
                    }
                    className="min-h-10 rounded-lg border border-mw-line px-3 text-xs disabled:opacity-40"
                  >
                    ← 이전
                  </button>
                  <button
                    type="button"
                    disabled={!nextItem}
                    onClick={() => nextItem && openSibling(nextItem.id)}
                    aria-label={
                      nextItem
                        ? `다음 회사 ${nextItem.title} 열기`
                        : "다음 회사 없음"
                    }
                    className="min-h-10 rounded-lg border border-mw-line px-3 text-xs disabled:opacity-40"
                  >
                    다음 →
                  </button>
                  <button
                    type="button"
                    onClick={copyDeepLink}
                    aria-live="polite"
                    className="min-h-10 rounded-lg border border-mw-line px-3 text-xs"
                  >
                    {linkCopied ? "링크 복사됨" : "링크 복사"}
                  </button>
                </nav>
                <button
                  ref={closeButtonRef}
                  type="button"
                  onClick={closeDrawer}
                  aria-label="상세 닫기"
                  className="min-h-11 min-w-11 rounded-full border border-mw-line text-mw-body"
                >
                  ×
                </button>
              </header>

              <div className="grid gap-6 py-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(22rem,.92fr)]">
                <div className="min-w-0">
                  <div className="mb-3 flex items-center gap-2 border-b border-mw-line pb-3">
                    <h3 className="font-bold text-mw-fg">업체 정보</h3>
                    <span
                      className="ml-auto text-xs text-mw-success"
                      aria-live="polite"
                    >
                      {detailPending
                        ? "저장·불러오는 중…"
                        : detail.ok
                          ? "✓ 저장됨"
                          : "저장 실패"}
                    </span>
                  </div>
                  <div className="grid gap-3">
                    {canonicalNewLead && row.deal_id ? (
                      <form action={advanceAction} className="rounded-xl border border-mw-record bg-mw-tint-blue p-3">
                        <input type="hidden" name="boardId" value={boardId} />
                        <input type="hidden" name="itemId" value={row.id} />
                        <input type="hidden" name="requestId" value={advanceRequestId} />
                        <button
                          type="submit"
                          disabled={!canEditItems || advancePending || advanceState.ok}
                          className="min-h-11 w-full rounded-lg bg-mw-record px-4 text-sm font-bold text-white disabled:opacity-50"
                        >
                          {advancePending ? "넘기는 중…" : advanceState.ok ? "리드컨택으로 넘김" : "리드컨택으로 넘기기"}
                        </button>
                        {advanceState.message ? (
                          <p role={advanceState.ok ? "status" : "alert"} className={`mt-2 text-xs ${advanceState.ok ? "text-mw-success" : "text-mw-error"}`}>
                            {advanceState.message}{advanceState.ok ? <> <Link href="/contract" className="font-semibold underline">리드컨택 열기</Link></> : null}
                          </p>
                        ) : null}
                      </form>
                    ) : null}
                    {canonicalNewLead && row.deal_id ? (
                      <form
                        action={updateNewLeadMetaAction}
                        className="grid gap-2 rounded-xl border border-mw-line p-3"
                      >
                        <input type="hidden" name="boardId" value={boardId} />
                        <input type="hidden" name="itemId" value={row.id} />
                        <input
                          type="hidden"
                          name="dealId"
                          value={row.deal_id}
                        />
                        <input
                          type="hidden"
                          name="field"
                          value="address_detail"
                        />
                        <label className="grid gap-1 text-xs font-semibold text-mw-body">
                          상세 주소
                          <input
                            name="value"
                            defaultValue={
                              typeof row.values.address_detail === "string"
                                ? row.values.address_detail
                                : ""
                            }
                            placeholder="미정"
                            className="min-h-11 rounded-lg border border-mw-line px-3 text-sm text-mw-fg"
                          />
                        </label>
                        <button
                          type="submit"
                          className="min-h-9 justify-self-end rounded-lg border border-mw-line px-3 text-xs"
                        >
                          상세 주소 저장
                        </button>
                      </form>
                    ) : null}
                    {layout.length === 0 && (
                      <p className="rounded-xl border border-dashed border-mw-line p-4 text-sm text-mw-sub">
                        배치된 상세 필드가 없습니다. 값이 있다면 아래 미배치
                        영역에서 다시 올릴 수 있습니다.
                      </p>
                    )}
                    {layout.map((entry) => {
                      const column = columnsByKey.get(entry.key);
                      const label = entry.label ?? column?.label ?? entry.key;
                      const type = entry.type ?? column?.type ?? "text";
                      const value = row.values[entry.key];
                      const editableColumn =
                        entry.source === "column" &&
                        column &&
                        isSourceEditable(column.source) &&
                        !column.is_readonly;
                      const editable =
                        canEditItems &&
                        (entry.source === "detail" || editableColumn);
                      return (
                        <div
                          key={entry.key}
                          className="rounded-xl border border-mw-line p-3"
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <label
                              htmlFor={`${row.id}-${entry.key}`}
                              className="text-xs font-semibold text-mw-body"
                            >
                              {label}
                            </label>
                            <span className="rounded-full bg-mw-bg px-2 py-0.5 text-[11px] text-mw-sub">
                              {entry.source === "detail"
                                ? "상세 전용"
                                : "표 컬럼"}
                            </span>
                          </div>
                          {canonicalNewLead && row.deal_id && entry.key === "collaborators" ? (
                            <form action={updateNewLeadMetaAction} className="grid gap-2">
                              <input type="hidden" name="boardId" value={boardId} />
                              <input type="hidden" name="itemId" value={row.id} />
                              <input type="hidden" name="dealId" value={row.deal_id} />
                              <input type="hidden" name="field" value="collaborators" />
                              <select
                                id={`${row.id}-${entry.key}`}
                                name="value"
                                multiple
                                defaultValue={Array.isArray(value) ? value.filter((candidate): candidate is string => typeof candidate === "string") : []}
                                disabled={!canEditItems}
                                className="min-h-24 rounded-lg border border-mw-line bg-mw-card px-3 py-2 text-sm"
                              >
                                {memberOptions.map((member) => <option key={member.id} value={member.id}>{member.label}</option>)}
                              </select>
                              {canEditItems ? <button type="submit" className="min-h-11 justify-self-end rounded-lg border border-mw-line px-3 text-xs font-semibold">협업자 저장</button> : null}
                            </form>
                          ) : editable ? (
                            <AutoSaveField
                              boardId={boardId}
                              itemId={row.id}
                              fieldKey={entry.key}
                              source={entry.source}
                              type={type}
                              initialValue={inputValue(value)}
                            />
                          ) : (
                            <p className="min-h-11 rounded-lg bg-mw-bg px-3 py-3 text-sm text-mw-body">
                              {column
                                ? formatCell(
                                    column.type,
                                    value ?? null,
                                    column.options_jsonb?.options ?? [],
                                  ) || "—"
                                : inputValue(value) || "—"}
                            </p>
                          )}
                          {entry.source === "detail" && canManageColumns && (
                            <form
                              action={promoteDetailFieldAction}
                              className="mt-2"
                            >
                              <input
                                type="hidden"
                                name="boardId"
                                value={boardId}
                              />
                              <input
                                type="hidden"
                                name="fieldKey"
                                value={entry.key}
                              />
                              <button
                                type="submit"
                                className="text-xs font-semibold text-mw-record"
                              >
                                ⋯ 표에도 보이기
                              </button>
                            </form>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <details
                    className="border-t border-mw-line py-4"
                    open={unplaced.length > 0}
                  >
                    <summary className="cursor-pointer text-sm font-semibold text-mw-body">
                      이 화면에 배치되지 않은 항목 {unplaced.length}개 ▾
                    </summary>
                    <div className="mt-3 grid gap-2">
                      {unplaced.length === 0 && (
                        <p className="text-xs text-mw-sub">
                          모든 값이 현재 배치에 있습니다.
                        </p>
                      )}
                      {unplaced.map((key) => (
                        <div
                          key={key}
                          className="flex items-center justify-between gap-3 rounded-lg bg-mw-bg p-3"
                        >
                          <div className="min-w-0">
                            <b className="block truncate text-xs text-mw-body">
                              {columnsByKey.get(key)?.label ?? key}
                            </b>
                            <span className="block truncate text-xs text-mw-sub">
                              {String(row.values[key] ?? "")}
                            </span>
                          </div>
                          {canManageColumns && (
                            <form action={addUnplacedDetailEntryAction}>
                              <input
                                type="hidden"
                                name="boardId"
                                value={boardId}
                              />
                              <input
                                type="hidden"
                                name="groupId"
                                value={row.group_id ?? ""}
                              />
                              <input
                                type="hidden"
                                name="fieldKey"
                                value={key}
                              />
                              <button
                                type="submit"
                                className="min-h-9 rounded-lg border border-mw-line px-2 text-xs font-semibold text-mw-record"
                              >
                                배치에 추가
                              </button>
                            </form>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>

                  {canManageColumns && (
                    <details className="border-t border-mw-line py-4">
                      <summary className="cursor-pointer text-sm font-semibold text-mw-body">
                        이 아이템의 상세 배치 편집
                      </summary>
                      <div className="mt-3 grid gap-2">
                        {inherited ? (
                          <SaveLayoutForm
                            boardId={boardId}
                            groupId={row.group_id}
                            layout={layout}
                            label="현재 기본에서 분기해 편집"
                            disabled={!row.group_id}
                          />
                        ) : row.group_id ? (
                          <form action={resetGroupDetailLayoutAction}>
                            <input
                              type="hidden"
                              name="boardId"
                              value={boardId}
                            />
                            <input
                              type="hidden"
                              name="groupId"
                              value={row.group_id}
                            />
                            <button
                              type="submit"
                              className="min-h-9 rounded-lg border border-mw-line px-2 text-xs font-semibold text-mw-record"
                            >
                              기본으로 되돌리기
                            </button>
                          </form>
                        ) : null}
                        {layout.map((entry, index) => (
                          <div
                            key={entry.key}
                            className="flex flex-wrap items-center gap-2 rounded-lg bg-mw-bg p-2"
                          >
                            <span className="mr-auto text-xs text-mw-body">
                              {entry.label ??
                                columnsByKey.get(entry.key)?.label ??
                                entry.key}
                            </span>
                            <SaveLayoutForm
                              boardId={boardId}
                              groupId={row.group_id}
                              layout={moveDetailEntry(layout, entry.key, -1)}
                              label="↑"
                              disabled={index === 0 || !row.group_id}
                            />
                            <SaveLayoutForm
                              boardId={boardId}
                              groupId={row.group_id}
                              layout={moveDetailEntry(layout, entry.key, 1)}
                              label="↓"
                              disabled={
                                index === layout.length - 1 || !row.group_id
                              }
                            />
                            <SaveLayoutForm
                              boardId={boardId}
                              groupId={row.group_id}
                              layout={layout.filter(
                                (candidate) => candidate.key !== entry.key,
                              )}
                              label="배치에서 빼기"
                              disabled={!row.group_id}
                            />
                          </div>
                        ))}
                        {columns.filter(
                          (column) =>
                            !layout.some((entry) => entry.key === column.key),
                        ).length > 0 && (
                          <div className="flex flex-wrap gap-2 rounded-xl border border-dashed border-mw-line p-3">
                            <span className="w-full text-xs font-semibold text-mw-sub">
                              표 컬럼을 이 아이템 배치에 추가
                            </span>
                            {columns
                              .filter(
                                (column) =>
                                  !layout.some(
                                    (entry) => entry.key === column.key,
                                  ),
                              )
                              .map((column) => (
                                <SaveLayoutForm
                                  key={column.key}
                                  boardId={boardId}
                                  groupId={row.group_id}
                                  layout={[
                                    ...layout,
                                    {
                                      key: column.key,
                                      source: "column",
                                      label: column.label,
                                      type: column.type,
                                    },
                                  ]}
                                  label={`+ ${column.label}`}
                                  disabled={!row.group_id}
                                />
                              ))}
                          </div>
                        )}
                        <form
                          action={addDetailFieldAction}
                          className="grid gap-2 rounded-xl border border-dashed border-mw-line p-3 sm:grid-cols-[1fr_9rem_auto]"
                        >
                          <input type="hidden" name="boardId" value={boardId} />
                          <input
                            type="hidden"
                            name="groupId"
                            value={row.group_id ?? ""}
                          />
                          <input
                            name="label"
                            required
                            placeholder="상세 전용 필드 이름"
                            className="min-h-11 rounded-lg border border-mw-line bg-mw-card px-3 text-sm"
                          />
                          <select
                            name="type"
                            className="min-h-11 rounded-lg border border-mw-line bg-mw-card px-2 text-sm"
                          >
                            <option value="text">텍스트</option>
                            <option value="number">숫자</option>
                            <option value="date">날짜</option>
                            <option value="phone">전화</option>
                            <option value="email">이메일</option>
                            <option value="url">링크</option>
                          </select>
                          <button
                            type="submit"
                            className="min-h-11 rounded-lg bg-mw-primary px-3 text-xs font-bold text-mw-on-accent"
                          >
                            추가
                          </button>
                        </form>
                      </div>
                    </details>
                  )}

                  {canManageColumns && (
                    <details className="border-t border-mw-line py-4">
                      <summary className="cursor-pointer text-sm font-semibold text-mw-body">
                        보드 기본 상세 배치
                      </summary>
                      <div className="mt-3 grid gap-2">
                        {boardLayout.map((entry, index) => (
                          <div
                            key={entry.key}
                            className="flex items-center gap-2 rounded-lg bg-mw-bg p-2"
                          >
                            <span className="mr-auto text-xs text-mw-body">
                              {entry.label ??
                                columnsByKey.get(entry.key)?.label ??
                                entry.key}
                            </span>
                            <SaveLayoutForm
                              boardId={boardId}
                              groupId={null}
                              layout={moveDetailEntry(
                                boardLayout,
                                entry.key,
                                -1,
                              )}
                              label="↑"
                              disabled={index === 0}
                            />
                            <SaveLayoutForm
                              boardId={boardId}
                              groupId={null}
                              layout={moveDetailEntry(
                                boardLayout,
                                entry.key,
                                1,
                              )}
                              label="↓"
                              disabled={index === boardLayout.length - 1}
                            />
                            <SaveLayoutForm
                              boardId={boardId}
                              groupId={null}
                              layout={boardLayout.filter(
                                (candidate) => candidate.key !== entry.key,
                              )}
                              label="빼기"
                            />
                          </div>
                        ))}
                        {columns.filter(
                          (column) =>
                            !boardLayout.some(
                              (entry) => entry.key === column.key,
                            ),
                        ).length > 0 && (
                          <div className="flex flex-wrap gap-2 rounded-xl border border-dashed border-mw-line p-3">
                            <span className="w-full text-xs font-semibold text-mw-sub">
                              표 컬럼을 보드 기본 배치에 추가
                            </span>
                            {columns
                              .filter(
                                (column) =>
                                  !boardLayout.some(
                                    (entry) => entry.key === column.key,
                                  ),
                              )
                              .map((column) => (
                                <SaveLayoutForm
                                  key={column.key}
                                  boardId={boardId}
                                  groupId={null}
                                  layout={[
                                    ...boardLayout,
                                    {
                                      key: column.key,
                                      source: "column",
                                      label: column.label,
                                      type: column.type,
                                    },
                                  ]}
                                  label={`+ ${column.label}`}
                                />
                              ))}
                          </div>
                        )}
                        <form
                          action={addDetailFieldAction}
                          className="grid gap-2 rounded-xl border border-dashed border-mw-line p-3 sm:grid-cols-[1fr_9rem_auto]"
                        >
                          <input type="hidden" name="boardId" value={boardId} />
                          <input type="hidden" name="groupId" value="" />
                          <input
                            name="label"
                            required
                            placeholder="보드 기본 상세 필드"
                            className="min-h-11 rounded-lg border border-mw-line bg-mw-card px-3 text-sm"
                          />
                          <select
                            name="type"
                            className="min-h-11 rounded-lg border border-mw-line bg-mw-card px-2 text-sm"
                          >
                            <option value="text">텍스트</option>
                            <option value="number">숫자</option>
                            <option value="date">날짜</option>
                          </select>
                          <button
                            type="submit"
                            className="min-h-11 rounded-lg bg-mw-primary px-3 text-xs font-bold text-mw-on-accent"
                          >
                            기본에 추가
                          </button>
                        </form>
                      </div>
                    </details>
                  )}
                  <section className="border-t border-mw-line py-4">
                    <h3 className="text-sm font-bold text-mw-fg">
                      첨부 · 링크
                    </h3>
                    <p className="mt-1 text-xs text-mw-sub">
                      파일은 10MB씩 5개, 합계 30MB까지 올릴 수 있어요. 외부 자료는 Google Drive, OneDrive, Dropbox, 웹하드 등의 https 링크를 20개까지 연결하고, 보는 사람에게 읽기 권한이 있는지 확인하세요.
                    </p>
                    <div className="mt-3 grid gap-2">
                      {detail.files.map((file) =>
                        file.downloadUrl ? (
                          <a
                            key={file.id}
                            href={file.downloadUrl}
                            className="rounded-lg border border-mw-line px-3 py-2 text-sm font-semibold text-mw-record"
                            download
                          >
                            📎 {file.name}{" "}
                            <span className="text-xs font-normal text-mw-sub">
                              {Math.ceil(file.size_bytes / 1024)}KB
                            </span>
                          </a>
                        ) : (
                          <span
                            key={file.id}
                            className="rounded-lg border border-mw-line px-3 py-2 text-sm text-mw-sub"
                          >
                            📎 {file.name} · 내려받기 링크를 만들지 못했습니다.
                          </span>
                        ),
                      )}
                      {detail.links.map((link) => (
                        <a
                          key={link.id}
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg border border-mw-line px-3 py-2 text-sm font-semibold text-mw-record underline"
                        >
                          🔗 {link.label}
                          <span className="sr-only"> (새 창)</span>
                        </a>
                      ))}
                      {detail.links.length === 0 &&
                        detail.files.length === 0 && (
                          <p className="text-xs text-mw-sub">
                            연결된 첨부·링크가 없습니다.
                          </p>
                        )}
                      {canEditItems && (
                        <form
                          action={(formData) => {
                            startDetailTransition(async () => {
                              const next = await uploadItemDetailFileAction(boardId, row.id, formData);
                              refreshDetail(next);
                              if (next.ok) setFileRequestId(crypto.randomUUID());
                            });
                          }}
                          className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-mw-line p-3"
                        >
                          <input type="hidden" name="requestId" value={fileRequestId} />
                          <input
                            aria-label="첨부 파일"
                            type="file"
                            name="file"
                            required
                            className="min-w-0 flex-1 text-xs"
                          />
                          <button
                            type="submit"
                            disabled={detailPending}
                            className="rounded-lg border border-mw-line px-3 py-2 text-xs font-bold"
                          >
                            파일 첨부
                          </button>
                        </form>
                      )}
                      {canEditItems && (
                        <div className="grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
                          <input
                            aria-label="링크 이름"
                            maxLength={100}
                            value={linkLabel}
                            onChange={(event) =>
                              setLinkLabel(event.target.value)
                            }
                            placeholder="자료 이름"
                            className="min-h-10 rounded-lg border border-mw-line px-3 text-sm"
                          />
                          <input
                            aria-label="https 링크"
                            type="url"
                            maxLength={2048}
                            value={linkUrl}
                            onChange={(event) => setLinkUrl(event.target.value)}
                            placeholder="https://"
                            className="min-h-10 rounded-lg border border-mw-line px-3 text-sm"
                          />
                          <button
                            type="button"
                            disabled={detailPending}
                            onClick={submitLink}
                            className="rounded-lg border border-mw-line px-3 text-xs font-bold"
                          >
                            링크 연결
                          </button>
                        </div>
                      )}
                    </div>
                  </section>
                  <section className="border-t border-mw-line py-4">
                    <h3 className="text-sm font-bold text-mw-fg">내보내기</h3>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          download(
                            `${row.title}.txt`,
                            exportText(),
                            "text/plain;charset=utf-8",
                          )
                        }
                        className="rounded-lg border border-mw-line px-3 py-2 text-xs font-bold"
                      >
                        TXT 추출
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          navigator.clipboard.writeText(exportText())
                        }
                        className="rounded-lg border border-mw-line px-3 py-2 text-xs font-bold"
                      >
                        복사
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          download(
                            `${row.title}.csv`,
                            `항목,값\n${layout.map((entry) => `"${entry.label ?? entry.key}","${String(row.values[entry.key] ?? "").replaceAll('"', '""')}"`).join("\n")}`,
                            "text/csv;charset=utf-8",
                          )
                        }
                        className="rounded-lg border border-mw-line px-3 py-2 text-xs font-bold"
                      >
                        ⬇ CSV
                      </button>
                    </div>
                  </section>
                </div>

                <aside className="min-w-0 border-t border-mw-line pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                  <section className="rounded-xl bg-mw-bg p-4">
                    <h3 className="text-sm font-bold text-mw-fg">
                      이 건이 바뀌면 알게 되는 사람
                    </h3>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {detail.members.map((member) => (
                        <span
                          key={member.id}
                          className="rounded-full border border-mw-line bg-mw-card px-3 py-1 text-xs text-mw-body"
                        >
                          {member.name ?? "조직 멤버"}
                        </span>
                      ))}
                      {detail.members.length === 0 && (
                        <span className="text-xs text-mw-sub">
                          알림 대상 정보를 불러오지 못했습니다.
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-mw-sub">
                      현재 담당자에게 변경 및 멘션 알림이 전달됩니다.
                    </p>
                  </section>
                  <section className="mt-5">
                    <div className="flex items-center gap-2 border-b border-mw-line pb-3">
                      <h3 className="font-bold text-mw-fg">히스토리</h3>
                      <span className="ml-auto text-xs text-mw-sub">
                        최신순 · 자동 기록 포함 · 삭제 불가
                      </span>
                    </div>
                    {!detail.ok && (
                      <p
                        role="alert"
                        className="mt-3 rounded-lg bg-mw-tint-red p-3 text-sm text-mw-error"
                      >
                        {detail.message}
                      </p>
                    )}
                    <div className="grid gap-3 py-4">
                      {detail.events.map((event) => (
                        <article
                          key={event.id}
                          className="rounded-xl border border-mw-line p-3"
                        >
                          <div className="flex gap-2 text-xs text-mw-sub">
                            <b className="text-mw-body">
                              {event.kind === "call"
                                ? "통화 기록"
                                : event.kind === "field_change"
                                  ? "자동 필드 변경"
                                  : "메모"}
                            </b>
                            <time className="ml-auto">
                              {new Date(event.created_at).toLocaleString(
                                "ko-KR",
                              )}
                            </time>
                          </div>
                          <p className="mt-2 whitespace-pre-wrap text-sm text-mw-fg">
                            {event.body}
                          </p>
                        </article>
                      ))}
                      {detail.events.length === 0 && !detailPending && (
                        <p className="rounded-xl border border-dashed border-mw-line p-4 text-sm text-mw-sub">
                          아직 히스토리가 없습니다.
                        </p>
                      )}
                    </div>
                  </section>
                  {canEditItems && (
                    <section className="sticky bottom-0 rounded-xl border border-mw-line bg-mw-card p-3 shadow-lg">
                      <textarea
                        aria-label="메모 또는 통화 기록"
                        value={composer}
                        onChange={(event) => setComposer(event.target.value)}
                        placeholder="메모를 적으세요 — @이름으로 멘션할 수 있습니다"
                        rows={4}
                        className="w-full resize-y rounded-lg border border-mw-line p-3 text-sm"
                      />
                      {detail.members.length > 0 && (
                        <fieldset className="mt-2 flex flex-wrap gap-2">
                          <legend className="sr-only">멘션할 사람</legend>
                          {detail.members
                            .filter((member) => member.id !== detail.viewerId)
                            .map((member) => {
                              const selected = mentionedUserIds.includes(
                                member.id,
                              );
                              return (
                                <button
                                  key={member.id}
                                  type="button"
                                  aria-pressed={selected}
                                  onClick={() =>
                                    setMentionedUserIds((current) =>
                                      selected
                                        ? current.filter(
                                            (id) => id !== member.id,
                                          )
                                        : [...current, member.id],
                                    )
                                  }
                                  className="rounded-full border border-mw-line px-2 py-1 text-xs"
                                >
                                  @{member.name ?? "담당자"}
                                </button>
                              );
                            })}
                        </fieldset>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setComposerKind("memo")}
                          aria-pressed={composerKind === "memo"}
                          className="rounded-lg border border-mw-line px-3 py-2 text-xs"
                        >
                          메모
                        </button>
                        <button
                          type="button"
                          onClick={() => setComposerKind("call")}
                          aria-pressed={composerKind === "call"}
                          className="rounded-lg border border-mw-line px-3 py-2 text-xs"
                        >
                          통화 기록
                        </button>
                        <span className="ml-auto text-xs text-mw-sub">
                          @ 멘션
                        </span>
                        <button
                          type="button"
                          disabled={detailPending || !composer.trim()}
                          onClick={submitEvent}
                          className="rounded-lg bg-mw-primary px-4 py-2 text-xs font-bold text-mw-on-accent disabled:opacity-50"
                        >
                          등록
                        </button>
                      </div>
                    </section>
                  )}
                </aside>
              </div>
            </section>
          </div>
        </DialogPortal>
      )}
    </>
  );
}
