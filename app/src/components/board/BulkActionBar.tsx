"use client";

/**
 * 선택 작업 바 + 일괄 대화상자 (agenda06).
 *
 * 바는 작게 — 개수·대상·지원되는 작업만. 대화상자는 적용 전 목록 검토,
 * 건별 실패 보존, 입력 유지를 보장한다. 삭제·복제·보관·관계변환은 두지 않는다.
 *
 * 저장은 `bulk-actions.ts` 의 권한 검사 서버 액션만 쓴다. 전이 열/값은
 * 선택지에 올리지 않고 서버 게이트가 한 번 더 막는다.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  bulkApplyCellsAction,
  bulkAssignAction,
  bulkMoveGroupAction,
  type BulkApplyResult,
} from "@/app/(app)/boards/bulk-actions";
import {
  bulkRestoreAction,
  bulkTrashAction,
  type BulkTrashResult,
} from "@/app/(app)/boards/bulk-trash-actions";
import {
  bulkAddNoteAction,
  type BulkNoteResult,
} from "@/app/(app)/boards/bulk-note-actions";
import { BULK_BLOCKED_VALUES } from "@/components/board/bulk-selection";
import type { WorkflowProgressKind } from "@/lib/workflow/progress";
import { SELECTABLE_DETAIL_EVENT_KINDS, type SelectableDetailEventKind } from "@/lib/boards/detail-event-kinds";
import type { CellValue } from "@/lib/boards/types";

export type BulkOpKind = "status" | "assignee" | "date" | "fields" | "move" | "trash" | "note";

export interface BulkDialogState {
  op: BulkOpKind;
  preset?: string;
  /** 필드 일괄이 낱개 셀에서 넘어올 때 실제 컬럼 키·값을 미리 담는다. */
  fieldKey?: string;
  fieldValue?: string;
}

export interface BulkTargetRow {
  id: string;
  title: string;
}

export interface BulkStatusColumn {
  key: string;
  label: string;
  options: { id: string; label: string }[];
}

export interface BulkFieldColumn {
  key: string;
  label: string;
  type: string;
  options?: { id: string; label: string }[];
}

export interface BulkDateColumn {
  key: string;
  label: string;
  includeTime: boolean;
}

/** 날짜 이동 — 시:분 보존, N일 이동 (목업 shiftDateTime 과 동일 계약). */
export function shiftBulkDateTime(value: string, days: number): string | null {
  if (!Number.isInteger(days)) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const y = +dateOnly[1];
    const m = +dateOnly[2];
    const d = +dateOnly[3];
    const date = new Date(y, m - 1, d);
    if (
      Number.isNaN(date.getTime())
      || date.getFullYear() !== y
      || date.getMonth() !== m - 1
      || date.getDate() !== d
    ) return null;
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (match) {
    const y = +match[1];
    const m = +match[2];
    const d = +match[3];
    const hh = +match[4];
    const mm = +match[5];
    const date = new Date(y, m - 1, d, hh, mm);
    if (
      Number.isNaN(date.getTime())
      || date.getFullYear() !== y
      || date.getMonth() !== m - 1
      || date.getDate() !== d
      || date.getHours() !== hh
      || date.getMinutes() !== mm
    ) return null;
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  // 저장된 정본 ISO — 예: 2026-09-25T14:30:00.000Z.
  // 분 로컬 문자열만 받으면 저장값이 전부 «해석 불가» 로 빠져 조용히 유지된다.
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  if (/[Zz]$|[+-]\d{2}:?\d{2}$/.test(value.trim())) {
    // 타임존이 있는 순간 — UTC 날짜를 N일 이동하고 ISO 로 돌려준다 (시각·타임존 보존).
    const shifted = new Date(parsed.getTime());
    shifted.setUTCDate(shifted.getUTCDate() + days);
    return shifted.toISOString();
  }
  // 타임존 없는 로컬 ISO(초·밀리초 포함) — 벽시계 기준 N일 이동, 분 형식으로 돌려준다.
  const localSec = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!localSec) return null;
  const y = +localSec[1];
  const m = +localSec[2];
  const d = +localSec[3];
  const hh = +localSec[4];
  const mm = +localSec[5];
  const date = new Date(y, m - 1, d, hh, mm);
  if (
    Number.isNaN(date.getTime())
    || date.getFullYear() !== y
    || date.getMonth() !== m - 1
    || date.getDate() !== d
  ) return null;
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const BAR_BUTTON = "rounded border border-mw-line bg-mw-card px-2.5 py-1 text-xs font-medium text-mw-body hover:bg-mw-bg disabled:opacity-50";
const DIALOG_INPUT = "w-full rounded border border-mw-line bg-mw-card px-2 py-1.5 text-sm text-mw-fg";
const DIALOG_PRIMARY = "rounded bg-mw-primary px-4 py-1.5 text-sm font-semibold text-mw-on-accent disabled:opacity-50";

function titleOf(targets: readonly BulkTargetRow[], itemId: string): string {
  return targets.find((row) => row.id === itemId)?.title ?? itemId;
}

export function BulkFailures({ result, targets }: { result: BulkApplyResult; targets: readonly BulkTargetRow[] }) {
  return <Failures result={result} targets={targets} />;
}

function Failures({ result, targets }: { result: BulkApplyResult; targets: readonly BulkTargetRow[] }) {
  const failures = result.results.filter((entry) => !entry.ok);
  if (failures.length === 0) return null;
  return (
    <div role="alert" className="rounded border border-mw-error/40 bg-mw-card px-3 py-2 text-xs text-mw-error">
      <p className="font-semibold">저장하지 못한 {failures.length}개 — 입력은 그대로 두었습니다.</p>
      <ul className="mt-1 max-h-32 list-disc overflow-y-auto pl-4">
        {failures.map((entry) => (
          <li key={entry.itemId}>{titleOf(targets, entry.itemId)} — {entry.message}</li>
        ))}
      </ul>
    </div>
  );
}

function ReviewList({ targets }: { targets: readonly BulkTargetRow[] }) {
  return (
    <div className="rounded bg-mw-bg px-3 py-2 text-xs text-mw-body">
      <p className="font-semibold">보기 내 {targets.length}개에 적용합니다</p>
      <ul className="mt-1 max-h-32 overflow-y-auto">
        {targets.map((row) => (
          <li key={row.id} className="truncate">· {row.title}</li>
        ))}
      </ul>
    </div>
  );
}

function DialogShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prev = document.activeElement as HTMLElement | null;
    try {
      if (!el.open) el.showModal();
    } catch { /* 정적 렌더·jsdom: showModal 미지원 */ }
    try {
      const target = el.querySelector<HTMLElement>("select, input, button:not([aria-label='닫기'])") ?? el;
      target.focus({ preventScroll: true });
    } catch { /* 포커스 실패는 무시 */ }
    const onCancel = (event: Event) => {
      event.preventDefault();
      onCloseRef.current();
    };
    el.addEventListener("cancel", onCancel);
    return () => {
      el.removeEventListener("cancel", onCancel);
      try { if (el.open) el.close(); } catch { /* 무시 */ }
      try { prev?.focus?.(); } catch { /* 무시 */ }
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className="fixed inset-0 m-auto max-h-[calc(100vh-2rem)] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto whitespace-normal rounded-md border border-mw-line bg-mw-card p-0 text-mw-fg shadow-lg backdrop:bg-slate-950/50"
    >
      <div className="flex items-start justify-between gap-4 border-b border-mw-line px-5 py-4">
        <h2 className="text-base font-bold tracking-tight">{title}</h2>
        <button type="button" aria-label="닫기" onClick={onClose} className="h-8 w-8 rounded-full border border-mw-line text-mw-sub hover:bg-mw-bg">×</button>
      </div>
      <div className="flex flex-col gap-3 px-5 py-4">{children}</div>
    </dialog>
  );
}

