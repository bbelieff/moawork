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
  saveNewLeadDetailFieldAction,
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
import { MemberPicker } from "./MemberPicker";
import styles from "./item-detail-panel.module.css";

function AutoSaveField({
  boardId,
  itemId,
  fieldKey,
  source,
  type,
  initialValue,
  canonicalDealId,
  onStatusChange,
}: {
  boardId: string;
  itemId: string;
  fieldKey: string;
  source: "column" | "detail";
  type: string;
  initialValue: string | number;
  canonicalDealId?: string | null;
  onStatusChange?: (status: string) => void;
}) {
  const [value, setValue] = useState(String(initialValue));
  const [status, setStatus] = useState("✓ 자동 저장됨");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedRef = useRef(String(initialValue));
  const valueRef = useRef(String(initialValue));
  const savingRef = useRef(false);
  const queuedRef = useRef<string | null>(null);

  function updateStatus(next: string) {
    setStatus(next);
    onStatusChange?.(next);
  }

  async function drain() {
    if (savingRef.current) return;
    savingRef.current = true;
    while (queuedRef.current !== null) {
      const next = queuedRef.current;
      queuedRef.current = null;
      if (next === savedRef.current) continue;
      updateStatus("저장 중…");
      const result = canonicalDealId
        ? await saveNewLeadDetailFieldAction({ boardId, itemId, dealId: canonicalDealId, fieldKey, value: next })
        : await saveItemDetailFieldAction({
            boardId,
            itemId,
            fieldKey,
            source,
            value: next,
          });
      if (!result.ok) {
        updateStatus(result.message);
        if (queuedRef.current === null && valueRef.current !== next) {
          queuedRef.current = valueRef.current;
        }
        continue;
      }
      savedRef.current = next;
      updateStatus(
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
    <div className={styles.fieldEditor}>
      <input
        id={`${itemId}-${fieldKey}`}
        value={value}
        type={inputType(type)}
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          valueRef.current = next;
          updateStatus("저장 대기…");
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => save(valueRef.current), 700);
        }}
        onBlur={() => save(valueRef.current)}
        className={styles.fieldInput}
      />
      <span
        aria-live="polite"
        className={styles.fieldStatus}
        data-saved={status.startsWith("✓")}
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
  initialDetail,
  boardName,
  groupName,
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
  /** 마스킹된 시각 fixture에서만 사용한다. 실제 제품은 서버 상세를 불러온다. */
  initialDetail?: ItemDetailSnapshot;
  boardName?: string;
  groupName?: string;
  previousItem?: { id: string; title: string };
  nextItem?: { id: string; title: string };
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [detail, setDetail] = useState<ItemDetailSnapshot>(initialDetail ?? {
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
  const [fieldSaveStatuses, setFieldSaveStatuses] = useState<Record<string, string>>({});
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
  const suppressOpenerRestoreRef = useRef(false);
  const hashPushedRef = useRef(false);
  const columnsByKey = new Map(columns.map((column) => [column.key, column]));
  const unplaced = unplacedDetailKeys(row.values, layout).filter(
    (key) => !canonicalNewLead || (key !== "contact_move" && key !== "consult_status"),
  );
  const saveStatuses = Object.values(fieldSaveStatuses);
  const fieldSavePending = saveStatuses.some(
    (status) => status === "저장 중…" || status === "저장 대기…",
  );
  const fieldSaveFailed = saveStatuses.some(
    (status) =>
      !status.startsWith("✓") &&
      status !== "저장 중…" &&
      status !== "저장 대기…",
  );
  const saveSummary =
    detailPending || fieldSavePending
      ? "저장 중…"
      : !detail.ok || fieldSaveFailed
        ? "저장 확인 필요"
        : "✓ 자동 저장됨";

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
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!initialDetail) {
      startDetailTransition(async () =>
        setDetail(await loadItemDetailAction(boardId, row.id)),
      );
    }
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
        if (!dialogRef.current?.contains(document.activeElement)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [boardId, closeDrawer, initialDetail, open, row.id]);

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
    suppressOpenerRestoreRef.current = true;
    window.location.hash = `item-${id}`;
    window.requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>(`[data-item-detail-trigger="${id}"]`)
        ?.click(),
    );
  }

  function focusCollaborators() {
    const field = document.getElementById("detail-field-collaborators");
    field?.scrollIntoView({ block: "center" });
    const picker = field?.querySelector<HTMLDetailsElement>("details");
    if (!picker) return;
    picker.open = true;
    window.requestAnimationFrame(() =>
      picker.querySelector<HTMLElement>("summary")?.focus(),
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
    if (!open && wasOpenRef.current && suppressOpenerRestoreRef.current) {
      suppressOpenerRestoreRef.current = false;
    } else {
      restoreDetailPanelOpener(open, wasOpenRef.current, triggerRef.current);
    }
    wasOpenRef.current = open;
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openDrawer}
        className={`${canonicalNewLead ? "min-h-7" : "min-h-8"} shrink-0 rounded-lg border border-mw-line px-2 text-xs font-semibold text-mw-record hover:bg-mw-tint-blue`}
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
            className={`mw-layer-dialog ${styles.backdrop}`}
            data-item-detail-backdrop
            onPointerDown={(event) => {
              if (isDetailPanelBackdrop(event.target, event.currentTarget))
                closeDrawer();
            }}
          >
            <section className={styles.surface} data-item-detail-surface>
              <div className={styles.shell}>
              <header className={styles.header} data-item-detail-header>
                <button
                  ref={closeButtonRef}
                  type="button"
                  onClick={closeDrawer}
                  aria-label="상세 닫기"
                  className={styles.closeButton}
                >
                  ×
                </button>
                <div className={styles.identity}>
                  <h2 className={styles.companyName}>{row.title}</h2>
                  <span className={styles.breadcrumb}>
                    {boardName ?? (canonicalNewLead ? "신규리드 관리" : "보드")} · {groupName ?? (canonicalNewLead ? "💡 신규고객" : "그룹 없음")}
                  </span>
                </div>
                <nav aria-label="회사 상세 탐색" className={styles.headerActions}>
                  <button
                    type="button"
                    disabled={!previousItem}
                    onClick={() => previousItem && openSibling(previousItem.id)}
                    aria-label={
                      previousItem
                        ? `이전 회사 ${previousItem.title} 열기`
                        : "이전 회사 없음"
                    }
                    className={styles.headerButton}
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
                    className={styles.headerButton}
                  >
                    다음 →
                  </button>
                  <button
                    type="button"
                    onClick={copyDeepLink}
                    aria-live="polite"
                    className={styles.headerButton}
                  >
                    {linkCopied ? "링크 복사됨" : "링크 복사"}
                  </button>
                  <details className={styles.moreMenu}>
                    <summary className={styles.moreButton} aria-label="회사 상세 추가 메뉴">⋯</summary>
                    <div className={styles.morePopover}>
                      <button type="button" onClick={() => download(`${row.title}.txt`, exportText(), "text/plain;charset=utf-8")}>TXT 내려받기</button>
                      <button type="button" onClick={() => navigator.clipboard.writeText(exportText())}>회사 정보 복사</button>
                    </div>
                  </details>
                </nav>
              </header>

              <div className={styles.content}>
                <div className={styles.infoRail} data-item-detail-info-rail>
                  <div className={styles.infoHeader}>
                    <h3 className="font-bold text-mw-fg">회사 정보</h3>
                    <span
                      className={styles.saveState}
                      aria-live="polite"
                    >
                      {saveSummary}
                    </span>
                  </div>
                  <div className={styles.fieldList}>
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
                      const memberEditable = Boolean(
                        canonicalNewLead &&
                          row.deal_id &&
                          (entry.key === "owner" ||
                            entry.key === "collaborators") &&
                          canEditItems,
                      );
                      const fieldLabelId = `${row.id}-${entry.key}-label`;
                      return (
                        <div
                          key={entry.key}
                          id={`detail-field-${entry.key}`}
                          className={styles.fieldRow}
                        >
                          <span aria-hidden="true" className={styles.fieldHandle}>⠿</span>
                          <label
                            id={fieldLabelId}
                            htmlFor={editable && !memberEditable ? `${row.id}-${entry.key}` : undefined}
                            className={styles.fieldLabel}
                          >
                            {label}
                            <span className={`${styles.fieldBadge} ${entry.source === "column" ? styles.columnBadge : ""}`}>
                              {entry.source === "detail" ? "상세" : "표"}
                            </span>
                          </label>
                          <div className={styles.fieldValue}>
                            {memberEditable ? (
                              <form action={updateNewLeadMetaAction} className={styles.memberField}>
                                <input type="hidden" name="boardId" value={boardId} />
                                <input type="hidden" name="itemId" value={row.id} />
                                <input type="hidden" name="dealId" value={row.deal_id ?? ""} />
                                <input type="hidden" name="field" value={entry.key} />
                                <MemberPicker
                                  label={label}
                                  members={memberOptions}
                                  value={
                                    entry.key === "collaborators"
                                      ? Array.isArray(value)
                                        ? value.filter(
                                            (candidate): candidate is string =>
                                              typeof candidate === "string",
                                          )
                                        : []
                                      : typeof value === "string"
                                        ? value
                                        : null
                                  }
                                  multiple={entry.key === "collaborators"}
                                  compact
                                  labelId={fieldLabelId}
                                />
                              </form>
                            ) : editable ? (
                              <AutoSaveField
                                boardId={boardId}
                                itemId={row.id}
                                fieldKey={entry.key}
                                source={entry.source}
                                type={type}
                                initialValue={inputValue(value)}
                                canonicalDealId={canonicalNewLead ? row.deal_id : null}
                                onStatusChange={(status) =>
                                  setFieldSaveStatuses((current) =>
                                    current[entry.key] === status
                                      ? current
                                      : { ...current, [entry.key]: status },
                                  )
                                }
                              />
                            ) : (
                              <p className={styles.readonlyValue}>
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
                              <form action={promoteDetailFieldAction}>
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
                                className={styles.promoteButton}
                                title={`${label}을 표에도 보이기`}
                                aria-label={`${label}을 표에도 보이기`}
                              >
                                ⋯
                              </button>
                            </form>
                          )}
                          </div>
                        </div>
                      );
                    })}
                    {canonicalNewLead && row.deal_id ? (
                      <details className={styles.compactTools}>
                        <summary>업무 이동</summary>
                        <div className={styles.compactToolsBody}>
                          <form action={advanceAction} className="grid gap-2 rounded-lg border border-mw-record bg-mw-tint-blue p-2">
                            <input type="hidden" name="boardId" value={boardId} />
                            <input type="hidden" name="itemId" value={row.id} />
                            <input type="hidden" name="requestId" value={advanceRequestId} />
                            <button
                              type="submit"
                              disabled={!canEditItems || advancePending || advanceState.ok}
                              className="min-h-9 rounded-lg bg-mw-record px-3 text-xs font-bold text-white disabled:opacity-50"
                            >
                              {advancePending ? "넘기는 중…" : advanceState.ok ? "리드컨택으로 넘김" : "리드컨택으로 넘기기"}
                            </button>
                            {advanceState.message ? (
                              <p role={advanceState.ok ? "status" : "alert"} className={`text-xs ${advanceState.ok ? "text-mw-success" : "text-mw-error"}`}>
                                {advanceState.message}{advanceState.ok ? <> <Link href="/contract" className="font-semibold underline">리드컨택 열기</Link></> : null}
                              </p>
                            ) : null}
                          </form>
                        </div>
                      </details>
                    ) : null}
                  </div>

                  <details
                    className={styles.compactTools}
                  >
                    <summary>
                      이 화면에 배치되지 않은 항목 {unplaced.length}개
                    </summary>
                    <div className={styles.compactToolsBody}>
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
                    <details className={styles.compactTools}>
                      <summary>
                        이 아이템의 상세 배치 편집
                      </summary>
                      <div className={styles.compactToolsBody}>
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
                    <details className={styles.compactTools}>
                      <summary>
                        보드 기본 상세 배치
                      </summary>
                      <div className={styles.compactToolsBody}>
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
                  <details className={styles.compactTools}>
                    <summary>첨부 · 링크</summary>
                    <div className={styles.compactToolsBody}>
                    <p className="text-xs text-mw-sub">
                      파일은 10MB씩 5개, 합계 30MB까지 올릴 수 있어요. 외부 자료는 Google Drive, OneDrive, Dropbox, 웹하드 등의 https 링크를 20개까지 연결하고, 보는 사람에게 읽기 권한이 있는지 확인하세요.
                    </p>
                    <div className="grid gap-2">
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
                    </div>
                  </details>
                  <details className={styles.compactTools}>
                    <summary>내보내기</summary>
                    <div className={styles.compactToolsBody}>
                    <div className="flex flex-wrap gap-2">
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
                    </div>
                  </details>
                </div>

                <aside className={styles.mainPane} data-item-detail-main>
                  <section className={styles.watcherCard} data-item-detail-watchers>
                    <div className={styles.watcherCopy}>
                      <span>이 건이 바뀌면 알게 되는 사람</span>
                      {detail.members.map((member) => (
                        <span
                          key={member.id}
                          className={styles.watcherChip}
                        >
                          <span className={styles.watcherAvatar}>{(member.name ?? "조").slice(0, 1)}</span>
                          {member.name ?? "조직 멤버"}
                        </span>
                      ))}
                      {detail.members.length === 0 && (
                        <span>
                          담당자·출동 계보가 아직 없습니다.
                        </span>
                      )}
                    </div>
                    {canEditItems && layout.some((entry) => entry.key === "collaborators") && (
                      <button
                        type="button"
                        className={styles.watcherChange}
                        onClick={focusCollaborators}
                      >
                        바꾸기
                      </button>
                    )}
                  </section>
                  <section className={styles.history} data-item-detail-history>
                    <div className={styles.historyHeader}>
                      <h3>히스토리</h3>
                      <span className={styles.historyMeta}>
                        최신순 · 자동 기록 포함 · 삭제 불가
                      </span>
                    </div>
                    <div className={styles.historyScroll}>
                    {!detail.ok && (
                      <p
                        role="alert"
                        className={styles.historyError}
                      >
                        {detail.message}
                      </p>
                    )}
                    {detail.events.map((event) => {
                      const actorName = detail.members.find((member) => member.id === event.actor_id)?.name;
                      return (
                        <article
                          key={event.id}
                          className={styles.historyEntry}
                        >
                          <span
                            className={styles.historyAvatar}
                            data-automatic={event.kind === "field_change"}
                            aria-hidden="true"
                          >
                            {event.kind === "field_change" ? "⚙" : event.kind === "call" ? "통" : "메"}
                          </span>
                          <div>
                          <div className={styles.historyLine}>
                            <b>
                              {event.kind === "call"
                                ? actorName ?? "담당자"
                                : event.kind === "field_change"
                                  ? "자동 기록"
                                  : actorName ?? "담당자"}
                            </b>
                            <span className={styles.historyKind}>
                              {event.kind === "call" ? "통화" : event.kind === "field_change" ? "자동" : "메모"}
                            </span>
                            <time>
                              {new Date(event.created_at).toLocaleString(
                                "ko-KR",
                              )}
                            </time>
                          </div>
                          <p className={styles.historyBody}>
                            {event.body}
                          </p>
                          </div>
                        </article>
                      );
                    })}
                      {detail.events.length === 0 && !detailPending && (
                        <p className={styles.emptyHistory}>
                          아직 히스토리가 없습니다. 메모나 통화 기록을 남기면 이곳에 시간순으로 쌓입니다.
                        </p>
                      )}
                    </div>
                  </section>
                  {canEditItems && (
                    <section className={styles.composer} data-item-detail-composer>
                      <textarea
                        aria-label="메모 또는 통화 기록"
                        value={composer}
                        onChange={(event) => setComposer(event.target.value)}
                        placeholder="메모를 적으세요 — @이름으로 멘션할 수 있습니다"
                        rows={2}
                      />
                      {detail.members.length > 0 && (
                        <fieldset className={styles.mentionList}>
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
                                >
                                  @{member.name ?? "담당자"}
                                </button>
                              );
                            })}
                        </fieldset>
                      )}
                      <div className={styles.composerActions}>
                        <button
                          type="button"
                          onClick={() => setComposerKind("memo")}
                          aria-pressed={composerKind === "memo"}
                        >
                          메모
                        </button>
                        <button
                          type="button"
                          onClick={() => setComposerKind("call")}
                          aria-pressed={composerKind === "call"}
                        >
                          통화 기록
                        </button>
                        <span className="text-xs text-mw-sub">
                          @ 멘션
                        </span>
                        <button
                          type="button"
                          disabled={detailPending || !composer.trim()}
                          onClick={submitEvent}
                          className={styles.submitButton}
                        >
                          등록
                        </button>
                      </div>
                    </section>
                  )}
                </aside>
              </div>
              </div>
            </section>
          </div>
        </DialogPortal>
      )}
    </>
  );
}
