"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  authorizeCompaniesCsvExport,
  bulkReassignDealsAction,
  bulkStartWorkAction,
  bulkUpdateCompaniesAction,
  bulkUpdateDealsAction,
  type CompaniesBulkApplyResult,
} from "@/app/(app)/(tabs)/companies/bulk-actions";
import {
  COMPANY_BULK_EDITABLE_FIELDS,
  DEAL_BULK_EDITABLE_FIELDS,
  describeCompaniesBulkTargets,
  splitCompaniesBulkIds,
} from "@/lib/companies/bulk";
import { noticeLive, noticeRole, type ResultNotice } from "@/lib/ui/result-notice";

export type CompaniesBulkOp = "company-fields" | "deal-fields" | "assignee" | "work-start";

export interface CompaniesBulkTarget {
  bulkId: string;
  kind: "company" | "deal";
  id: string;
  title: string;
}

const BAR_BUTTON =
  "rounded border border-mw-line bg-mw-card px-2.5 py-1 text-xs font-medium text-mw-body hover:bg-mw-bg disabled:opacity-50";
const DIALOG_INPUT = "w-full rounded border border-mw-line bg-mw-card px-2 py-1.5 text-sm text-mw-fg";
const DIALOG_PRIMARY =
  "rounded bg-mw-primary px-4 py-1.5 text-sm font-semibold text-mw-on-accent disabled:opacity-50";

// Keep pending/uncertain targets protected when a dialog is closed and reopened.
// A full reload reads the server state before allowing another mutation.
const bulkMutationStates = new Map<string, { pending: boolean; error: string | null }>();
const bulkMutationListeners = new Set<() => void>();
function notifyBulkMutationState() {
  for (const listener of bulkMutationListeners) listener();
}

function useBulkMutation(targets: readonly CompaniesBulkTarget[]) {
  const [, render] = useState(0);
  const [transitionPending, startTransition] = useTransition();
  useEffect(() => {
    const listener = () => render((value) => value + 1);
    bulkMutationListeners.add(listener);
    return () => { bulkMutationListeners.delete(listener); };
  }, []);
  const states = targets.map((target) => bulkMutationStates.get(target.bulkId));
  const error = states.find((state) => state?.error)?.error ?? null;
  const pending = transitionPending || states.some((state) => state?.pending);
  const run = (action: () => Promise<void>) => {
    const keys = targets.map((target) => target.bulkId);
    if (keys.some((key) => bulkMutationStates.has(key))) return;
    for (const key of keys) bulkMutationStates.set(key, { pending: true, error: null });
    notifyBulkMutationState();
    startTransition(async () => {
      try {
        await action();
        for (const key of keys) bulkMutationStates.delete(key);
      } catch (cause) {
        const reason = cause instanceof Error && cause.message ? ` (${cause.message})` : "";
        const message = `서버 응답을 확인하지 못했습니다${reason}. 일부 또는 전부 적용됐을 수 있습니다. 입력은 유지됩니다. 새로고침하여 실제 결과를 확인한 뒤 다시 작업해 주세요.`;
        for (const key of keys) bulkMutationStates.set(key, { pending: false, error: message });
      } finally {
        notifyBulkMutationState();
      }
    });
  };
  return { pending, transportError: error, run };
}

function TransportFailure({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded border border-mw-error/40 px-3 py-2 text-xs text-mw-error">
      <p>{message}</p>
      <button type="button" className="mt-2 underline" onClick={() => window.location.reload()}>새로고침하여 확인</button>
    </div>
  );
}

function titleOf(targets: readonly { bulkId: string; id: string; title: string }[], itemId: string): string {
  return targets.find((row) => row.id === itemId || row.bulkId === itemId)?.title ?? itemId;
}