function StatusDialog({
  boardId,
  workflowKind,
  statusColumn,
  targets,
  preset,
  onClose,
  onApplied,
  onNotice,
}: {
  boardId: string;
  workflowKind: WorkflowProgressKind | null;
  statusColumn: BulkStatusColumn;
  targets: readonly BulkTargetRow[];
  preset?: string;
  onClose: () => void;
  onApplied: (succeededIds: string[]) => void;
  onNotice: (message: string) => void;
}) {
  const options = useMemo(
    () => statusColumn.options.filter((option) => !BULK_BLOCKED_VALUES.has(option.id)),
    [statusColumn],
  );
  const [value, setValue] = useState(preset && options.some((o) => o.id === preset) ? preset : "");
  const [localError, setLocalError] = useState<string | null>(
    preset && !options.some((o) => o.id === preset)
      ? `요청한 상태(${preset})는 일괄로 적용할 수 없어 제외했습니다. 가능한 값을 고르세요.`
      : null,
  );
  const [result, setResult] = useState<BulkApplyResult | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = useMemo(() => targets.map((row) => row.id), [targets]);

  const apply = () => {
    if (!value) { setLocalError("상태를 선택하세요."); return; }
    setLocalError(null);
    startTransition(async () => {
      const next = await bulkApplyCellsAction({
        boardId, itemIds: ids, columnKey: statusColumn.key, value, workflowKind,
      });
      setResult(next);
      const succeeded = next.results.filter((entry) => entry.ok).map((entry) => entry.itemId);
      onApplied(succeeded);
      if (next.failed === 0) {
        onNotice(`${next.applied}개 상태를 변경했습니다.`);
        onClose();
      }
    });
  };

  return (
    <DialogShell title="상태 일괄 변경" onClose={onClose}>
      <p className="text-xs text-mw-sub">모두에 공통으로 고를 수 있는 보드 안 단계만 표시합니다. 다음 업무로 넘기기는 낱개 확인 흐름에서만 가능합니다.</p>
      <ReviewList targets={targets} />
      <label className="flex flex-col gap-1 text-xs font-medium">상태
        <select value={value} onChange={(e) => setValue(e.target.value)} className={DIALOG_INPUT} aria-label="일괄 적용할 상태">
          <option value="">선택하세요</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </label>
      {localError ? <p role="alert" className="text-xs text-mw-error">{localError}</p> : null}
      {result ? <Failures result={result} targets={targets} /> : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={BAR_BUTTON}>취소</button>
        <button type="button" onClick={apply} disabled={pending} className={DIALOG_PRIMARY}>
          {pending ? "적용 중…" : `${targets.length}개 상태 적용`}
        </button>
      </div>
    </DialogShell>
  );
}

function AssigneeDialog({
  boardId,
  members,
  targets,
  onClose,
  onApplied,
  onNotice,
}: {
  boardId: string;
  members: { id: string; label: string }[];
  targets: readonly BulkTargetRow[];
  onClose: () => void;
  onApplied: (succeededIds: string[]) => void;
  onNotice: (message: string) => void;
}) {
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkApplyResult | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = useMemo(() => targets.map((row) => row.id), [targets]);

  const apply = () => {
    if (!assigneeId) { setLocalError("담당자를 선택하세요."); return; }
    setLocalError(null);
    startTransition(async () => {
      const next = await bulkAssignAction({
        boardId, itemIds: ids, assigneeId: assigneeId === "__unassigned__" ? null : assigneeId,
      });
      setResult(next);
      const succeeded = next.results.filter((entry) => entry.ok).map((entry) => entry.itemId);
      onApplied(succeeded);
      if (next.failed === 0) {
        onNotice(`${next.applied}개 담당자를 변경했습니다.`);
        onClose();
      }
    });
  };

  return (
    <DialogShell title="담당자 일괄 수정" onClose={onClose}>
      <ReviewList targets={targets} />
      <label className="flex flex-col gap-1 text-xs font-medium">담당자
        <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={DIALOG_INPUT} aria-label="일괄 적용할 담당자">
          <option value="">선택하세요</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>{member.label}</option>
          ))}
          <option value="__unassigned__">미배정</option>
        </select>
      </label>
      {localError ? <p role="alert" className="text-xs text-mw-error">{localError}</p> : null}
      {result ? <Failures result={result} targets={targets} /> : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={BAR_BUTTON}>취소</button>
        <button type="button" onClick={apply} disabled={pending} className={DIALOG_PRIMARY}>
          {pending ? "적용 중…" : `${targets.length}개 담당자 적용`}
        </button>
      </div>
    </DialogShell>
  );
}

