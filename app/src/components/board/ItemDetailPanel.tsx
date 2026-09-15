"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  clampComposerHeight,
  continueList,
  indentLines,
  outdentLines,
  type EditState,
} from "@/lib/boards/composer-editing";
import { clampDetailInset, clampRailWidth, DETAIL_DEFAULT_INSET } from "@/lib/boards/detail-pane-geometry";
import {
  canRemoveDetailEvent,
  canRestoreDetailEvent,
} from "@/lib/boards/detail-event-permissions";
import {
  detailEventActorInitial,
  detailEventAuthorName,
  detailEventKindIndex,
  detailEventKindLabel,
  SELECTABLE_DETAIL_EVENT_KINDS,
  type SelectableDetailEventKind,
} from "@/lib/boards/detail-event-kinds";
import { createPortal } from "react-dom";
import type {
  BoardColumn,
  CellValue,
  ItemWithValues,
} from "@/lib/boards/types";
import type { DetailLayoutEntry } from "@/lib/boards/detail-layout";
import {
  isDemotableDetailKey,
  moveDetailEntry,
  unplacedDetailKeys,
} from "@/lib/boards/detail-layout";
import { formatCell } from "@/lib/boards/cells";
import { formatPhone, presentPhone, type PhoneNormalizationStatus } from "@/lib/format/phone";
import { isSourceEditable } from "@/lib/field/source";
import {
  addDetailFieldAction,
  addUnplacedDetailEntryAction,
  demoteDetailFieldAction,
  promoteDetailFieldAction,
  resetGroupDetailLayoutAction,
  saveDetailLayoutAction,
} from "@/app/(app)/boards/actions";
import {
  saveNewLeadDetailFieldAction,
  updateNewLeadMetaAction,
} from "@/app/(app)/boards/new-lead-actions";
import {
  addItemDetailEventAction,
  removeItemDetailEventAction,
  restoreItemDetailEventAction,
  loadItemDetailAction,
  removeItemCloudFolderAction,
  saveItemCloudFolderAction,
  saveItemDetailFieldAction,
  type ItemDetailSnapshot,
} from "@/app/(app)/boards/item-detail-actions";
import { inspectCloudFolderUrl } from "@/lib/boards/cloud-folder-link";
import {
  CREDIT_SCORE_KEYS,
  EXISTING_LOAN_KEYS,
  EXISTING_LOAN_RECORDS_KEY,
  NEW_LEAD_COMPOSITE_FIELD_KEYS,
  existingLoanRecordsFromValues,
  existingLoanRecordsSummary,
} from "@/lib/new-lead/financial-profile";
import {
  durableNewLeadDetailLayout,
  newLeadPresentationLabel,
  presentNewLeadUnplacedKeys,
} from "@/lib/default-tabs/new-lead";
import { MemberPicker, type MemberPickerMember } from "./MemberPicker";
import { AssignmentLineagePopover } from "./AssignmentLineagePopover";
import { NewLeadCreditScoresCell } from "./NewLeadCreditScoresCell";
import { NewLeadFoundedDateCell } from "./NewLeadFoundedDateCell";
import { NewLeadLoanCell } from "./NewLeadLoanCell";
import { NewLeadRevenue3yCell } from "./NewLeadRevenue3yCell";
import { OtherInfoBoardCell } from "./OtherInfoBoardCell";
import {
  OTHER_INFO_COLUMN_KEY,
  otherInfoDetailText,
  otherInfoLegacyFromValues,
} from "@/lib/boards/structured-field";
import styles from "./item-detail-panel.module.css";

const CANONICAL_NEW_LEAD_DETAIL_KEYS = new Set([
  "applied_on", "address_detail", "rep_name", "phone", "email", "biz_reg_type",
  "industry", "revenue_band", "sido", "sigungu", "ad_name",
]);

const CANONICAL_NEW_LEAD_LOAN_KEYS = new Set<string>([
  ...Object.values(EXISTING_LOAN_KEYS),
  EXISTING_LOAN_RECORDS_KEY,
]);

function AutoSaveField({
  boardId,
  itemId,
  fieldKey,
  source,
  type,
  initialValue,
  canonicalDealId,
  phoneStatus = "normalized",
  onStatusChange,
}: {
  boardId: string;
  itemId: string;
  fieldKey: string;
  source: "column" | "detail";
  type: string;
  initialValue: string | number;
  canonicalDealId?: string | null;
  phoneStatus?: PhoneNormalizationStatus;
  onStatusChange?: (status: string) => void;
}) {
  const presentedInitial = type === "phone" ? presentPhone(String(initialValue), phoneStatus) : String(initialValue);
  const [value, setValue] = useState(presentedInitial);
  const [status, setStatus] = useState("✓ 자동 저장됨");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedRef = useRef(presentedInitial);
  const valueRef = useRef(presentedInitial);
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
      const result = canonicalDealId && source === "column"
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
        min={fieldKey === "credit_score_ncb" || fieldKey === "credit_score_kcb" ? 1 : undefined}
        max={fieldKey === "credit_score_ncb" || fieldKey === "credit_score_kcb" ? 1000 : fieldKey === "existing_loan_rate" ? 100 : undefined}
        step={fieldKey === "credit_score_ncb" || fieldKey === "credit_score_kcb" ? 1 : undefined}
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          valueRef.current = next;
          updateStatus("저장 대기…");
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => save(valueRef.current), 700);
        }}
        onBlur={() => {
          if (type === "phone") {
            const formatted = formatPhone(valueRef.current);
            if (formatted && formatted !== "확인 필요") {
              valueRef.current = formatted;
              setValue(formatted);
            }
          }
          save(valueRef.current);
        }}
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
  if (typeof value === "object") return "";
  return typeof value === "number" ? value : String(value);
}