function Failures({
  result,
  targets,
}: {
  result: CompaniesBulkApplyResult;
  targets: readonly { bulkId: string; id: string; title: string }[];
}) {
  const failures = result.results.filter((entry) => !entry.ok);
  if (failures.length === 0) return null;
  return (
    <div role="alert" className="rounded border border-mw-error/40 bg-mw-card px-3 py-2 text-xs text-mw-error">
      <p className="font-semibold">저장하지 못한 {failures.length}개 — 입력은 그대로 두었습니다.</p>
      <ul className="mt-1 max-h-32 list-disc overflow-y-auto pl-4">
        {failures.map((entry) => (
          <li key={entry.itemId}>
            {titleOf(targets, entry.itemId)} — {entry.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReviewList({ targets, kindLabel }: { targets: readonly CompaniesBulkTarget[]; kindLabel: string }) {
  return (
    <div className="rounded bg-mw-bg px-3 py-2 text-xs text-mw-body">
      <p className="font-semibold">
        {kindLabel} {targets.length}개에 적용합니다
      </p>
      <ul className="mt-1 max-h-32 overflow-y-auto">
        {targets.map((row) => (
          <li key={row.bulkId} className="truncate">
            · {row.title}
          </li>
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
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prev = document.activeElement as HTMLElement | null;
    try {
      if (!el.open) el.showModal();
    } catch {
      /* jsdom */
    }
    try {
      const target = el.querySelector<HTMLElement>("select, input, button:not([aria-label='닫기'])") ?? el;
      target.focus({ preventScroll: true });
    } catch {
      /* 무시 */
    }
    const onCancel = (event: Event) => {
      event.preventDefault();
      onCloseRef.current();
    };
    el.addEventListener("cancel", onCancel);
    return () => {
      el.removeEventListener("cancel", onCancel);
      try {
        if (el.open) el.close();
      } catch {
        /* 무시 */
      }
      try {
        prev?.focus?.();
      } catch {
        /* 무시 */
      }
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 m-auto max-h-[calc(100vh-2rem)] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto whitespace-normal rounded-md border border-mw-line bg-mw-card p-0 text-mw-fg shadow-lg backdrop:bg-slate-950/50"
    >
      <div className="flex items-start justify-between gap-4 border-b border-mw-line px-5 py-4">
        <h2 className="text-base font-bold tracking-tight">{title}</h2>
        <button
          type="button"
          aria-label="닫기"
          onClick={onClose}
          className="h-8 w-8 rounded-full border border-mw-line text-mw-sub hover:bg-mw-bg"
        >
          ×
        </button>
      </div>
      <div className="flex flex-col gap-3 px-5 py-4">{children}</div>
    </dialog>
  );
}

function CompanyFieldsDialog({
  targets,
  onClose,
  onApplied,
  onNotice,
}: {
  targets: readonly CompaniesBulkTarget[];
  onClose: () => void;
  onApplied: (succeededBulkIds: string[]) => void;
  onNotice: (message: string, ok?: boolean) => void;
}) {
  const [field, setField] = useState<string>(COMPANY_BULK_EDITABLE_FIELDS[0]?.key ?? "");
  const [value, setValue] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [result, setResult] = useState<CompaniesBulkApplyResult | null>(null);
  const { pending, transportError, run } = useBulkMutation(targets);
  const ids = useMemo(() => targets.map((row) => row.id), [targets]);
  const bulkIds = useMemo(() => targets.map((row) => row.bulkId), [targets]);

  const apply = () => {
    if (!field) {
      setLocalError("필드를 선택하세요.");
      return;
    }
    if (ids.length === 0) {
      setLocalError("대상이 없습니다.");
      return;
    }
    setLocalError(null);
    run(async () => {
      const next = await bulkUpdateCompaniesAction({ companyIds: ids, field, value });
      setResult(next);
      const succeededRaw = new Set(next.results.filter((entry) => entry.ok).map((entry) => entry.itemId));
      onApplied(bulkIds.filter((bulkId, index) => succeededRaw.has(ids[index] as string)));
      if (next.failed === 0) {
        onNotice(`${next.applied}개 회사 정보를 변경했습니다.`);
        onClose();
      }
    });
  };

  return (
    <DialogShell title="회사 일괄 수정" onClose={onClose}>
      <p className="text-xs text-mw-sub">
        회사 일반 필드만 바꿉니다. 집계(상태·금액·담당)는 접은 값이라 직접 고칠 수 없습니다.
      </p>
      <ReviewList targets={targets} kindLabel="회사" />
      <label className="flex flex-col gap-1 text-xs font-medium">
        필드
        <select value={field} onChange={(e) => setField(e.target.value)} className={DIALOG_INPUT} aria-label="일괄 적용할 회사 필드">
          {COMPANY_BULK_EDITABLE_FIELDS.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">
        값
        <input value={value} onChange={(e) => setValue(e.target.value)} className={DIALOG_INPUT} aria-label="일괄 적용할 값" placeholder="적용할 값 입력" />
      </label>
      {localError ? (
        <p role="alert" className="text-xs text-mw-error">
          {localError}
        </p>
      ) : null}
      <TransportFailure message={transportError} />
      {result && !transportError ? <Failures result={result} targets={targets} /> : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={BAR_BUTTON}>
          취소
        </button>
        <button type="button" onClick={apply} disabled={pending || Boolean(transportError)} className={DIALOG_PRIMARY}>
          {pending ? "적용 중…" : `${targets.length}개 회사 적용`}
        </button>
      </div>
    </DialogShell>
  );
}

function DealFieldsDialog({
  targets,
  onClose,
  onApplied,
  onNotice,
}: {
  targets: readonly CompaniesBulkTarget[];
  onClose: () => void;
  onApplied: (succeededBulkIds: string[]) => void;
  onNotice: (message: string, ok?: boolean) => void;
}) {
  const [field, setField] = useState<string>(DEAL_BULK_EDITABLE_FIELDS[0]?.key ?? "");
  const [value, setValue] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [result, setResult] = useState<CompaniesBulkApplyResult | null>(null);
  const { pending, transportError, run } = useBulkMutation(targets);
  const ids = useMemo(() => targets.map((row) => row.id), [targets]);
  const bulkIds = useMemo(() => targets.map((row) => row.bulkId), [targets]);

  const apply = () => {
    if (!field) {
      setLocalError("필드를 선택하세요.");
      return;
    }
    if (ids.length === 0) {
      setLocalError("대상이 없습니다.");
      return;
    }
    setLocalError(null);
    run(async () => {
      const next = await bulkUpdateDealsAction({ dealIds: ids, field, value });
      setResult(next);
      const succeededRaw = new Set(next.results.filter((entry) => entry.ok).map((entry) => entry.itemId));
      onApplied(bulkIds.filter((bulkId, index) => succeededRaw.has(ids[index] as string)));
      if (next.failed === 0) {
        onNotice(`${next.applied}개 자금 건 정보를 변경했습니다.`);
        onClose();
      }
    });
  };

  return (
    <DialogShell title="자금 건 일괄 수정" onClose={onClose}>
      <p className="text-xs text-mw-sub">자금 건 일반 필드만 바꿉니다. 단계 변경은 낱개 이동 흐름에서만 가능합니다.</p>
      <ReviewList targets={targets} kindLabel="자금 건" />
      <label className="flex flex-col gap-1 text-xs font-medium">
        필드
        <select value={field} onChange={(e) => setField(e.target.value)} className={DIALOG_INPUT} aria-label="일괄 적용할 자금 건 필드">
          {DEAL_BULK_EDITABLE_FIELDS.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">
        값
        <input value={value} onChange={(e) => setValue(e.target.value)} className={DIALOG_INPUT} aria-label="일괄 적용할 값" placeholder="적용할 값 입력" />
      </label>
      {localError ? (
        <p role="alert" className="text-xs text-mw-error">
          {localError}
        </p>
      ) : null}
      <TransportFailure message={transportError} />
      {result && !transportError ? <Failures result={result} targets={targets} /> : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={BAR_BUTTON}>
          취소
        </button>
        <button type="button" onClick={apply} disabled={pending || Boolean(transportError)} className={DIALOG_PRIMARY}>
          {pending ? "적용 중…" : `${targets.length}개 자금 건 적용`}
        </button>
      </div>
    </DialogShell>
  );
}

function AssigneeDialog({
  targets,
  members,
  membersError = null,
  onRetryMembers,
  onClose,
  onApplied,
  onNotice,
}: {
  targets: readonly CompaniesBulkTarget[];
  members: readonly { id: string; label: string }[];
  /** 담당 목록 조회 장애 — 빈 목록과 구분한다. 있으면 담당 변경만 차단한다. */
  membersError?: string | null;
  onRetryMembers?: () => void;
  onClose: () => void;
  onApplied: (succeededBulkIds: string[]) => void;
  onNotice: (message: string, ok?: boolean) => void;
}) {
  const [assigneeId, setAssigneeId] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [result, setResult] = useState<CompaniesBulkApplyResult | null>(null);
  const { pending, transportError, run } = useBulkMutation(targets);
  const ids = useMemo(() => targets.map((row) => row.id), [targets]);
  const bulkIds = useMemo(() => targets.map((row) => row.bulkId), [targets]);
  // 기술 ID 직접 입력은 받지 않는다 — 정상 로드된 회사 멤버 선택만 허용한다.

  const apply = () => {
    if (membersError) return;
    if (!assigneeId) {
      setLocalError("담당자를 선택하세요.");
      return;
    }
    setLocalError(null);
    run(async () => {
      const next = await bulkReassignDealsAction({
        dealIds: ids,
        assigneeId: assigneeId === "__unassigned__" ? null : assigneeId,
      });
      setResult(next);
      const succeededRaw = new Set(next.results.filter((entry) => entry.ok).map((entry) => entry.itemId));
      onApplied(bulkIds.filter((bulkId, index) => succeededRaw.has(ids[index] as string)));
      if (next.failed === 0) {
        onNotice(`${next.applied}개 자금 건 담당자를 변경했습니다.`);
        onClose();
      }
    });
  };

  return (
    <DialogShell title="자금 건 담당 일괄 변경" onClose={onClose}>
      <p className="text-xs text-mw-sub">담당 흐름(lineage)을 그대로 씁니다. 회사 집계 담당은 직접 고치지 않습니다.</p>
      <ReviewList targets={targets} kindLabel="자금 건" />
      {membersError ? (
        <div role="alert" className="rounded border border-mw-error/40 bg-mw-card px-3 py-2 text-xs text-mw-error">
          <p className="font-semibold">{membersError}</p>
          <p className="mt-1 text-mw-body">담당 변경만 할 수 없습니다. 다른 작업은 그대로 할 수 있습니다.</p>
          <button
            type="button"
            onClick={onRetryMembers ?? (() => window.location.reload())}
            className={`${BAR_BUTTON} mt-2`}
          >
            다시 시도
          </button>
        </div>
      ) : (
        <label className="flex flex-col gap-1 text-xs font-medium">
          담당자
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={DIALOG_INPUT} aria-label="일괄 적용할 담당자">
            <option value="">선택하세요</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.label}
              </option>
            ))}
            <option value="__unassigned__">미배정</option>
          </select>
        </label>
      )}
      {!membersError && members.length === 0 ? (
        <p role="status" className="text-xs text-mw-sub">
          선택할 수 있는 회사 멤버가 없습니다. 담당 변경은 할 수 없고, 다른 작업은 그대로 할 수 있습니다.
        </p>
      ) : null}
      {localError ? (
        <p role="alert" className="text-xs text-mw-error">
          {localError}
        </p>
      ) : null}
      <TransportFailure message={transportError} />
      {result && !transportError ? <Failures result={result} targets={targets} /> : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={BAR_BUTTON}>
          취소
        </button>
        <button
          type="button"
          onClick={apply}
          disabled={pending || Boolean(transportError) || Boolean(membersError) || (!assigneeId && members.length === 0)}
          className={DIALOG_PRIMARY}
        >
          {pending ? "적용 중…" : `${targets.length}개 담당자 적용`}
        </button>
      </div>
    </DialogShell>
  );
}

function WorkStartDialog({
  targets,
  onClose,
  onApplied,
  onNotice,
}: {
  targets: readonly CompaniesBulkTarget[];
  onClose: () => void;
  onApplied: (succeededBulkIds: string[]) => void;
  onNotice: (message: string, ok?: boolean) => void;
}) {
  const [result, setResult] = useState<CompaniesBulkApplyResult | null>(null);
  const { pending, transportError, run } = useBulkMutation(targets);
  const ids = useMemo(() => targets.map((row) => row.id), [targets]);
  const bulkIds = useMemo(() => targets.map((row) => row.bulkId), [targets]);

  const apply = () => {
    if (ids.length === 0) return;
    run(async () => {
      const next = await bulkStartWorkAction({ companyIds: ids });
      setResult(next);
      const succeededRaw = new Set(next.results.filter((entry) => entry.ok).map((entry) => entry.itemId));
      onApplied(bulkIds.filter((bulkId, index) => succeededRaw.has(ids[index] as string)));
      if (next.failed === 0) {
        onNotice(`${next.applied}개 회사 업무를 시작했습니다.`);
        onClose();
      }
    });
  };

  return (
    <DialogShell title="선택 회사 업무 시작" onClose={onClose}>
      <p className="text-xs text-mw-sub">회사마다 명시적 업무 시작 1건을 만든다. 이미 진행 중인 건은 그대로 둔다.</p>
      <ReviewList targets={targets} kindLabel="회사" />
      <TransportFailure message={transportError} />
      {result && !transportError ? <Failures result={result} targets={targets} /> : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={BAR_BUTTON}>
          취소
        </button>
        <button type="button" onClick={apply} disabled={pending || Boolean(transportError)} className={DIALOG_PRIMARY}>
          {pending ? "시작 중…" : `${targets.length}개 업무 시작`}
        </button>
      </div>
    </DialogShell>
  );
}

export function CompaniesBulkBar({
  totalSelected,
  targets,
  members,
  membersError = null,
  onRetryMembers,
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
  totalSelected: number;
  targets: readonly CompaniesBulkTarget[];
  members: readonly { id: string; label: string }[];
  /** 담당 목록 조회 장애 — 빈 목록과 구분한다. 있으면 담당 변경만 차단한다. */
  membersError?: string | null;
  onRetryMembers?: () => void;
  exportCsv: string;
  exportFilename: string;
  dialog: CompaniesBulkOp | null;
  notice: ResultNotice | null;
  onOpenDialog: (op: CompaniesBulkOp) => void;
  onCloseDialog: () => void;
  onClear: () => void;
  onApplied: (succeededBulkIds: string[]) => void;
  onNotice: (message: string, ok?: boolean) => void;
}) {
  const { companyIds, dealIds } = useMemo(
    () => splitCompaniesBulkIds(targets.map((row) => row.bulkId)),
    [targets],
  );
  const described = describeCompaniesBulkTargets(targets.map((row) => row.bulkId));
  const hiddenCount = Math.max(0, totalSelected - targets.length);
  const hasTargets = targets.length > 0;
  const companyTargets = useMemo(() => targets.filter((row) => row.kind === "company"), [targets]);
  const dealTargets = useMemo(() => targets.filter((row) => row.kind === "deal"), [targets]);
  const [exportPending, startExport] = useTransition();

  const download = () => {
    if (!hasTargets || exportPending) return;
    startExport(async () => {
      try {
        const authorization = await authorizeCompaniesCsvExport();
        if (!authorization.ok) {
          onNotice(authorization.message, false);
          return;
        }
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
      } catch {
        onNotice("파일을 내려받지 못했어요. 다시 시도해 주세요.", false);
      }
    });
  };

  return (
    <>
      <section
        aria-label="선택 작업"
        className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"
      >
        <strong>
          {described.label} 선택
        </strong>
        <span className="text-xs text-zinc-500">
          보기 내 {targets.length}개 대상{hiddenCount > 0 ? ` · 접힘·숨김 ${hiddenCount}개 제외` : ""}
        </span>
        {companyIds.length > 0 ? (
          <button type="button" disabled={!hasTargets} onClick={() => onOpenDialog("company-fields")} className={BAR_BUTTON}>
            회사 필드
          </button>
        ) : null}
        {dealIds.length > 0 ? (
          <button type="button" disabled={!hasTargets} onClick={() => onOpenDialog("deal-fields")} className={BAR_BUTTON}>
            자금 필드
          </button>
        ) : null}
        {dealIds.length > 0 ? (
          <button type="button" disabled={!hasTargets} onClick={() => onOpenDialog("assignee")} className={BAR_BUTTON}>
            담당 변경
          </button>
        ) : null}
        {companyIds.length > 0 ? (
          <button type="button" disabled={!hasTargets} onClick={() => onOpenDialog("work-start")} className={BAR_BUTTON}>
            업무 시작
          </button>
        ) : null}
        {hasTargets ? (
          <button type="button" disabled={exportPending} onClick={download} className={BAR_BUTTON}>
            {exportPending ? "내보내기 준비 중…" : "내보내기"}
          </button>
        ) : null}
        <button type="button" onClick={onClear} className={BAR_BUTTON}>
          선택 해제
        </button>
        {notice ? (
          <span role={noticeRole(notice.ok)} aria-live={noticeLive(notice.ok)} className={`text-xs ${notice.ok ? "text-zinc-600" : "text-rose-600"}`}>
            {notice.message}
          </span>
        ) : null}
      </section>
      {dialog === "company-fields" && companyTargets.length > 0 ? (
        <CompanyFieldsDialog targets={companyTargets} onClose={onCloseDialog} onApplied={onApplied} onNotice={onNotice} />
      ) : null}
      {dialog === "deal-fields" && dealTargets.length > 0 ? (
        <DealFieldsDialog targets={dealTargets} onClose={onCloseDialog} onApplied={onApplied} onNotice={onNotice} />
      ) : null}
      {dialog === "assignee" && dealTargets.length > 0 ? (
        <AssigneeDialog
          targets={dealTargets}
          members={members}
          membersError={membersError}
          onRetryMembers={onRetryMembers}
          onClose={onCloseDialog}
          onApplied={onApplied}
          onNotice={onNotice}
        />
      ) : null}
      {dialog === "work-start" && companyTargets.length > 0 ? (
        <WorkStartDialog targets={companyTargets} onClose={onCloseDialog} onApplied={onApplied} onNotice={onNotice} />
      ) : null}
    </>
  );
}