function DateDialog({
  boardId,
  workflowKind,
  dateColumns,
  targets,
  targetValues,
  onClose,
  onApplied,
  onNotice,
}: {
  boardId: string;
  workflowKind: WorkflowProgressKind | null;
  dateColumns: BulkDateColumn[];
  targets: readonly BulkTargetRow[];
  targetValues: Record<string, Record<string, CellValue>>;
  onClose: () => void;
  onApplied: (succeededIds: string[]) => void;
  onNotice: (message: string) => void;
}) {
  const [columnKey, setColumnKey] = useState(dateColumns[0]?.key ?? "");
  const [mode, setMode] = useState<"set" | "shift">("set");
  const [setValue, setSetValue] = useState("");
  const [shiftDays, setShiftDays] = useState("");
  const [skipMissing, setSkipMissing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkApplyResult | null>(null);
  const [pending, startTransition] = useTransition();
  const column = dateColumns.find((entry) => entry.key === columnKey) ?? dateColumns[0];

  const plan = useMemo(() => {
    if (!column) return { errors: ["날짜 컬럼이 없습니다."], rows: [] as { id: string; title: string; oldV: string; newV: string }[] };
    const errors: string[] = [];
    const rows: { id: string; title: string; oldV: string; newV: string }[] = [];
    if (mode === "set") {
      if (!setValue) errors.push("지정할 날짜를 입력하세요.");
      else {
        const ok = column.includeTime
          ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(setValue)
          : /^\d{4}-\d{2}-\d{2}$/.test(setValue);
        if (!ok) errors.push("날짜 형식을 확인하세요.");
      }
      for (const row of targets) {
        const oldRaw = targetValues[row.id]?.[column.key];
        rows.push({ id: row.id, title: row.title, oldV: typeof oldRaw === "string" ? oldRaw : "", newV: setValue });
      }
    } else {
      const n = Number(shiftDays);
      if (!Number.isInteger(n) || n === 0) errors.push("이동할 일수를 0이 아닌 정수로 입력하세요(예: 3 또는 -2).");
      else if (Math.abs(n) > 1825) errors.push("이동 범위는 ±1825일 이내로 입력하세요.");
      const missing: string[] = [];
      const invalid: string[] = [];
      for (const row of targets) {
        const oldRaw = targetValues[row.id]?.[column.key];
        const oldV = typeof oldRaw === "string" ? oldRaw : "";
        if (!oldV) {
          missing.push(row.title);
          rows.push({ id: row.id, title: row.title, oldV: "", newV: "" });
          continue;
        }
        const shifted = Number.isInteger(n) ? shiftBulkDateTime(oldV, n) : null;
        if (shifted === null) {
          invalid.push(row.title);
          rows.push({ id: row.id, title: row.title, oldV, newV: "" });
          continue;
        }
        rows.push({ id: row.id, title: row.title, oldV, newV: shifted });
      }
      if (invalid.length > 0) {
        errors.push(`해석할 수 없는 날짜 ${invalid.length}개(${invalid.join(", ")}) — 값을 확인하세요.`);
      }
      if (missing.length > 0 && !skipMissing) {
        errors.push(`날짜 없는 기록 ${missing.length}개(${missing.join(", ")}) — 그대로 두려면 확인란을 켜세요.`);
      }
    }
    return { errors, rows };
  }, [column, mode, setValue, shiftDays, skipMissing, targets, targetValues]);

  const apply = () => {
    if (!column) return;
    if (plan.errors.length > 0) { setLocalError(plan.errors[0]); return; }
    setLocalError(null);
    startTransition(async () => {
      const groups = new Map<string, string[]>();
      for (const entry of plan.rows) {
        if (!entry.newV || (mode === "shift" && skipMissing && !entry.oldV)) continue;
        if (entry.newV === entry.oldV) continue;
        const list = groups.get(entry.newV) ?? [];
        list.push(entry.id);
        groups.set(entry.newV, list);
      }
      if (groups.size === 0) {
        setLocalError("바뀔 값이 없습니다. 입력을 확인하세요.");
        return;
      }
      const merged: BulkApplyResult = { ok: true, applied: 0, failed: 0, results: [] };
      for (const [newV, ids] of groups) {
        const next = await bulkApplyCellsAction({ boardId, itemIds: ids, columnKey: column.key, value: newV, workflowKind });
        merged.results.push(...next.results);
      }
      merged.applied = merged.results.filter((entry) => entry.ok).length;
      merged.failed = merged.results.length - merged.applied;
      merged.ok = merged.failed === 0;
      setResult(merged);
      const succeeded = merged.results.filter((entry) => entry.ok).map((entry) => entry.itemId);
      onApplied(succeeded);
      if (merged.failed === 0) {
        onNotice(`${merged.applied}개 일정을 수정했습니다.`);
        onClose();
      }
    });
  };

  if (!column) return null;
  return (
    <DialogShell title="일정 일괄 수정" onClose={onClose}>
      <ReviewList targets={targets} />
      <label className="flex flex-col gap-1 text-xs font-medium">날짜 컬럼
        <select value={column.key} onChange={(e) => setColumnKey(e.target.value)} className={DIALOG_INPUT} aria-label="일괄 적용할 날짜 컬럼">
          {dateColumns.map((entry) => (
            <option key={entry.key} value={entry.key}>{entry.label}</option>
          ))}
        </select>
      </label>
      <div className="flex gap-4 text-xs" role="radiogroup" aria-label="일정 적용 방식">
        <label className="flex items-center gap-1">
          <input type="radio" name="bulk-date-mode" value="set" checked={mode === "set"} onChange={() => setMode("set")} /> 같은 날짜로 지정
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" name="bulk-date-mode" value="shift" checked={mode === "shift"} onChange={() => setMode("shift")} /> 기존 날짜에서 N일 이동
        </label>
      </div>
      {mode === "set" ? (
        <label className="flex flex-col gap-1 text-xs font-medium">지정할 날짜
          <input
            type={column.includeTime ? "datetime-local" : "date"}
            value={setValue}
            onChange={(e) => setSetValue(e.target.value)}
            className={DIALOG_INPUT}
            aria-label="지정할 날짜"
          />
        </label>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-xs font-medium">이동 일수 (예: 3 또는 -2)
            <input value={shiftDays} onChange={(e) => setShiftDays(e.target.value)} inputMode="numeric" className={DIALOG_INPUT} aria-label="이동할 일수" placeholder="3" />
          </label>
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={skipMissing} onChange={(e) => setSkipMissing(e.target.checked)} className="h-3.5 w-3.5" />
            날짜 없는 행은 그대로 두기
          </label>
        </>
      )}
      <div className="rounded bg-mw-bg px-3 py-2 text-xs text-mw-body" aria-live="polite">
        {plan.rows.map((entry) => (
          <div key={entry.id} className="truncate">{entry.title} · {entry.oldV || "날짜 없음"} → {entry.newV || "(유지)"}</div>
        ))}
      </div>
      {localError ? <p role="alert" className="text-xs text-mw-error">{localError}</p> : null}
      {result ? <Failures result={result} targets={targets} /> : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={BAR_BUTTON}>취소</button>
        <button type="button" onClick={apply} disabled={pending} className={DIALOG_PRIMARY}>
          {pending ? "적용 중…" : `${targets.length}개 일정 적용`}
        </button>
      </div>
    </DialogShell>
  );
}

function FieldsDialog({
  boardId,
  workflowKind,
  fieldColumns,
  members,
  targets,
  targetValues,
  initialColumnKey,
  initialValue,
  onClose,
  onApplied,
  onNotice,
}: {
  boardId: string;
  workflowKind: WorkflowProgressKind | null;
  fieldColumns: BulkFieldColumn[];
  members: { id: string; label: string }[];
  targets: readonly BulkTargetRow[];
  targetValues: Record<string, Record<string, CellValue>>;
  initialColumnKey?: string;
  initialValue?: string;
  onClose: () => void;
  onApplied: (succeededIds: string[]) => void;
  onNotice: (message: string) => void;
}) {
  const resolvedInitialKey = initialColumnKey && fieldColumns.some((entry) => entry.key === initialColumnKey)
    ? initialColumnKey
    : (fieldColumns[0]?.key ?? "");
  const [columnKey, setColumnKey] = useState(resolvedInitialKey);
  const [rawValue, setRawValue] = useState(initialValue ?? "");
  const [localError, setLocalError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkApplyResult | null>(null);
  const [pending, startTransition] = useTransition();
  const column = fieldColumns.find((entry) => entry.key === columnKey) ?? fieldColumns[0];
  const ids = useMemo(() => targets.map((row) => row.id), [targets]);

  const optionLabel = (id: string) => column?.options?.find((o) => o.id === id)?.label ?? id;

  const parsed = (): { ok: true; value: CellValue } | { ok: false; error: string } => {
    if (!column) return { ok: false, error: "수정할 필드를 선택하세요." };
    if (column.type === "person") {
      return { ok: true, value: rawValue === "" ? null : rawValue };
    }
    if (!rawValue.trim()) return { ok: false, error: `${column.label} 값을 입력하세요.` };
    if (column.type === "number" || column.type === "money") {
      const n = Number(rawValue.trim());
      if (!Number.isFinite(n)) return { ok: false, error: `${column.label}: 숫자만 입력하세요.` };
      return { ok: true, value: n };
    }
    return { ok: true, value: rawValue.trim() };
  };

  const apply = () => {
    const next = parsed();
    if (!next.ok) { setLocalError(next.error); return; }
    setLocalError(null);
    startTransition(async () => {
      const applied = await bulkApplyCellsAction({
        boardId, itemIds: ids, columnKey: column.key, value: next.value, workflowKind,
      });
      setResult(applied);
      const succeeded = applied.results.filter((entry) => entry.ok).map((entry) => entry.itemId);
      onApplied(succeeded);
      if (applied.failed === 0) {
        onNotice(`${applied.applied}개 필드를 수정했습니다.`);
        onClose();
      }
    });
  };

  if (!column) return null;
  return (
    <DialogShell title="필드 일괄 수정" onClose={onClose}>
      <p className="text-xs text-mw-sub">텍스트·숫자·날짜·선택·담당 칸만 고를 수 있습니다. 다음 업무로 넘기는 열은 제외됩니다.</p>
      <ReviewList targets={targets} />
      <label className="flex flex-col gap-1 text-xs font-medium">수정할 필드
        <select
          value={column.key}
          onChange={(e) => { setColumnKey(e.target.value); setRawValue(""); setResult(null); }}
          className={DIALOG_INPUT}
          aria-label="일괄 수정할 필드"
        >
          {fieldColumns.map((entry) => (
            <option key={entry.key} value={entry.key}>{entry.label}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">{column.label} 값
        {column.type === "select" || column.type === "status" ? (
          <select value={rawValue} onChange={(e) => setRawValue(e.target.value)} className={DIALOG_INPUT} aria-label={`${column.label} 값`}>
            <option value="">선택하세요</option>
            {(column.options ?? []).filter((o) => !BULK_BLOCKED_VALUES.has(o.id)).map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        ) : column.type === "person" ? (
          <select value={rawValue} onChange={(e) => setRawValue(e.target.value)} className={DIALOG_INPUT} aria-label={`${column.label} 값`}>
            <option value="">— (비우기)</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>{member.label}</option>
            ))}
          </select>
        ) : column.type === "date" ? (
          <input type="date" value={rawValue} onChange={(e) => setRawValue(e.target.value)} className={DIALOG_INPUT} aria-label={`${column.label} 값`} />
        ) : column.type === "datetime" ? (
          <input type="datetime-local" value={rawValue} onChange={(e) => setRawValue(e.target.value)} className={DIALOG_INPUT} aria-label={`${column.label} 값`} />
        ) : (
          <input
            value={rawValue}
            onChange={(e) => setRawValue(e.target.value)}
            inputMode={column.type === "number" || column.type === "money" ? "decimal" : undefined}
            maxLength={200}
            className={DIALOG_INPUT}
            aria-label={`${column.label} 값`}
            placeholder="일괄 적용할 값"
          />
        )}
      </label>
      <div className="rounded bg-mw-bg px-3 py-2 text-xs text-mw-body" aria-live="polite">
        {targets.map((row) => {
          const before = targetValues[row.id]?.[column.key];
          const beforeText = typeof before === "string" && (column.type === "select" || column.type === "status")
            ? optionLabel(before)
            : (before ?? "") === "" || before === null ? "없음" : String(before);
          return (
            <div key={row.id} className="truncate">{row.title} · {beforeText} → {rawValue || "(입력값 없음)"}</div>
          );
        })}
      </div>
      {localError ? <p role="alert" className="text-xs text-mw-error">{localError}</p> : null}
      {result ? <Failures result={result} targets={targets} /> : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={BAR_BUTTON}>취소</button>
        <button type="button" onClick={apply} disabled={pending} className={DIALOG_PRIMARY}>
          {pending ? "적용 중…" : `${targets.length}개 필드 적용`}
        </button>
      </div>
    </DialogShell>
  );
}

function MoveDialog({
  boardId,
  groups,
  targets,
  onClose,
  onApplied,
  onNotice,
}: {
  boardId: string;
  groups: { id: string; name: string }[];
  targets: readonly BulkTargetRow[];
  onClose: () => void;
  onApplied: (succeededIds: string[]) => void;
  onNotice: (message: string) => void;
}) {
  const [groupId, setGroupId] = useState<string>("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkApplyResult | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = useMemo(() => targets.map((row) => row.id), [targets]);

  const apply = () => {
    if (!groupId) { setLocalError("이동 위치를 선택하세요."); return; }
    setLocalError(null);
    startTransition(async () => {
      const next = await bulkMoveGroupAction({
        boardId, itemIds: ids, groupId: groupId === "__none__" ? null : groupId,
      });
      setResult(next);
      const succeeded = next.results.filter((entry) => entry.ok).map((entry) => entry.itemId);
      onApplied(succeeded);
      if (next.failed === 0) {
        onNotice(`${next.applied}개를 이동했습니다.`);
        onClose();
      }
    });
  };

  return (
    <DialogShell title="선택 항목 이동" onClose={onClose}>
      <p className="text-xs text-mw-sub">같은 보드의 그룹 사이 이동만 가능합니다. 행 순서는 각 그룹 맨 끝으로 들어갑니다.</p>
      <ReviewList targets={targets} />
      <label className="flex flex-col gap-1 text-xs font-medium">이동 위치
        <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className={DIALOG_INPUT} aria-label="이동할 그룹">
          <option value="">선택하세요</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>{group.name}</option>
          ))}
          <option value="__none__">그룹 없음</option>
        </select>
      </label>
      {localError ? <p role="alert" className="text-xs text-mw-error">{localError}</p> : null}
      {result ? <Failures result={result} targets={targets} /> : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={BAR_BUTTON}>취소</button>
        <button type="button" onClick={apply} disabled={pending} className={DIALOG_PRIMARY}>
          {pending ? "이동 중…" : `${targets.length}개 이동하기`}
        </button>
      </div>
    </DialogShell>
  );
}

function TrashDialog({
  boardId,
  targets,
  onClose,
  onApplied,
  onNotice,
}: {
  boardId: string;
  targets: readonly BulkTargetRow[];
  onClose: () => void;
  onApplied: (succeededIds: string[]) => void;
  onNotice: (message: string) => void;
}) {
  const [result, setResult] = useState<BulkTrashResult | null>(null);
  const [restoreResult, setRestoreResult] = useState<BulkTrashResult | null>(null);
  const [reviewTargets] = useState(() => [...targets]);
  const [restoredIds, setRestoredIds] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const ids = result ? result.results.filter((entry) => !entry.ok).map((entry) => entry.itemId) : reviewTargets.map((row) => row.id);
  const succeededIds = useMemo(
    () => (result?.results.filter((entry) => entry.ok && !restoredIds.includes(entry.itemId)).map((entry) => entry.itemId) ?? []),
    [result, restoredIds],
  );

  const apply = () => {
    setRestoreResult(null);
    startTransition(async () => {
      const next = await bulkTrashAction({ boardId, itemIds: ids });
      setResult((previous) => {
        const results = [...(previous?.results.filter((entry) => entry.ok) ?? []), ...next.results];
        const applied = results.filter((entry) => entry.ok).length;
        return { ok: applied === results.length, applied, failed: results.length - applied, results };
      });
      const succeeded = next.results.filter((entry) => entry.ok).map((entry) => entry.itemId);
      onApplied(succeeded);
      if (next.failed === 0) {
        onNotice(`${next.applied}개를 휴지통으로 옮겼습니다. 되돌리기로 복구할 수 있습니다.`);
      }
    });
  };

  const undo = () => {
    if (succeededIds.length === 0) return;
    startTransition(async () => {
      const next = await bulkRestoreAction({ boardId, itemIds: succeededIds });
      setRestoreResult(next);
      setRestoredIds((previous) => [...previous, ...next.results.filter((entry) => entry.ok).map((entry) => entry.itemId)]);
      if (next.failed === 0) {
        onNotice(`${next.applied}개를 원래 위치로 복구했습니다.`);
        onClose();
      }
    });
  };

  return (
    <DialogShell title="선택 항목 휴지통" onClose={onClose}>
      <p className="text-xs text-mw-sub">휴지통으로 옮기면 값·그룹·담당이 그대로 보존되고, 성공한 항목만 되돌릴 수 있습니다. 완전히 지우지 않습니다.</p>
      <ReviewList targets={reviewTargets} />
      {result ? <Failures result={result} targets={reviewTargets} /> : null}
      {restoreResult ? <Failures result={restoreResult} targets={reviewTargets} /> : null}
      {succeededIds.length > 0 ? (
        <div className="flex items-center justify-between gap-2 rounded bg-mw-bg px-3 py-2 text-xs">
          <span>{succeededIds.length}개 옮김 — 실패분은 선택에 남겼습니다.</span>
          <button type="button" onClick={undo} disabled={pending} className={BAR_BUTTON}>
            {pending ? "복구 중…" : "되돌리기"}
          </button>
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={BAR_BUTTON}>닫기</button>
        <button type="button" onClick={apply} disabled={pending || ids.length === 0} className={DIALOG_PRIMARY}>
          {pending ? "옮기는 중…" : `${ids.length}개 휴지통으로`}
        </button>
      </div>
    </DialogShell>
  );
}

function NoteDialog({
  boardId,
  targets,
  onClose,
  onApplied,
  onNotice,
}: {
  boardId: string;
  targets: readonly BulkTargetRow[];
  onClose: () => void;
  onApplied: (succeededIds: string[]) => void;
  onNotice: (message: string) => void;
}) {
  const [kind, setKind] = useState<SelectableDetailEventKind>("memo");
  const [body, setBody] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkNoteResult | null>(null);
  const [reviewTargets] = useState(() => [...targets]);
  const [pending, startTransition] = useTransition();
  const ids = reviewTargets.filter((target) => !result?.results.some((entry) => entry.itemId === target.id && entry.ok)).map((target) => target.id);
  const noteRequests = useRef(new Map<string, Record<string, string>>());

  const apply = () => {
    const trimmed = body.trim();
    if (!trimmed) { setLocalError("메모 내용을 입력하세요."); return; }
    if (trimmed.length > 2000) { setLocalError("메모는 2000자 이내로 입력하세요."); return; }
    if (ids.length === 0) return;
    setLocalError(null);
    const payloadKey = JSON.stringify([kind, trimmed]);
    let requestIds = noteRequests.current.get(payloadKey);
    if (!requestIds) {
      requestIds = Object.fromEntries(reviewTargets.map((target) => [target.id, crypto.randomUUID()]));
      noteRequests.current.set(payloadKey, requestIds);
    }
    const submittedRequestIds = requestIds;
    startTransition(async () => {
      const next = await bulkAddNoteAction({ boardId, itemIds: ids, kind, body: trimmed, requestIds: submittedRequestIds });
      setResult((previous) => {
        const results = [...(previous?.results.filter((entry) => entry.ok) ?? []), ...next.results];
        const applied = results.filter((entry) => entry.ok).length;
        return { ok: applied === results.length, applied, failed: results.length - applied, results };
      });
      // 메모는 행을 바꾸지 않으므로 선택을 비우지 않는다 — 성공해도 입력·선택을 유지하고 닫지만 않는다.
      // 부분 실패는 그대로 두어 안전한 재시도(같은 requestIds)를 하게 한다.
      if (next.failed === 0) {
        onNotice(`${next.applied}개에 메모를 남겼습니다.`);
        onClose();
      } else {
        onApplied([]);
      }
    });
  };

  return (
    <DialogShell title="선택 항목 메모" onClose={onClose}>
      <p className="text-xs text-mw-sub">같은 메모를 보기 내 선택 항목마다 한 줄씩 남깁니다. 작성자는 로그인한 본인으로 기록됩니다.</p>
      <ReviewList targets={reviewTargets} />
      <label className="flex flex-col gap-1 text-xs font-medium">종류
        <select value={kind} onChange={(e) => setKind(e.target.value as SelectableDetailEventKind)} className={DIALOG_INPUT} aria-label="메모 종류">
          {SELECTABLE_DETAIL_EVENT_KINDS.map((entry) => (
            <option key={entry} value={entry}>{entry === "memo" ? "메모" : entry === "call" ? "통화" : entry === "admin" ? "행정" : "미팅"}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">내용 (2000자 이내)
        <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={3} className={DIALOG_INPUT} aria-label="메모 내용" placeholder="선택 항목에 함께 남길 메모" />
      </label>
      {localError ? <p role="alert" className="text-xs text-mw-error">{localError}</p> : null}
      {result ? <Failures result={result} targets={reviewTargets} /> : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={BAR_BUTTON}>취소</button>
        <button type="button" onClick={apply} disabled={pending || ids.length === 0} className={DIALOG_PRIMARY}>
          {pending ? "남기는 중…" : `${ids.length}개에 메모 남기기`}
        </button>
      </div>
    </DialogShell>
  );
}

export function BulkActionBar({
  boardId,
  workflowKind,
  totalSelected,
  targets,
  targetValues,
  canEdit,
  canMove,
  canDelete = false,
  statusColumn,
  fieldColumns,
  dateColumns,
  members,
  groups,
  exportCsv,
  exportFilename,
  dialog,
  notice,
  onOpenDialog,
  onCloseDialog,
  onClear,
  onApplied,
  onNotice,
}: {
  boardId: string;
  workflowKind: WorkflowProgressKind | null;
  /** 선택 집합 전체 개수 (보기 밖 포함). */
  totalSelected: number;
  /** 보기 내 대상 — 이 목록에만 적용한다. */
  targets: readonly BulkTargetRow[];
  targetValues: Record<string, Record<string, CellValue>>;
  canEdit: boolean;
  canMove: boolean;
  canDelete?: boolean;
  statusColumn: BulkStatusColumn | null;
  fieldColumns: BulkFieldColumn[];
  dateColumns: BulkDateColumn[];
  members: { id: string; label: string }[];
  groups: { id: string; name: string }[];
  /** 표시 라벨 기준 CSV 전문 (워크스페이스가 계산). */
  exportCsv: string;
  exportFilename: string;
  dialog: BulkDialogState | null;
  notice: string | null;
  onOpenDialog: (op: BulkOpKind, preset?: string) => void;
  onCloseDialog: () => void;
  onClear: () => void;
  onApplied: (succeededIds: string[]) => void;
  onNotice: (message: string) => void;
}) {
  void boardId;
  void workflowKind;
  const hiddenCount = Math.max(0, totalSelected - targets.length);
  const hasTargets = targets.length > 0;
  const showStatus = canEdit && statusColumn !== null && statusColumn.options.length > 0;
  const showAssignee = canEdit;
  const showDate = canEdit && dateColumns.length > 0;
  const showFields = canEdit && fieldColumns.length > 0;
  const showMove = canEdit && canMove && groups.length > 0;
  const showTrash = canDelete;
  const showNote = canEdit;

  const download = () => {
    const blob = new Blob(["\uFEFF" + exportCsv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = exportFilename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    onNotice(`${targets.length}개를 CSV로 내려받았습니다.`);
  };

  return (
    <>
      <section
        aria-label="선택 작업"
        className="flex flex-wrap items-center gap-2 rounded-lg border border-mw-line bg-mw-card px-3 py-2 text-sm shadow"
      >
        <strong>{totalSelected}개 선택</strong>
        <span className="text-xs text-mw-sub">
          보기 내 {targets.length}개 대상{hiddenCount > 0 ? ` · 숨겨진 ${hiddenCount}개 제외` : ""}
        </span>
        {showStatus ? <button type="button" data-bulk-op="status" disabled={!hasTargets} onClick={() => onOpenDialog("status")} className={BAR_BUTTON}>상태</button> : null}
        {showAssignee ? <button type="button" data-bulk-op="assignee" disabled={!hasTargets} onClick={() => onOpenDialog("assignee")} className={BAR_BUTTON}>담당자</button> : null}
        {showDate ? <button type="button" data-bulk-op="date" disabled={!hasTargets} onClick={() => onOpenDialog("date")} className={BAR_BUTTON}>일정</button> : null}
        {showFields ? <button type="button" data-bulk-op="fields" disabled={!hasTargets} onClick={() => onOpenDialog("fields")} className={BAR_BUTTON}>필드</button> : null}
        {showMove ? <button type="button" data-bulk-op="move" disabled={!hasTargets} onClick={() => onOpenDialog("move")} className={BAR_BUTTON}>이동</button> : null}
        {showNote ? <button type="button" data-bulk-op="note" disabled={!hasTargets} onClick={() => onOpenDialog("note")} className={BAR_BUTTON}>메모</button> : null}
        {showTrash ? <button type="button" data-bulk-op="trash" disabled={!hasTargets} onClick={() => onOpenDialog("trash")} className={BAR_BUTTON}>삭제</button> : null}
        {hasTargets ? <button type="button" data-bulk-op="export" onClick={download} className={BAR_BUTTON}>내보내기</button> : null}
        <button type="button" onClick={onClear} className={BAR_BUTTON}>선택 해제</button>
        {notice ? <span role="status" className="text-xs text-mw-body">{notice}</span> : null}
      </section>
      {dialog && (targets.length > 0 || dialog.op === "trash" || dialog.op === "note") ? (
        dialog.op === "status" && statusColumn ? (
          <StatusDialog
            key={`status:${dialog.preset ?? ""}`}
            boardId={boardId}
            workflowKind={workflowKind}
            statusColumn={statusColumn}
            targets={targets}
            preset={dialog.preset}
            onClose={onCloseDialog}
            onApplied={onApplied}
            onNotice={onNotice}
          />
        ) : dialog.op === "assignee" ? (
          <AssigneeDialog
            key="assignee"
            boardId={boardId}
            members={members}
            targets={targets}
            onClose={onCloseDialog}
            onApplied={onApplied}
            onNotice={onNotice}
          />
        ) : dialog.op === "date" && dateColumns.length > 0 ? (
          <DateDialog
            key="date"
            boardId={boardId}
            workflowKind={workflowKind}
            dateColumns={dateColumns}
            targets={targets}
            targetValues={targetValues}
            onClose={onCloseDialog}
            onApplied={onApplied}
            onNotice={onNotice}
          />
        ) : dialog.op === "fields" && fieldColumns.length > 0 ? (
          <FieldsDialog
            key={`fields:${dialog.fieldKey ?? ""}:${dialog.fieldValue ?? ""}`}
            boardId={boardId}
            workflowKind={workflowKind}
            fieldColumns={fieldColumns}
            members={members}
            targets={targets}
            targetValues={targetValues}
            initialColumnKey={dialog.fieldKey}
            initialValue={dialog.fieldValue}
            onClose={onCloseDialog}
            onApplied={onApplied}
            onNotice={onNotice}
          />
        ) : dialog.op === "move" && showMove ? (
          <MoveDialog
            key="move"
            boardId={boardId}
            groups={groups}
            targets={targets}
            onClose={onCloseDialog}
            onApplied={onApplied}
            onNotice={onNotice}
          />
        ) : dialog.op === "trash" && showTrash ? (
          <TrashDialog
            key="trash"
            boardId={boardId}
            targets={targets}
            onClose={onCloseDialog}
            onApplied={onApplied}
            onNotice={onNotice}
          />
        ) : dialog.op === "note" && showNote ? (
          <NoteDialog
            key="note"
            boardId={boardId}
            targets={targets}
            onClose={onCloseDialog}
            onApplied={onApplied}
            onNotice={onNotice}
          />
        ) : null
      ) : null}
    </>
  );
}
