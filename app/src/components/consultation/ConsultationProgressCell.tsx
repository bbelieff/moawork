"use client";

/**
 * 상담 진행 칸 — 단계 요약 + 동일 업체 상세의 상담 영역을 여는 진입점.
 *
 * 2026-10-19(belie «비대면↔대면, 계약업체 실무로 넘기기가 안 보인다») — 비대면/대면 상담 보기에서는
 *   `editable` 로 그 자리 단계 고르기가 된다. 일시가 필요한 단계(상담예정·재상담·미팅대기·변경)와
 *   비대면↔대면 이동은 칸 안에서 일시를 받는다. 계약업체 실무로 넘기기는 조건(계약금·직인)을 보여야 해서
 *   상세의 상담 영역을 연다.
 */

import { useId, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestItemDetailOpen } from "@/lib/boards/item-detail-open";
import { mutateConsultationWorkflow } from "@/lib/consultation/actions";
import {
  INPERSON_PHASES,
  REMOTE_PHASES,
  consultationPhase,
  phaseLabel,
  phaseLabelFor,
  phaseNeedsSchedule,
  type ConsultationPhase,
} from "@/lib/consultation/phases";
import {
  CONTRACT_STEP_GROUPS,
  contractStepGroupKey,
  type ConsultationBoardEntry,
} from "@/lib/consultation/boardView";

type Mode = "remote" | "inperson";
/** 일시를 받아야 저장되는 고르기 — 단계 자체 또는 비대면↔대면 이동. */
type ScheduleIntent = Readonly<{ mode: Mode; phase: ConsultationPhase; label: string }>;

export const TO_INPERSON = "__to_inperson";
export const TO_REMOTE = "__to_remote";
export const TO_WORK = "__to_work";