export function detailValueText(
  type: string | undefined,
  value: CellValue | undefined,
  values: ItemWithValues["values"],
  options?: BoardColumn["options_jsonb"],
): string {
  if (type === "other_info") {
    return otherInfoDetailText(value, otherInfoLegacyFromValues(values));
  }
  if (!type) return inputValue(value).toString();
  return formatCell(type as BoardColumn["type"], value ?? null, options?.options ?? []) || "—";
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
  canonicalNewLead = false,
  sourceEntries = [],
}: {
  boardId: string;
  groupId: string | null;
  layout: DetailLayoutEntry[];
  label: string;
  disabled?: boolean;
  canonicalNewLead?: boolean;
  sourceEntries?: readonly DetailLayoutEntry[];
}) {
  const durableLayout = canonicalNewLead
    ? durableNewLeadDetailLayout(layout, sourceEntries)
    : layout;
  return (
    <form action={saveDetailLayoutAction}>
      <input type="hidden" name="boardId" value={boardId} />
      <input type="hidden" name="groupId" value={groupId ?? ""} />
      <input type="hidden" name="layout" value={JSON.stringify(durableLayout)} />
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
  durableColumns = [],
  durableBoardLayout = boardLayout,
  durableLayout = layout,
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
  durableColumns?: BoardColumn[];
  durableBoardLayout?: DetailLayoutEntry[];
  durableLayout?: DetailLayoutEntry[];
  layout: DetailLayoutEntry[];
  inherited: boolean;
  canEditItems: boolean;
  canManageColumns: boolean;
  defaultOpen?: boolean;
  canonicalNewLead?: boolean;
  memberOptions?: readonly MemberPickerMember[];
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
  const [composerKind, setComposerKind] =
    useState<SelectableDetailEventKind>("memo");
  /*
   * #662 — 성격 고르개가 열려 있나.
   *
   * 총괄 지시 그대로다 — 「버튼을 누르면 미끄러지듯이 열려서 네 개 중 하나를 고른다」.
   * 늘 넷을 펼쳐 두지 않는 이유는 375px 에서 등록 줄이 두 줄로 접히고,
   * 대부분의 기록은 「메모」 그대로 쓰기 때문이다.
   */
  const [kindPickerOpen, setKindPickerOpen] = useState(false);
  const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([]);
  /*
   * #660 — 입력창 높이. null 이면 CSS 기본값(두 줄)을 쓴다.
   *
   * ★ 손잡이를 «위쪽» 에 둔다. 이 칸은 화면 «아래» 에 붙어 있어서, 아래로 끌어 늘리면
   *   화면 밖으로 나간다. 위로 끌어 늘리는 게 이 자리에서는 자연스러운 방향이다.
   *   네이티브 resize 는 오른쪽 «아래» 모서리에만 붙으므로 직접 만든다.
   */
  const [composerHeight, setComposerHeight] = useState<number | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const composerDragRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);

  /** 값과 커서를 함께 바꾼다. 커서는 다음 프레임에 되돌린다 — 지금 쓰면 React 가 value 를 덮으며 지운다. */
  const applyComposerEdit = useCallback((next: EditState) => {
    setComposer(next.value);
    requestAnimationFrame(() => {
      const node = composerRef.current;
      if (!node) return;
      node.selectionStart = next.selectionStart;
      node.selectionEnd = next.selectionEnd;
    });
  }, []);

  /*
   * #660 — Slack 처럼 마크다운을 «치면서» 쓴다.
   *
   * 탭으로 줄 수준을 올리고 내리고, 엔터가 목록을 이어 준다.
   * 판정은 전부 lib/boards/composer-editing.ts 에 있다 — 여기는 배선만 한다.
   *
   * ★ 탭을 가로채면 키보드만 쓰는 사람이 이 칸에 갇힌다. 그래서 Escape 로 빠져나갈 문을 둔다.
   *   화면에도 그렇게 적는다(aria-label).
   */
  const onComposerKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const node = event.currentTarget;
    const state: EditState = {
      value: node.value,
      selectionStart: node.selectionStart,
      selectionEnd: node.selectionEnd,
    };
    if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      applyComposerEdit(event.shiftKey ? outdentLines(state) : indentLines(state));
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const next = continueList(state);
      // null 이면 브라우저 기본 줄바꿈을 그대로 둔다 — 흉내 내면 실행 취소 기록이 끊긴다.
      if (!next) return;
      event.preventDefault();
      applyComposerEdit(next);
      return;
    }
    if (event.key === "Escape") node.blur();
  }, [applyComposerEdit]);

  /*
   * #660 — 높이 조절 손잡이를 «위쪽» 에 둔다.
   *
   * 이 칸은 화면 아래에 붙어 있다. 네이티브 resize 는 오른쪽 «아래» 모서리에만 붙는데,
   * 그쪽으로 끌면 화면 밖으로 나가서 늘릴 수가 없다. 위로 끌어 늘리는 게 이 자리의 방향이다.
   */
  const beginComposerResize = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const node = composerRef.current;
    if (!node) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    composerDragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: node.getBoundingClientRect().height,
    };
  }, []);

  const moveComposerResize = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = composerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // ★ 위로 끌면(clientY 가 줄면) 커진다. 부호를 뒤집는 곳이 여기 한 군데다.
    const next = drag.startHeight + (drag.startY - event.clientY);
    setComposerHeight(clampComposerHeight(next, window.innerHeight));
  }, []);

  const endComposerResize = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = composerDragRef.current;
    if (!drag) return;
    composerDragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(drag.pointerId);
    } catch {
      // 포인터가 이미 풀렸으면 그걸로 됐다.
    }
  }, []);

  /*
   * #660 — 상세 화면을 «가장자리를 끌어» 조절한다.
   *
   *   왼쪽 가장자리   전체 너비 (여백이 줄면 대화상자가 넓어진다 · 0 이면 전체 화면)
   *   가운데 선       좌우 분할 (왼쪽 정보 칸의 너비)
   *
   * ★ null 이면 CSS 기본값을 그대로 쓴다. 기본 기하는 시각 계약이 재고 있어서
   *   (왼쪽 여백 80~112px · 정보 칸 352~430px) 기본을 바꾸면 게이트가 빨개진다.
   *   사용자가 끌었을 때만 값이 생긴다.
   * ★ 두 번 누르면 기본으로 돌아간다 — 끌어서 망가뜨린 것을 되돌릴 길을 같이 둔다.
   */
  const [detailInset, setDetailInset] = useState<number | null>(null);
  const [railWidth, setRailWidth] = useState<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const paneDragRef = useRef<{ pointerId: number; kind: "inset" | "rail" } | null>(null);

  const beginPaneDrag = useCallback((kind: "inset" | "rail") => (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    paneDragRef.current = { pointerId: event.pointerId, kind };
  }, []);

  const movePaneDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = paneDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.kind === "inset") {
      // 왼쪽 가장자리를 끈 자리가 곧 여백이다. 왼쪽으로 끌수록 대화상자가 넓어진다.
      setDetailInset(clampDetailInset(event.clientX, window.innerWidth));
      return;
    }
    const box = contentRef.current?.getBoundingClientRect();
    if (!box) return;
    setRailWidth(clampRailWidth(event.clientX - box.left, box.width));
  }, []);

  const endPaneDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = paneDragRef.current;
    if (!drag) return;
    paneDragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(drag.pointerId);
    } catch {
      // 이미 풀렸으면 그걸로 됐다.
    }
  }, []);
  const [folderUrl, setFolderUrl] = useState(initialDetail?.cloudFolder?.url ?? "");
  const [folderEditing, setFolderEditing] = useState(!initialDetail?.cloudFolder);
  const [folderError, setFolderError] = useState("");
  const folderTouchedRef = useRef(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [fieldSaveStatuses, setFieldSaveStatuses] = useState<Record<string, string>>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(open);
  const suppressOpenerRestoreRef = useRef(false);
  const hashPushedRef = useRef(false);
  const columnsByKey = new Map(columns.map((column) => [column.key, column]));
  const durableColumnEntries: DetailLayoutEntry[] = durableColumns.map((column) => ({
    key: column.key,
    source: "column",
    label: column.label,
    type: column.type,
  }));
  // Existing layout entries win over column defaults so a move cannot erase
  // company-specific labels/types/source metadata for either durable sibling.
  const durableLayoutSources = [...durableColumnEntries, ...durableLayout];
  const durableBoardLayoutSources = [...durableColumnEntries, ...durableBoardLayout];
  const canonicalLoanEntryKey = canonicalNewLead
    ? layout.find((entry) => entry.key === EXISTING_LOAN_KEYS.amount)?.key
      ?? layout.find((entry) => entry.key === EXISTING_LOAN_RECORDS_KEY)?.key
      ?? layout.find((entry) => CANONICAL_NEW_LEAD_LOAN_KEYS.has(entry.key))?.key
      ?? null
    : null;
  const visibleLayout = layout.filter((entry) =>
    !canonicalNewLead
    || entry.key === canonicalLoanEntryKey
    || !CANONICAL_NEW_LEAD_LOAN_KEYS.has(entry.key),
  );
  const ownerId = row.assigned_to ?? (typeof row.values.owner === "string" ? row.values.owner : null);
  const collaboratorIds = Array.isArray(row.values.collaborators)
    ? row.values.collaborators.filter((candidate): candidate is string => typeof candidate === "string")
    : [];
  const ownerMember = ownerId ? memberOptions.find((member) => member.id === ownerId) : undefined;
  const relatedMembers = collaboratorIds
    .map((id) => memberOptions.find((member) => member.id === id))
    .filter((member): member is MemberPickerMember => Boolean(member));
  const rawUnplaced = unplacedDetailKeys(row.values, visibleLayout).filter(
    (key) => !canonicalNewLead || (
      key !== "contact_move"
      && key !== "consult_status"
      && !CANONICAL_NEW_LEAD_LOAN_KEYS.has(key)
    ),
  );
  const unplaced = canonicalNewLead
    ? presentNewLeadUnplacedKeys(rawUnplaced, visibleLayout.map((entry) => entry.key))
    : rawUnplaced;
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

  useEffect(() => {
    if (!detail.cloudFolder || folderTouchedRef.current) return;
    setFolderUrl(detail.cloudFolder.url);
    setFolderEditing(false);
  }, [detail.cloudFolder]);

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

  function submitCloudFolder() {
    const inspected = inspectCloudFolderUrl(folderUrl);
    if (!inspected.ok) {
      setFolderError(inspected.message);
      return;
    }
    startDetailTransition(async () => {
      const next = await saveItemCloudFolderAction({
        boardId,
        itemId: row.id,
        url: inspected.url,
        requestId: crypto.randomUUID(),
      });
      refreshDetail(next);
      if (next.ok) {
        folderTouchedRef.current = false;
        setFolderUrl(next.cloudFolder?.url ?? inspected.url);
        setFolderEditing(false);
        setFolderError("");
      } else {
        setFolderError(next.message ?? "클라우드 폴더를 저장하지 못했습니다.");
      }
    });
  }

  function removeCloudFolder() {
    if (!window.confirm("클라우드 폴더 연결을 해제할까요? 이전 첨부와 링크는 그대로 보존됩니다.")) return;
    startDetailTransition(async () => {
      const next = await removeItemCloudFolderAction({
        boardId,
        itemId: row.id,
        requestId: crypto.randomUUID(),
      });
      refreshDetail(next);
      if (next.ok) {
        folderTouchedRef.current = false;
        setFolderUrl("");
        setFolderEditing(true);
        setFolderError("");
      } else {
        setFolderError(next.message ?? "클라우드 폴더 연결을 해제하지 못했습니다.");
      }
    });
  }

  const exportText = () => {
    const fields = layout.map(
      (entry) => {
        const column = columnsByKey.get(entry.key);
        return `${entry.label ?? column?.label ?? entry.key}: ${detailValueText(entry.type ?? column?.type, row.values[entry.key], row.values, column?.options_jsonb)}`;
      },
    );
    const history = detail.events.map(
      (event) =>
        `[${event.created_at}] ${detailEventKindLabel(event.kind)}: ${event.body}`,
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
        className="min-h-7 shrink-0 rounded-lg border border-mw-line px-2 text-xs font-semibold text-mw-record hover:bg-mw-tint-blue"
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
            <section
              className={styles.surface}
              data-item-detail-surface
              style={detailInset === null ? undefined : { width: `calc(100% - ${detailInset}px)` }}
            >
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

              <div
                ref={contentRef}
                className={styles.content}
                style={railWidth === null ? undefined : { gridTemplateColumns: `${railWidth}px minmax(0, 1fr)` }}
              >
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
                      <p className="rounded-md border border-dashed border-mw-line p-4 text-sm text-mw-sub">
                        배치된 상세 필드가 없습니다. 값이 있다면 아래 미배치
                        영역에서 다시 올릴 수 있습니다.
                      </p>
                    )}
                    {visibleLayout.filter((entry) => !canonicalNewLead || entry.key !== "collaborators").map((entry) => {
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
                      const assignmentLineageField = Boolean(
                        canonicalNewLead &&
                          row.deal_id &&
                          entry.key === "owner",
                      );
                      const financialCompositeField = Boolean(
                        canonicalNewLead && (
                          entry.key === NEW_LEAD_COMPOSITE_FIELD_KEYS.creditScores
                          || entry.key === NEW_LEAD_COMPOSITE_FIELD_KEYS.revenue3yMillion
                          || entry.key === NEW_LEAD_COMPOSITE_FIELD_KEYS.foundedDate
                        ),
                      );
                      const structuredCompositeField = type === "other_info";
                      const loanCompositeField = Boolean(
                        canonicalNewLead && entry.key === canonicalLoanEntryKey,
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
                            htmlFor={
                              loanCompositeField && canEditItems
                                ? `${row.id}-${entry.key}`
                                : editable && !assignmentLineageField && !financialCompositeField && !structuredCompositeField
                                  ? `${row.id}-${entry.key}`
                                  : undefined
                            }
                            className={styles.fieldLabel}
                          >
                            {label}
                            <span className={`${styles.fieldBadge} ${entry.source === "column" ? styles.columnBadge : ""}`}>
                              {entry.source === "detail" ? "상세" : "표"}
                            </span>
                          </label>
                          <div className={styles.fieldValue}>
                            {canonicalNewLead && entry.key === canonicalLoanEntryKey ? (
                              <NewLeadLoanCell
                                boardId={boardId}
                                itemId={row.id}
                                values={row.values}
                                readOnly={!canEditItems}
                                controlId={`${row.id}-${entry.key}`}
                              />
                            ) : canonicalNewLead && entry.key === NEW_LEAD_COMPOSITE_FIELD_KEYS.creditScores ? (
                              <NewLeadCreditScoresCell
                                boardId={boardId}
                                itemId={row.id}
                                ncb={row.values[CREDIT_SCORE_KEYS.ncb]}
                                kcb={row.values[CREDIT_SCORE_KEYS.kcb]}
                                readOnly={!editable}
                                onStatusChange={(fieldKey, status) =>
                                  setFieldSaveStatuses((current) =>
                                    current[fieldKey] === status
                                      ? current
                                      : { ...current, [fieldKey]: status },
                                  )
                                }
                              />
                            ) : canonicalNewLead && entry.key === NEW_LEAD_COMPOSITE_FIELD_KEYS.foundedDate ? (
                              <NewLeadFoundedDateCell
                                boardId={boardId}
                                itemId={row.id}
                                value={row.values[NEW_LEAD_COMPOSITE_FIELD_KEYS.foundedDate]}
                                readOnly={!editable}
                                onStatusChange={(status) =>
                                  setFieldSaveStatuses((current) =>
                                    current[NEW_LEAD_COMPOSITE_FIELD_KEYS.foundedDate] === status
                                      ? current
                                      : { ...current, [NEW_LEAD_COMPOSITE_FIELD_KEYS.foundedDate]: status },
                                  )
                                }
                              />
                            ) : canonicalNewLead && entry.key === NEW_LEAD_COMPOSITE_FIELD_KEYS.revenue3yMillion ? (
                              <NewLeadRevenue3yCell
                                boardId={boardId}
                                itemId={row.id}
                                value={row.values[NEW_LEAD_COMPOSITE_FIELD_KEYS.revenue3yMillion]}
                                legacyRevenueBand={row.values.revenue_band}
                                readOnly={!editable}
                                onStatusChange={(status) =>
                                  setFieldSaveStatuses((current) =>
                                    current[NEW_LEAD_COMPOSITE_FIELD_KEYS.revenue3yMillion] === status
                                      ? current
                                      : { ...current, [NEW_LEAD_COMPOSITE_FIELD_KEYS.revenue3yMillion]: status },
                                  )
                                }
                              />
                            ) : entry.key === EXISTING_LOAN_RECORDS_KEY ? (
                              <p className={styles.readonlyValue}>
                                {existingLoanRecordsSummary(existingLoanRecordsFromValues(row.values))}
                              </p>
                            ) : type === "other_info" ? (
                              <OtherInfoBoardCell
                                boardId={boardId}
                                itemId={row.id}
                                fieldKey={entry.key}
                                value={value}
                                legacy={entry.key === OTHER_INFO_COLUMN_KEY ? otherInfoLegacyFromValues(row.values) : undefined}
                                readOnly={!editable}
                              />
                            ) : assignmentLineageField ? (
                              <div className={styles.memberField} aria-labelledby={fieldLabelId}>
                                <AssignmentLineagePopover
                                  boardId={boardId}
                                  dealId={row.deal_id!}
                                  itemId={row.id}
                                  currentAssigneeId={ownerId}
                                  members={memberOptions}
                                  readOnly={!canEditItems}
                                />
                              </div>
                            ) : editable ? (
                              <AutoSaveField
                                boardId={boardId}
                                itemId={row.id}
                                fieldKey={entry.key}
                                source={entry.source}
                                type={type}
                                initialValue={inputValue(value)}
                                canonicalDealId={canonicalNewLead && CANONICAL_NEW_LEAD_DETAIL_KEYS.has(entry.key) ? row.deal_id : null}
                                phoneStatus={row.value_statuses?.[entry.key] ?? "normalized"}
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
                                  ? (column.type === "phone"
                                      ? presentPhone(typeof value === "string" ? value : null, row.value_statuses?.[entry.key] ?? "normalized")
                                      : formatCell(
                                          column.type,
                                          value ?? null,
                                          column.options_jsonb?.options ?? [],
                                        )) || "—"
                                  : inputValue(value) || "—"}
                              </p>
                            )}
                            {/*
                              #657 — 「표로 올리기」에 «되돌리기» 를 붙인다.
                              전에는 올리는 버튼만 있었고, 그것도 source === "detail" 일 때만 그려져서
                              한 번 누르면 버튼 자체가 사라졌다 — 되돌릴 수 없는 한 방향 문이었다.
                              버튼 글자는 «가는 곳» 을 그대로 적는다. ⋯ 만으로는 무엇이 일어날지 모른다.
                            */}
                            {canManageColumns && entry.source === "detail" && (
                              <form action={promoteDetailFieldAction}>
                                <input type="hidden" name="boardId" value={boardId} />
                                <input type="hidden" name="fieldKey" value={entry.key} />
                                <button
                                  type="submit"
                                  className={styles.promoteButton}
                                  title={`${label}을 표에도 보이게 합니다`}
                                  aria-label={`${label}을 표에도 보이기`}
                                >
                                  표에도
                                </button>
                              </form>
                            )}
                            {/*
                              ★ 원래부터 표 컬럼이던 칸(owner·industry …)에는 안 붙인다.
                                그건 되돌리기가 아니라 구조 축소다(D71~D75).
                                표에서 잠깐 감추는 일은 「표시 컬럼」이 이미 한다.
                            */}
                            {canManageColumns && entry.source === "column" && isDemotableDetailKey(entry.key) && (
                              <form action={demoteDetailFieldAction}>
                                <input type="hidden" name="boardId" value={boardId} />
                                <input type="hidden" name="fieldKey" value={entry.key} />
                                <button
                                  type="submit"
                                  className={styles.promoteButton}
                                  title={`${label}을 표에서 내리고 상세에서만 보이게 합니다. 값은 그대로 남고 컬럼은 휴지통으로 갑니다`}
                                  aria-label={`${label}을 표에서 내리기`}
                                >
                                  상세만
                                </button>
                              </form>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {canManageColumns ? (
                      <details className={styles.detailFieldCreator}>
                        <summary>+ 상세 전용 필드 추가</summary>
                        <form action={addDetailFieldAction} className={styles.detailFieldCreatorForm}>
                          <input type="hidden" name="boardId" value={boardId} />
                          <input type="hidden" name="groupId" value={row.group_id ?? ""} />
                          <input name="label" required placeholder="상세에서만 쓸 필드 이름" aria-label="상세 전용 필드 이름" />
                          <select name="type" aria-label="상세 전용 필드 타입">
                            <option value="text">텍스트</option>
                            <option value="number">숫자</option>
                            <option value="date">날짜</option>
                            <option value="phone">전화</option>
                            <option value="email">이메일</option>
                            <option value="url">링크</option>
                          </select>
                          <button type="submit">추가</button>
                        </form>
                      </details>
                    ) : null}
                  </div>

                  <aside className={styles.orderRules} aria-label="상세 화면 순서 규칙">
                    <b>순서 규칙</b>
                    <p>이 화면의 순서는 상세에서만 바뀌며 보드 표의 컬럼 순서는 그대로예요.</p>
                    <p>상세 전용 필드는 표에 나타나지 않으며, 필요할 때만 표 컬럼으로 올릴 수 있어요.</p>
                    <p>표 컬럼과 상세 전용 필드를 섞어 원하는 순서에 놓아도 값은 하나로 함께 저장돼요.</p>
                  </aside>

                  {canManageColumns ? (
                  <details className={styles.layoutAdmin}>
                    <summary>관리자 · 상세 배치 편집</summary>
                    <div className={styles.layoutAdminBody}>
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
                              {newLeadPresentationLabel(key) ?? columnsByKey.get(key)?.label ?? key}
                            </b>
                            <span className="block truncate text-xs text-mw-sub">
                              {detailValueText(
                                columnsByKey.get(key)?.type,
                                row.values[key],
                                row.values,
                                columnsByKey.get(key)?.options_jsonb,
                              )}
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
                            canonicalNewLead={canonicalNewLead}
                            sourceEntries={durableLayoutSources}
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
                        {visibleLayout.map((entry, index) => (
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
                              layout={moveDetailEntry(visibleLayout, entry.key, -1)}
                              label="↑"
                              disabled={index === 0 || !row.group_id}
                              canonicalNewLead={canonicalNewLead}
                              sourceEntries={durableLayoutSources}
                            />
                            <SaveLayoutForm
                              boardId={boardId}
                              groupId={row.group_id}
                              layout={moveDetailEntry(visibleLayout, entry.key, 1)}
                              label="↓"
                              disabled={
                                index === visibleLayout.length - 1 || !row.group_id
                              }
                              canonicalNewLead={canonicalNewLead}
                              sourceEntries={durableLayoutSources}
                            />
                            <SaveLayoutForm
                              boardId={boardId}
                              groupId={row.group_id}
                              layout={visibleLayout.filter(
                                (candidate) => candidate.key !== entry.key,
                              )}
                              label="배치에서 빼기"
                              disabled={!row.group_id}
                              canonicalNewLead={canonicalNewLead}
                              sourceEntries={durableLayoutSources}
                            />
                          </div>
                        ))}
                        {columns.filter(
                          (column) =>
                            (!canonicalNewLead || !CANONICAL_NEW_LEAD_LOAN_KEYS.has(column.key))
                            && !visibleLayout.some((entry) => entry.key === column.key),
                        ).length > 0 && (
                          <div className="flex flex-wrap gap-2 rounded-md border border-dashed border-mw-line p-3">
                            <span className="w-full text-xs font-semibold text-mw-sub">
                              표 컬럼을 이 아이템 배치에 추가
                            </span>
                            {columns
                              .filter(
                                (column) =>
                                  (!canonicalNewLead || !CANONICAL_NEW_LEAD_LOAN_KEYS.has(column.key))
                                  && !visibleLayout.some(
                                    (entry) => entry.key === column.key,
                                  ),
                              )
                              .map((column) => (
                                <SaveLayoutForm
                                  key={column.key}
                                  boardId={boardId}
                                  groupId={row.group_id}
                                  layout={[
                                    ...visibleLayout,
                                    {
                                      key: column.key,
                                      source: "column",
                                      label: column.label,
                                      type: column.type,
                                    },
                                  ]}
                                  label={`+ ${column.label}`}
                                  disabled={!row.group_id}
                                  canonicalNewLead={canonicalNewLead}
                                  sourceEntries={durableLayoutSources}
                                />
                              ))}
                          </div>
                        )}
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
                              canonicalNewLead={canonicalNewLead}
                              sourceEntries={durableBoardLayoutSources}
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
                              canonicalNewLead={canonicalNewLead}
                              sourceEntries={durableBoardLayoutSources}
                            />
                            <SaveLayoutForm
                              boardId={boardId}
                              groupId={null}
                              layout={boardLayout.filter(
                                (candidate) => candidate.key !== entry.key,
                              )}
                              label="빼기"
                              canonicalNewLead={canonicalNewLead}
                              sourceEntries={durableBoardLayoutSources}
                            />
                          </div>
                        ))}
                        {columns.filter(
                          (column) =>
                            !boardLayout.some(
                              (entry) => entry.key === column.key,
                            ),
                        ).length > 0 && (
                          <div className="flex flex-wrap gap-2 rounded-md border border-dashed border-mw-line p-3">
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
                                  canonicalNewLead={canonicalNewLead}
                                  sourceEntries={durableBoardLayoutSources}
                                />
                              ))}
                          </div>
                        )}
                        <form
                          action={addDetailFieldAction}
                          className="grid gap-2 rounded-md border border-dashed border-mw-line p-3 sm:grid-cols-[1fr_9rem_auto]"
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
                    </div>
                  </details>
                  ) : null}
                  <details className={`${styles.compactTools} ${styles.cloudFolderTools}`} open>
                    <summary>클라우드 폴더</summary>
                    <div className={styles.compactToolsBody}>
                      <p className="text-xs text-mw-sub">
                        이 회사의 자료는 Google Drive·OneDrive·Dropbox 등의 폴더 하나로 모아 관리합니다. 폴더를 볼 사람에게 공유 권한이 있는지 확인해 주세요.
                      </p>
                      {detail.cloudFolder && !folderEditing ? (
                        <div className={styles.cloudFolderCard}>
                          <span className={styles.cloudFolderProvider}>
                            {detail.cloudFolder.providerLabel}
                          </span>
                          <span className={styles.cloudFolderUrl} title={detail.cloudFolder.url}>
                            {detail.cloudFolder.url}
                          </span>
                          <a
                            href={detail.cloudFolder.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.cloudFolderOpen}
                          >
                            폴더 열기 <span className="sr-only">(새 창)</span>
                          </a>
                          {canEditItems && (
                            <div className={styles.cloudFolderActions}>
                              <button
                                type="button"
                                onClick={() => {
                                  folderTouchedRef.current = true;
                                  setFolderUrl(detail.cloudFolder?.url ?? "");
                                  setFolderEditing(true);
                                  setFolderError("");
                                }}
                              >
                                수정
                              </button>
                              <button type="button" onClick={removeCloudFolder} disabled={detailPending}>
                                연결 해제
                              </button>
                            </div>
                          )}
                        </div>
                      ) : canEditItems ? (
                        <div className={styles.cloudFolderEditor}>
                          <label htmlFor={`${row.id}-cloud-folder`}>폴더 공유 주소</label>
                          <div className={styles.cloudFolderInputRow}>
                            <input
                              id={`${row.id}-cloud-folder`}
                              aria-label="클라우드 폴더 주소"
                              type="url"
                              inputMode="url"
                              maxLength={2048}
                              value={folderUrl}
                              onChange={(event) => {
                                folderTouchedRef.current = true;
                                setFolderUrl(event.target.value);
                                setFolderError("");
                              }}
                              placeholder="https://drive.google.com/drive/folders/..."
                            />
                            <button type="button" onClick={submitCloudFolder} disabled={detailPending}>
                              {detailPending ? "저장 중…" : "폴더 연결"}
                            </button>
                            {detail.cloudFolder && (
                              <button
                                type="button"
                                onClick={() => {
                                  folderTouchedRef.current = false;
                                  setFolderUrl(detail.cloudFolder?.url ?? "");
                                  setFolderEditing(false);
                                  setFolderError("");
                                }}
                              >
                                취소
                              </button>
                            )}
                          </div>
                          {folderError && <p role="alert" className={styles.cloudFolderError}>{folderError}</p>}
                        </div>
                      ) : (
                        <p className="text-xs text-mw-sub">연결된 클라우드 폴더가 없습니다.</p>
                      )}

                      <details className={styles.legacyMaterials}>
                        <summary>이전 첨부·링크 {detail.files.length + detail.links.length}개</summary>
                        <p>기존 자료는 삭제하거나 덮어쓰지 않고 읽기 전용으로 보존합니다.</p>
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
                          rel="noopener noreferrer"
                          className="rounded-lg border border-mw-line px-3 py-2 text-sm font-semibold text-mw-record underline"
                        >
                          🔗 {link.label}
                          <span className="sr-only"> (새 창)</span>
                        </a>
                          ))}
                          {detail.links.length === 0 && detail.files.length === 0 && (
                            <p className="text-xs text-mw-sub">보존된 이전 자료가 없습니다.</p>
                          )}
                        </div>
                      </details>
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
                            `항목,값\n${layout.map((entry) => {
                              const column = columnsByKey.get(entry.key);
                              const value = detailValueText(entry.type ?? column?.type, row.values[entry.key], row.values, column?.options_jsonb);
                              return `"${entry.label ?? entry.key}","${value.replaceAll('"', '""')}"`;
                            }).join("\n")}`,
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
                  {/*
                    #660 — 가운데 선을 끌면 좌우 분할이 바뀐다.
                    ★ 정보 칸(infoRail)은 스크롤되는 상자라 그 안에 두면 손잡이가 같이 밀려 올라간다.
                      스크롤하지 않는 이쪽(mainPane) 왼쪽 끝에 붙인다 — 자리는 같고 안 밀린다.
                  */}
                  <button
                    type="button"
                    data-detail-split-grip
                    className={styles.splitGrip}
                    aria-label="좌우 분할 조절 — 끌어서 정보 칸 너비를 바꿉니다"
                    title="끌어서 좌우 분할 · 두 번 누르면 원래대로"
                    onPointerDown={beginPaneDrag("rail")}
                    onPointerMove={movePaneDrag}
                    onPointerUp={endPaneDrag}
                    onPointerCancel={endPaneDrag}
                    onDoubleClick={() => setRailWidth(null)}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                      event.preventDefault();
                      const box = contentRef.current?.getBoundingClientRect();
                      const rail = document.querySelector<HTMLElement>("[data-item-detail-info-rail]")?.getBoundingClientRect();
                      if (!box || !rail) return;
                      setRailWidth(clampRailWidth(rail.width + (event.key === "ArrowLeft" ? -32 : 32), box.width));
                    }}
                  />
                  <section className={styles.watcherCard} data-item-detail-watchers>
                    <div className={styles.watcherCopy}>
                      <b>연관담당</b>
                      {ownerMember ? (
                        <span
                          key={`owner:${ownerMember.id}`}
                          className={`${styles.watcherChip} ${styles.ruleWatcherChip}`}
                        >
                          <span className={styles.watcherAvatar}>{ownerMember.label.slice(0, 1)}</span>
                          {ownerMember.label}<small>담당자</small>
                        </span>
                      ) : null}
                      {relatedMembers.slice(0, 3).map((member) => (
                        <span key={member.id} className={styles.watcherChip}>
                          <span className={styles.watcherAvatar}>{member.label.slice(0, 1)}</span>
                          {member.label}
                        </span>
                      ))}
                      {relatedMembers.length > 3 ? <span className={styles.watcherMore}>+{relatedMembers.length - 3}</span> : null}
                      {!ownerMember && relatedMembers.length === 0 ? <span>알림을 받을 사람이 아직 없습니다.</span> : null}
                    </div>
                    {/*
                      #657 — 연관담당을 «여기서도» 더할 수 있게 한다.
                      칩은 row.values.collaborators 에서 바로 그리는데(layout 과 무관),
                      바꾸는 버튼만 「collaborators 가 상세 배치에 놓여 있을 때」로 막혀 있었다.
                      그래서 연관담당이 보이는데 이 자리에서는 못 바꾸는 상태가 됐다 —
                      바꾸려면 「담당자 흐름」 팝오버까지 들어가야 했다.
                      ★ 신규리드 정본 보드에서는 항상 연다. 다른 보드는 종전 조건 그대로 둔다 —
                        그쪽은 collaborators 가 배치에 있을 때만 이 액션이 뜻을 갖는다.
                    */}
                    {canEditItems && row.deal_id && (canonicalNewLead || layout.some((entry) => entry.key === "collaborators")) ? (
                      <form action={updateNewLeadMetaAction} className={styles.watcherForm}>
                        <input type="hidden" name="boardId" value={boardId} />
                        <input type="hidden" name="itemId" value={row.id} />
                        <input type="hidden" name="dealId" value={row.deal_id} />
                        <input type="hidden" name="field" value="collaborators" />
                        <MemberPicker
                          label="연관담당"
                          members={memberOptions}
                          value={collaboratorIds}
                          multiple
                          compact
                          triggerLabel={relatedMembers.length > 0 ? "바꾸기" : "추가"}
                          ruleRecipients={ownerMember ? [ownerMember] : []}
                        />
                      </form>
                    ) : null}
                  </section>
                  <section className={styles.history} data-item-detail-history>
                    <div className={styles.historyHeader}>
                      <h3>히스토리</h3>
                      <span className={styles.historyMeta}>
                        최신순 · 자동 기록 포함 · 치운 기록은 되살릴 수 있어요
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
                      /*
                        #672 — 「치우기」는 «누를 수 있는 줄에만» 보인다.
                        못 누르는 자리에 회색 버튼을 두면 눌러 보고 실패하는 길을 만드는 셈이다.
                        ★ 막는 것은 서버다(마이그레이션 144). 이건 안내일 뿐이다.
                      */
                      const viewer = {
                        viewerId: detail.viewerId ?? null,
                        viewerRole: detail.viewerRole ?? null,
                        assignedTo: detail.assignedTo ?? null,
                      };
                      const removed = Boolean(event.deleted_at);
                      const canRemove =
                        canEditItems &&
                        !removed &&
                        canRemoveDetailEvent({ kind: event.kind, actorId: event.actor_id }, viewer);
                      const canRestore =
                        canEditItems && removed && canRestoreDetailEvent(event.deleted_by ?? null, viewer);
                      return (
                        <article
                          key={event.id}
                          className={styles.historyEntry}
                          data-removed={removed || undefined}
                        >
                          {/*
                            #657 — 히스토리 종류를 «배지 색» 으로 나눈다.
                            전에는 통화·메모·자동이 전부 같은 파란 배지라, 훑을 때 «전화한 것» 을
                            메모 사이에서 골라낼 수 없었다. 토큰의 뜻 그대로 나눈다 —
                            통화=사람 접촉(coral) · 메모=기록(blue) · 자동=자동화(teal)
                            · 행정=서류(amber) · 미팅=만남(violet).

                            #662 — ★ 아바타는 «누가» 다. 성격에 따라 바꾸지 않는다.
                            전에는 같은 사람이 메모를 남기면 「메」, 전화를 하면 「통」이라
                            한 사람이 두 얼굴로 보였다. 성격은 옆 배지가 전부 말한다.
                          */}
                          <span
                            className={styles.historyAvatar}
                            data-automatic={event.kind === "field_change"}
                            aria-hidden="true"
                          >
                            {event.kind === "field_change"
                              ? "⚙"
                              : detailEventActorInitial(actorName)}
                          </span>
                          <div>
                          <div className={styles.historyLine}>
                            <b>{detailEventAuthorName(event.kind, actorName)}</b>
                            <span className={styles.historyKind} data-kind={event.kind}>
                              {detailEventKindLabel(event.kind)}
                            </span>
                            <time>
                              {new Date(event.created_at).toLocaleString(
                                "ko-KR",
                              )}
                            </time>
                          </div>
                          <p className={styles.historyBody}>
                            {removed ? "치운 기록이에요." : event.body}
                          </p>
                          </div>
                          {canRemove && (
                            <button
                              type="button"
                              className={styles.historyRemove}
                              data-history-remove
                              disabled={detailPending}
                              aria-label={`${detailEventKindLabel(event.kind)} 기록 치우기`}
                              title="치우기 — 되살릴 수 있어요"
                              onClick={() =>
                                startDetailTransition(async () => {
                                  const next = await removeItemDetailEventAction({
                                    boardId, itemId: row.id, eventId: event.id,
                                  });
                                  setDetail(next);
                                })
                              }
                            >
                              치우기
                            </button>
                          )}
                          {canRestore && (
                            <button
                              type="button"
                              className={styles.historyRemove}
                              data-history-restore
                              disabled={detailPending}
                              aria-label={`${detailEventKindLabel(event.kind)} 기록 되살리기`}
                              onClick={() =>
                                startDetailTransition(async () => {
                                  const next = await restoreItemDetailEventAction({
                                    boardId, itemId: row.id, eventId: event.id,
                                  });
                                  setDetail(next);
                                })
                              }
                            >
                              되살리기
                            </button>
                          )}
                        </article>
                      );
                    })}
                      {detail.events.length === 0 && !detailPending && (
                        <p className={styles.emptyHistory}>
                          아직 히스토리가 없습니다. 메모·통화·행정·미팅 기록을 남기면 이곳에 시간순으로 쌓입니다.
                        </p>
                      )}
                    </div>
                  </section>
                  {canEditItems && (
                    <section className={styles.composer} data-item-detail-composer>
                      {/*
                        #660 — 높이 조절 손잡이. 오른쪽 «위» 에 둔다.
                        이 칸은 화면 아래에 붙어 있어서 아래로는 늘릴 자리가 없다.
                        두 번 누르면 원래 높이로 돌아간다 — 늘린 것을 되돌릴 길을 같이 둔다.
                      */}
                      <button
                        type="button"
                        data-composer-grip
                        className={styles.composerGrip}
                        aria-label="입력창 높이 조절 — 위로 끌면 커져요. 위·아래 화살표로도 조절합니다"
                        title="끌어서 높이 조절 · 두 번 누르면 원래대로"
                        onPointerDown={beginComposerResize}
                        onPointerMove={moveComposerResize}
                        onPointerUp={endComposerResize}
                        onPointerCancel={endComposerResize}
                        onDoubleClick={() => setComposerHeight(null)}
                        onKeyDown={(event) => {
                          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                          event.preventDefault();
                          const current = composerRef.current?.getBoundingClientRect().height ?? 0;
                          const step = event.key === "ArrowUp" ? 24 : -24;
                          setComposerHeight(clampComposerHeight(current + step, window.innerHeight));
                        }}
                      >
                        <span aria-hidden="true" />
                      </button>
                      <textarea
                        ref={composerRef}
                        aria-label="기록 내용 — 성격은 아래에서 고릅니다. 탭으로 들여쓰기, Esc 로 빠져나가기"
                        value={composer}
                        onChange={(event) => setComposer(event.target.value)}
                        onKeyDown={onComposerKeyDown}
                        placeholder="기록을 적으세요 — @이름 멘션 · 「- 」로 목록 · 탭으로 들여쓰기"
                        rows={2}
                        style={composerHeight === null ? undefined : { height: `${composerHeight}px`, maxHeight: `${composerHeight}px` }}
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
                        {/*
                          #662 — 성격 고르개. 「버튼을 누르면 미끄러지듯이 열려서 넷 중 하나를 고른다」.

                          ★ 닫혀 있는 동안 inert 를 건다. 폭 0 + overflow:hidden 만으로는
                            «보이지 않는데 탭이 걸리는» 버튼 넷이 남는다 — 키보드만 쓰는 사람은
                            빈 곳을 네 번 지나가게 된다.
                          ★ 자동(field_change)은 여기 없다. 시스템이 남기는 기록이라 고를 수 없고,
                            DB 가드(마이그레이션 143)도 넷만 받는다.
                        */}
                        <div
                          className={styles.kindPicker}
                          data-open={kindPickerOpen ? "true" : "false"}
                          data-detail-kind-picker
                        >
                          <button
                            type="button"
                            className={styles.kindToggle}
                            aria-expanded={kindPickerOpen}
                            aria-controls="item-detail-kind-options"
                            onClick={() => setKindPickerOpen((open) => !open)}
                          >
                            {detailEventKindLabel(composerKind)}
                            <span className={styles.kindChevron} aria-hidden="true">
                              ▾
                            </span>
                          </button>
                          <div
                            id="item-detail-kind-options"
                            className={styles.kindOptions}
                            data-kind={composerKind}
                            role="radiogroup"
                            aria-label="기록의 성격"
                            inert={!kindPickerOpen}
                          >
                            <span
                              className={styles.kindThumb}
                              aria-hidden="true"
                              style={
                                {
                                  "--kind-index": detailEventKindIndex(composerKind),
                                } as CSSProperties
                              }
                            />
                            {SELECTABLE_DETAIL_EVENT_KINDS.map((kind) => (
                              <button
                                key={kind}
                                type="button"
                                role="radio"
                                aria-checked={composerKind === kind}
                                tabIndex={composerKind === kind ? 0 : -1}
                                onKeyDown={(event) => {
                                  const step =
                                    event.key === "ArrowRight" || event.key === "ArrowDown"
                                      ? 1
                                      : event.key === "ArrowLeft" || event.key === "ArrowUp"
                                        ? -1
                                        : 0;
                                  if (step === 0) return;
                                  event.preventDefault();
                                  const list = SELECTABLE_DETAIL_EVENT_KINDS;
                                  const next =
                                    list[(list.indexOf(kind) + step + list.length) % list.length];
                                  setComposerKind(next);
                                }}
                                onClick={() => {
                                  setComposerKind(kind);
                                  setKindPickerOpen(false);
                                }}
                              >
                                {detailEventKindLabel(kind)}
                              </button>
                            ))}
                          </div>
                        </div>
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
              {/*
                #660 — 왼쪽 가장자리를 끌면 전체 너비가 바뀐다. 왼쪽으로 갈수록 넓어지고,
                끝까지 끌면 전체 화면이 된다. 두 번 누르면 기본으로 돌아간다.

                ★ 자리는 화면 왼쪽 끝인데(절대 위치) 마크업은 «맨 뒤» 에 둔다.
                  앞에 두면 이 버튼이 대화상자의 첫 초점이 되어 닫기 버튼을 밀어낸다 —
                  열자마자 「닫기」에 초점이 가야 한다는 계약이 있고 시험이 그걸 잡는다.
                  보조 조작이므로 초점 순서에서도 맨 뒤가 맞다.
              */}
              <button
                type="button"
                data-detail-edge-grip
                className={styles.edgeGrip}
                aria-label="상세 화면 너비 조절 — 왼쪽으로 끌면 넓어져요"
                title="끌어서 너비 조절 · 두 번 누르면 원래대로"
                onPointerDown={beginPaneDrag("inset")}
                onPointerMove={movePaneDrag}
                onPointerUp={endPaneDrag}
                onPointerCancel={endPaneDrag}
                onDoubleClick={() => setDetailInset(null)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                  event.preventDefault();
                  const current = detailInset ?? DETAIL_DEFAULT_INSET;
                  setDetailInset(clampDetailInset(current + (event.key === "ArrowLeft" ? -32 : 32), window.innerWidth));
                }}
              />
            </section>
          </div>
        </DialogPortal>
      )}
    </>
  );
}