/** datetime-local 값(브라우저 시간대) — 기존 일시가 있으면 그것, 없으면 내일 오전 10시. */
function localInputValue(iso: string | null): string {
  const base = iso ? new Date(iso) : (() => {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    next.setHours(10, 0, 0, 0);
    return next;
  })();
  if (Number.isNaN(base.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}T${pad(base.getHours())}:${pad(base.getMinutes())}`;
}

function shortWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function newRequestId(): string {
  return crypto.randomUUID();
}

export function ConsultationProgressCell({
  itemId,
  title,
  entry,
  meetingAt,
  assigneeId,
  editable = false,
}: Readonly<{
  itemId: string;
  title: string;
  /** 단계 보기 적재분. 없으면(적재 실패 등) 읽기 전용 요약 없이 안내만 둔다. */
  entry?: ConsultationBoardEntry | null;
  meetingAt?: string | null;
  assigneeId?: string | null;
  members?: ReadonlyArray<{ id: string; label: string }>;
  companyName?: string;
  /** 비대면/대면 상담 보기에서 그 자리 단계 고르기. */
  editable?: boolean;
}>) {
  const descriptionId = useId();
  const phase = entry ? consultationPhase(entry) : null;
  // ★ 167: 계약 진행은 «1단계 · 계약금 입금 확인 → 2단계 · 직인 → 계약 확인 완료» 중 현재 자리를 보여준다.
  const contractStep = entry && phase === "contract"
    ? CONTRACT_STEP_GROUPS.find((group) => group.key === contractStepGroupKey(entry))!
    : null;

  if (editable && entry && phase) {
    return (
      <ConsultationStagePicker
        itemId={itemId}
        title={title}
        entry={entry}
        phase={phase}
        contractStepTitle={contractStep?.title ?? null}
        meetingAt={entry.meetingAt ?? meetingAt ?? null}
        assigneeId={assigneeId ?? null}
      />
    );
  }

  return (
    <div className="flex min-w-44 items-center gap-1.5">
      <p className="min-w-0 flex-1 truncate text-xs font-semibold text-mw-fg" aria-describedby={descriptionId}>
        {entry && phase !== "contract" ? (
          <>{phaseLabel(phase!, entry.absentFromPhase)}{entry.meetingAt ? <span className="ml-1 font-normal text-mw-sub">{new Date(entry.meetingAt).toLocaleString("ko-KR")}</span> : null}</>
        ) : entry ? (
          <>{contractStep!.title}</>
        ) : (
          <span className="font-normal text-mw-sub">상담 기록 없음</span>
        )}
      </p>
      <span id={descriptionId} className="sr-only">
        계약금 입금 확인 → 직인
      </span>
      <OpenDetailButton itemId={itemId} title={title} />
    </div>
  );
}

function OpenDetailButton({ itemId, title }: Readonly<{ itemId: string; title: string }>) {
  return (
    <button
      type="button"
      onClick={(event) => requestItemDetailOpen(itemId, event.currentTarget)}
      aria-label={`${title} 상담 확인 열기`}
      data-no-drag
      // 2026-10-19 — 한 줄 행: 단계 글자 옆 작은 알약.
      className="inline-flex h-6 shrink-0 items-center rounded-full border border-mw-line bg-mw-card px-2 text-[0.68rem] font-semibold text-mw-body hover:border-mw-record hover:text-mw-record"
    >
      확인 열기
    </button>
  );
}

function ConsultationStagePicker({
  itemId,
  title,
  entry,
  phase,
  contractStepTitle,
  meetingAt,
  assigneeId,
}: Readonly<{
  itemId: string;
  title: string;
  entry: ConsultationBoardEntry;
  phase: ConsultationPhase;
  contractStepTitle: string | null;
  meetingAt: string | null;
  assigneeId: string | null;
}>) {
  const router = useRouter();
  const mode: Mode = entry.mode === "inperson" ? "inperson" : "remote";
  const [shownPhase, setShownPhase] = useOptimistic(phase);
  const [pending, startTransition] = useTransition();
  const [schedule, setSchedule] = useState<ScheduleIntent | null>(null);
  const [when, setWhen] = useState("");
  const [error, setError] = useState("");

  const phases = mode === "inperson" ? INPERSON_PHASES : REMOTE_PHASES;
  const labelOf = (value: ConsultationPhase) => {
    if (value === phase && value === "absent") return phaseLabel("absent", entry.absentFromPhase);
    if (value === "contract" && value === phase && mode === "remote" && contractStepTitle) return `계약 진행 · ${contractStepTitle}`;
    return phaseLabelFor(value, mode);
  };

  function save(next: Readonly<{ mode: Mode; phase: ConsultationPhase; meetingAt: string | null }>) {
    // 일시가 실리면 RPC 가 담당자(=행 담당자)를 요구한다 — 보내기 전에 같은 말로 막는다.
    if (next.meetingAt && !assigneeId) {
      setError("담당자를 먼저 정해 주세요");
      return;
    }
    setError("");
    startTransition(async () => {
      if (next.mode === mode) setShownPhase(next.phase);
      const form = new FormData();
      form.set("itemId", itemId);
      form.set("requestId", newRequestId());
      form.set("expectedVersion", String(entry.version));
      form.set("mode", next.mode);
      form.set("phase", next.phase);
      form.set("meetingAt", next.meetingAt ?? "");
      form.set("assigneeId", assigneeId ?? "");
      form.set("cancel", "false");
      try {
        const result = await mutateConsultationWorkflow({ ok: false, message: "" }, form);
        if (result.field === "unknown_result") setError("저장 결과를 확인하지 못했어요. 새로고침해 주세요");
        else if (!result.ok) setError(result.message || "단계를 저장하지 못했어요");
        else setSchedule(null);
      } catch {
        setError("저장 결과를 확인하지 못했어요. 새로고침해 주세요");
      }
      router.refresh();
    });
  }

  function choose(value: string) {
    if (value === TO_WORK) {
      requestItemDetailOpen(itemId);
      return;
    }
    const picked = value as ConsultationPhase;
    const intent: ScheduleIntent | null =
      value === TO_INPERSON ? { mode: "inperson", phase: "meeting_scheduled", label: "대면 미팅 일시" }
      : value === TO_REMOTE ? { mode: "remote", phase: "contract", label: "비대면 계약 확인 일시" }
      : phaseNeedsSchedule(picked) ? { mode, phase: picked, label: `${phaseLabelFor(picked, mode)} 일시` }
      : null;
    if (intent) {
      setError("");
      setWhen(localInputValue(meetingAt));
      setSchedule(intent);
      return;
    }
    save({ mode, phase: picked, meetingAt });
  }

  if (schedule) {
    return (
      <form
        className="flex min-w-44 items-center gap-1"
        data-no-drag
        onSubmit={(event) => {
          event.preventDefault();
          const date = new Date(when);
          if (!when || Number.isNaN(date.getTime())) {
            setError("일시를 골라 주세요");
            return;
          }
          save({ mode: schedule.mode, phase: schedule.phase, meetingAt: date.toISOString() });
        }}
      >
        <input
          type="datetime-local"
          aria-label={`${title} ${schedule.label}`}
          value={when}
          onChange={(event) => setWhen(event.target.value)}
          disabled={pending}
          required
          autoFocus
          className="h-6 min-w-0 flex-1 rounded-md border border-mw-line bg-mw-card px-1 text-[0.7rem]"
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-6 shrink-0 items-center rounded-full bg-mw-record px-2 text-[0.68rem] font-semibold text-white disabled:opacity-60"
        >
          {pending ? "저장 중" : "저장"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => { setSchedule(null); setError(""); }}
          className="inline-flex h-6 shrink-0 items-center rounded-full border border-mw-line px-2 text-[0.68rem] text-mw-body"
        >
          취소
        </button>
        {error ? <span role="alert" title={error} className="max-w-24 truncate text-[0.68rem] text-mw-error">{error}</span> : null}
      </form>
    );
  }

  return (
    <div className="flex min-w-44 items-center gap-1.5" data-no-drag>
      <select
        aria-label={`${title} 상담 단계`}
        value={shownPhase}
        disabled={pending}
        onChange={(event) => choose(event.target.value)}
        className="h-6 min-w-0 max-w-[11rem] shrink truncate rounded-full border border-mw-line bg-mw-card pl-2 pr-6 text-xs font-semibold text-mw-fg disabled:opacity-60"
      >
        <optgroup label={mode === "inperson" ? "대면 상담 단계" : "비대면 상담 단계"}>
          {phases.map((value) => <option key={value} value={value}>{labelOf(value)}</option>)}
        </optgroup>
        <optgroup label="넘기기">
          {mode === "remote"
            ? <option value={TO_INPERSON}>대면 상담으로 넘기기…</option>
            : <option value={TO_REMOTE}>비대면 상담으로 돌리기…</option>}
          {phase === "contract" ? <option value={TO_WORK}>계약업체 실무로 넘기기…</option> : null}
        </optgroup>
      </select>
      {error ? (
        <span role="alert" title={error} className="min-w-0 flex-1 truncate text-[0.68rem] text-mw-error">{error}</span>
      ) : meetingAt ? (
        <span className="min-w-0 flex-1 truncate text-[0.7rem] text-mw-sub">{shortWhen(meetingAt)}</span>
      ) : <span className="flex-1" />}
      <OpenDetailButton itemId={itemId} title={title} />
    </div>
  );
}
