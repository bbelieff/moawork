"use client";

/**
 * 상담 확인 패널 — 리드컨택 행의 비대면/대면 보기 + 4단계 수동 확인 + 실무 인계.
 *
 * 재사용 지점: ① 업무이동 대화상자(기존 ContactPipelineAction 옆, 호환 유지),
 * ② 표의 상담 진행 셀 팝오버(그 자리 확인), ③ 행 상세(ItemDetailPanel) 인라인.
 * 업무이동 메뉴를 찾아야만 닿는 구조가 아니라 세 자리 어디서든 같은 패널이 뜬다.
 *
 * 조회·확인·예약·보기전이·인계는 모두 `lib/consultation/actions` 서버 액션
 * (151 RPC `execute_consultation_transition` / `read_consultation_snapshot` /
 * 정식 `contact_to_work` 파이프라인)으로만 수행한다. EAV·체크박스 거울 쓰기 없음.
 *
 * 저장 뒤에는 반환된 버전 기준으로 스냅샷을 바로 다시 읽어 화면에 입힌다 —
 * «최신 상태 다시 읽기» 같은 추가 버튼을 누르게 하지 않는다(클릭 최소화).
 * CAS 실패(다른 담당자가 먼저 저장)는 오류 + 새 기준 스냅샷으로 돌려주고,
 * 예약 일시·담당자 초안은 그대로 둬서 다시 누르면 새 기준으로 재시도된다.
 * 응답이 유실되면 원래 요청 ID·제출값으로만 다시 확인하고 새 작업은 잠근다.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ResultBanner } from "@/lib/ui/ResultBanner";
import { consultationPhase, CONSULTATION_PHASE_LABEL, REMOTE_PHASES, INPERSON_PHASES, phaseNeedsSchedule, type ConsultationPhase } from "@/lib/consultation/phases";
import {
  mutateConsultationChecklist,
  mutateConsultationHandoff,
  mutateConsultationMode,
  mutateConsultationWorkflow,
  readConsultationHandoff,
  readConsultationSnapshot,
  type ConsultationActionState,
} from "@/lib/consultation/actions";
import type { ConsultationSnapshot } from "@/lib/consultation/store";
import {
  CHECKLIST_DIRECTION,
  CHECKLIST_LABEL,
  CHECKLIST_STEPS,
  type ChecklistStep,
} from "@/lib/consultation/checklist";

const CHECK_INITIAL: ConsultationActionState = { ok: false, message: "" };
const READ_ERROR = "상담 기록을 불러오지 못했습니다. 잠시 후 다시 읽어 주세요.";
const UNKNOWN_RESULT = "응답을 받지 못해 저장 여부를 확인할 수 없습니다. 입력은 유지했습니다. 같은 요청을 다시 확인해 주세요.";

type Submission = Readonly<{
  kind: "check" | "mode" | "handoff" | "workflow";
  step?: ChecklistStep;
  fields: Readonly<Record<string, string>>;
  success: string;
  failure: string;
}>;

function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `req-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(36)}`;
  }
}

function toDateTimeLocal(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formOf(entries: Readonly<Record<string, string>>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) form.set(key, value);
  return form;
}

export function ConsultationPanel({
  itemId,
  title,
  initialMeetingAt = null,
  currentAssigneeId = null,
  members = [],
  initialCompanyName = "",
}: Readonly<{
  itemId: string;
  title: string;
  initialMeetingAt?: string | null;
  currentAssigneeId?: string | null;
  members?: ReadonlyArray<{ id: string; label: string }>;
  initialCompanyName?: string;
}>) {
  const router = useRouter();
  const [phaseDraft, setPhaseDraft] = useState<ConsultationPhase>("information");
  const [snapshot, setSnapshot] = useState<ConsultationSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [handoffInfo, setHandoffInfo] = useState<{ ready: boolean; missing: readonly string[]; message: string } | null>(null);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingStep, setPendingStep] = useState<ChecklistStep | null>(null);
  const [modePending, setModePending] = useState(false);
  const [handoffPending, setHandoffPending] = useState(false);
  const [meetingDraft, setMeetingDraft] = useState(() => toDateTimeLocal(initialMeetingAt));
  const [assigneeDraft, setAssigneeDraft] = useState(currentAssigneeId ?? "");
  const [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false);
  // Keep the entire original payload, including expectedVersion, across transport retries.
  const unresolved = useRef<Submission | null>(null);

  // 첫 읽기는 ContactPipelineAction의 회사 목록과 같은 약속-콜백 형태로 둔다 —
  // effect 본문에서 setState를 직접 부르면 cascading render 린트에 걸린다.
  useEffect(() => {
    let active = true;
    void Promise.all([readConsultationSnapshot(itemId), readConsultationHandoff(itemId)])
      .then(([snap, handoff]) => {
        if (!active) return;
        if (snap.ok && snap.snapshot) {
          const loaded = snap.snapshot;
          setSnapshot(loaded);
          setPhaseDraft(consultationPhase(loaded));
          setMeetingDraft((prev) => prev || toDateTimeLocal(loaded.meetingAt ?? initialMeetingAt));
          setAssigneeDraft((prev) => prev || loaded.assigneeId || currentAssigneeId || "");
          setLoadError("");
        } else {
          setLoadError(snap.message || "상담 기록을 읽지 못했습니다.");
        }
        setHandoffInfo({
          ready: Boolean(handoff.ok && handoff.ready),
          missing: handoff.missing ?? [],
          message: handoff.message,
        });
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setLoadError(READ_ERROR);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [itemId, initialMeetingAt, currentAssigneeId]);

  /**
   * 기준 다시 읽기 — 성공 뒤에는 초안도 서버값으로 맞추고,
   * 실패(CAS 충돌 등) 뒤에는 초안을 그대로 둔다.
   */
  async function reloadBaseline(updateDrafts: boolean): Promise<ConsultationSnapshot | null> {
    try {
      const [snap, handoff] = await Promise.all([
        readConsultationSnapshot(itemId),
        readConsultationHandoff(itemId),
      ]);
      if (snap.ok && snap.snapshot) {
        const loaded = snap.snapshot;
        setSnapshot(loaded);
        if (updateDrafts) {
          setPhaseDraft(consultationPhase(loaded));
          setMeetingDraft(toDateTimeLocal(loaded.meetingAt));
          setAssigneeDraft((prev) => prev || loaded.assigneeId || currentAssigneeId || "");
        }
        setLoadError("");
        setHandoffInfo({
          ready: Boolean(handoff.ok && handoff.ready),
          missing: handoff.missing ?? [],
          message: handoff.message,
        });
        return loaded;
      }
      setLoadError(snap.message || "상담 기록을 읽지 못했습니다.");
      return null;
    } catch {
      setLoadError(READ_ERROR);
      return null;
    }
  }

  function manualReload() {
    setLoading(true);
    setLoadError("");
    void reloadBaseline(false).finally(() => setLoading(false));
  }

  const busy = pendingStep !== null || modePending || handoffPending;
  const locked = busy || uncertain;

  async function runSubmission(submission: Submission): Promise<void> {
    // A ref closes the interval before React renders disabled controls.
    if (inFlight.current) return;
    inFlight.current = true;
    unresolved.current = submission;
    setPendingStep(submission.kind === "check" ? submission.step ?? null : null);
    setModePending(submission.kind === "mode" || submission.kind === "workflow");
    setHandoffPending(submission.kind === "handoff");
    setActionError("");
    setNotice("");
    try {
      const mutate = submission.kind === "check"
        ? mutateConsultationChecklist
        : submission.kind === "mode"
          ? mutateConsultationMode
          : submission.kind === "workflow" ? mutateConsultationWorkflow : mutateConsultationHandoff;
      const result = await mutate(CHECK_INITIAL, formOf(submission.fields));
      if (result.field === "unknown_result") throw new Error(UNKNOWN_RESULT);
      // A structured response settles this request; a rejection may be retried
      // as a new intent after refreshing the baseline (e.g. a CAS conflict).
      unresolved.current = null;
      setUncertain(false);
      await reloadBaseline(result.ok);
      if (result.ok) { setNotice(submission.success); router.refresh(); }
      else setActionError(result.message || submission.failure);
    } catch {
      // The write may have committed. Never claim failure or generate a new ID.
      setUncertain(true);
      setActionError(UNKNOWN_RESULT);
    } finally {
      inFlight.current = false;
      setPendingStep(null);
      setModePending(false);
      setHandoffPending(false);
    }
  }

  function retryUnresolved(): void {
    if (unresolved.current) void runSubmission(unresolved.current);
  }

  /** 체크 확인/취소 — 성공하면 새 기준으로 바로 갱신해 연속 확인이 된다. */
  async function submitCheck(step: ChecklistStep, confirmed: boolean): Promise<void> {
    const baseline = snapshot;
    if (!baseline || inFlight.current || unresolved.current) return;
    await runSubmission({
      kind: "check",
      step,
      fields: {
          itemId,
          step,
          confirmed: confirmed ? "true" : "false",
          requestId: newRequestId(),
          expectedVersion: String(baseline.version),
      },
      success: confirmed ? "확인했습니다." : "확인을 취소했습니다. 뒤 단계도 함께 무효가 됩니다.",
      failure: "확인하지 못했습니다.",
    });
  }

  /** 상담 보기 전환 — remote ↔ inperson, 같은 행·같은 deal 을 공유한다. 일정 필수. */
  async function submitMode(to: "remote" | "inperson"): Promise<void> {
    const baseline = snapshot;
    if (!baseline || inFlight.current || unresolved.current) return;
    const meeting = new Date(meetingDraft);
    if (Number.isNaN(meeting.getTime())) {
      setActionError("상담 일시를 지정해 주세요.");
      return;
    }
    await runSubmission({
      kind: "mode",
      fields: {
          itemId,
          to,
          // datetime-local belongs to the browser timezone. Send an instant, never
          // a timezone-less string for the server/database to reinterpret.
          meetingAt: meeting.toISOString(),
          assigneeId: assigneeDraft,
          requestId: newRequestId(),
          expectedVersion: String(baseline.version),
      },
      success: "상담 보기를 옮겼습니다.",
      failure: "보기를 옮기지 못했습니다.",
    });
  }

  async function submitWorkflow(phase: ConsultationPhase, cancel = false, schedule = false): Promise<void> {
    const baseline = snapshot;
    if (!baseline || inFlight.current || unresolved.current) return;
    const targetMode = phase === "meeting_scheduled" ? "inperson" : baseline.stage;
    const needsSchedule = !cancel && (schedule || phaseNeedsSchedule(phase) || targetMode !== baseline.stage);
    if (needsSchedule && (!meetingDraft || !assigneeDraft)) {
      setActionError("상담 일시와 담당자를 지정해 주세요.");
      return;
    }
    const scheduled = needsSchedule ? new Date(meetingDraft) : null;
    if (scheduled && Number.isNaN(scheduled.getTime())) {
      setActionError("상담 일시를 지정해 주세요.");
      return;
    }
    const meeting = cancel ? "" : scheduled ? scheduled.toISOString() : baseline.meetingAt ?? "";
    await runSubmission({ kind: "workflow", fields: {
      itemId, requestId: newRequestId(), expectedVersion: String(baseline.version), mode: targetMode,
      phase, meetingAt: meeting, assigneeId: needsSchedule ? assigneeDraft : baseline.assigneeId ?? currentAssigneeId ?? assigneeDraft,
      cancel: String(cancel),
    }, success: cancel ? "예약을 취소했습니다." : "상담 기록을 저장했습니다.", failure: "상담 기록을 저장하지 못했습니다." });
  }

  /** 명시적 인계 — 4완료 + 직인 조건을 DB 가 다시 강제한다. */
  async function submitHandoff(): Promise<void> {
    const baseline = snapshot;
    if (!baseline || inFlight.current || unresolved.current) return;
    await runSubmission({
      kind: "handoff",
      fields: {
          itemId,
          companyName: initialCompanyName,
          requestId: newRequestId(),
          expectedVersion: String(baseline.version),
      },
      success: "업무관리로 인계했습니다.",
      failure: "인계하지 못했습니다.",
    });
  }

  const mode = snapshot?.stage === "inperson" ? "inperson" : "remote";
  const nextMode = mode === "remote" ? "inperson" : "remote";
  const headerStyle = useMemo(
    () =>
      mode === "remote"
        ? { background: "linear-gradient(135deg, var(--mw-tint-blue), var(--mw-tint-teal))" }
        : { background: "linear-gradient(135deg, var(--mw-tint-amber), var(--mw-tint-coral))" },
    [mode],
  );

  return (
    <section
      aria-label={`상담 확인 — ${title}`}
      className="mt-3 border border-mw-line bg-mw-card text-mw-fg"
      style={{ borderRadius: "var(--mw-r-2, 7px)" }}
    >
      <header className="px-3 py-2" style={{ ...headerStyle, borderRadius: "var(--mw-r-2, 7px) var(--mw-r-2, 7px) 0 0" }}>
        <p className="text-xs font-semibold">
          {mode === "remote" ? "비대면 상담" : "대면 상담"}
        </p>
        <p className="mt-0.5 text-[11px] leading-5 text-mw-body">
          완료한 절차를 확인해 주세요.
        </p>
      </header>

      <div className="px-3 py-2">
        {loading ? (
          <p role="status" className="py-2 text-xs text-mw-sub">상담 기록을 읽는 중…</p>
        ) : loadError || !snapshot ? (
          <div>
            <ResultBanner notice={{ ok: false, message: loadError || "상담 기록이 없습니다." }} okClassName="py-1 text-xs text-mw-success" errorClassName="py-1 text-xs text-mw-error" />
            <button
              type="button"
              onClick={manualReload}
              className="mt-1 min-h-9 border border-mw-line px-3 text-xs font-semibold"
              style={{ borderRadius: "var(--mw-r-1, 3px)" }}
            >
              다시 읽기
            </button>
          </div>
        ) : snapshot.stage === "new_lead" ? (
          <p className="py-1 text-xs leading-5 text-mw-body">
            신규리드 단계입니다. 상담 확인 전에 기존 리드컨택 이동(lead_to_contact)으로 먼저 옮겨 주세요. 행 ID는 그대로 보존됩니다.
          </p>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap items-end gap-2">
              <label className="text-xs">
                <span className="mb-1 block text-mw-sub">상담 단계</span>
                <select aria-label="상담 단계" disabled={locked} value={phaseDraft}
                  onChange={(event) => setPhaseDraft(event.target.value as ConsultationPhase)}
                  className="min-h-9 border border-mw-line bg-mw-card px-2">
                  {(mode === "inperson" ? INPERSON_PHASES : [...REMOTE_PHASES, "meeting_scheduled" as const]).map((phase) =>
                    <option key={phase} value={phase}>{CONSULTATION_PHASE_LABEL[phase]}</option>)}
                </select>
              </label>
              <button type="button" disabled={locked} onClick={() => void submitWorkflow(phaseDraft)}
                className="min-h-9 border border-mw-line px-3 text-xs font-semibold disabled:opacity-60">단계 저장</button>
            </div>
            <table className="w-full border-collapse text-xs">
              <caption className="sr-only">계약 확인 4단계 — 앞 단계부터 순서대로 확인합니다</caption>
              <thead>
                <tr className="text-left text-mw-sub">
                  <th scope="col" className="w-10 py-1 font-normal">확인</th>
                  <th scope="col" className="py-1 font-normal">단계</th>
                  <th scope="col" className="py-1 font-normal">방향</th>
                </tr>
              </thead>
              <tbody>
                {CHECKLIST_STEPS.map((step, index) => {
                  const entry = snapshot.checklist[step];
                  const priorDone = CHECKLIST_STEPS.slice(0, index).every((prior) => snapshot.checklist[prior].confirmed);
                  const blocked = !priorDone && !entry.confirmed;
                  const stepPending = pendingStep === step;
                  return (
                    <tr key={step} className="border-t border-mw-line">
                      <td className="py-1.5 pr-2">
                        <input
                          type="checkbox"
                          checked={entry.confirmed}
                          disabled={locked || blocked}
                          aria-busy={stepPending}
                          aria-label={`${CHECKLIST_LABEL[step]} ${entry.confirmed ? "확인 취소" : "확인"}`}
                          title={blocked ? "앞 단계를 먼저 확인해 주세요." : CHECKLIST_DIRECTION[step]}
                          onChange={() => {
                            void submitCheck(step, !entry.confirmed);
                          }}
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <span className="font-medium">{CHECKLIST_LABEL[step]}</span>
                        {entry.at ? (
                          <span className="ml-1 text-[11px] text-mw-sub">
                            {new Date(entry.at).toLocaleString("ko-KR")}
                          </span>
                        ) : blocked ? (
                          <span className="ml-1 text-[11px] text-mw-sub">앞 단계 먼저</span>
                        ) : null}
                      </td>
                      <td className="py-1.5 text-[11px] text-mw-sub">{CHECKLIST_DIRECTION[step]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {actionError ? (
              <ResultBanner notice={{ ok: false, message: actionError }} okClassName="mt-1 text-xs text-mw-success" errorClassName="mt-1 text-xs text-mw-error" />
            ) : null}
            {uncertain ? (
              <button
                type="button"
                disabled={busy}
                onClick={retryUnresolved}
                className="mt-1 min-h-9 border border-mw-line px-3 text-xs font-semibold disabled:opacity-60"
                style={{ borderRadius: "var(--mw-r-1, 3px)" }}
              >
                {busy ? "확인 중…" : "같은 요청 다시 확인"}
              </button>
            ) : null}
            {notice && !actionError ? (
              <ResultBanner notice={{ ok: true, message: notice }} okClassName="mt-1 text-xs text-mw-success" errorClassName="mt-1 text-xs text-mw-error" />
            ) : null}
            <p className="mt-1 text-[11px] leading-5 text-mw-sub">
              앞 확인을 취소하면 뒤 확인은 함께 무효가 되며 기록으로 남습니다.
              {busy ? " 저장 중…" : ""}
            </p>

            <form
              aria-busy={modePending}
              className="mt-2 border-t border-mw-line pt-2"
              onSubmit={(event) => {
                event.preventDefault();
                void submitMode(nextMode);
              }}
            >
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs">
                  <span className="mb-1 block text-mw-sub">상담 일시</span>
                  <input
                    type="datetime-local"
                    name="meetingAt"
                    required
                    disabled={locked}
                    value={meetingDraft}
                    onChange={(event) => setMeetingDraft(event.currentTarget.value)}
                    className="min-h-9 border border-mw-line bg-white px-2 text-xs"
                    style={{ borderRadius: "var(--mw-r-1, 3px)" }}
                  />
                </label>
                <label className="text-xs">
                  <span className="mb-1 block text-mw-sub">담당자</span>
                  <select
                    name="assigneeId"
                    required
                    disabled={locked}
                    value={assigneeDraft}
                    onChange={(event) => setAssigneeDraft(event.currentTarget.value)}
                    className="min-h-9 border border-mw-line bg-white px-2 text-xs"
                    style={{ borderRadius: "var(--mw-r-1, 3px)" }}
                  >
                    <option value="">담당자 선택</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>{member.label}</option>
                    ))}
                  </select>
                </label>
                <button type="button" disabled={locked} onClick={() => void submitWorkflow(
                  phaseNeedsSchedule(consultationPhase(snapshot)) ? consultationPhase(snapshot) : mode === "inperson" ? "meeting_scheduled" : "scheduled", false, true)}
                  className="min-h-9 border border-mw-line px-3 text-xs font-semibold disabled:opacity-60">예약 변경</button>
                <button type="button" disabled={locked || !snapshot.meetingAt} onClick={() => void submitWorkflow(mode === "remote" ? "on_hold" : "cancelled", true)}
                  className="min-h-9 border border-mw-line px-3 text-xs font-semibold disabled:opacity-60">예약 취소</button>
                <button
                  type="submit"
                  disabled={locked}
                  className="min-h-9 border border-mw-line px-3 text-xs font-semibold disabled:opacity-60"
                  style={{ borderRadius: 11 }}
                >
                  {modePending ? "옮기는 중…" : nextMode === "inperson" ? "대면 예약으로 이동" : "비대면 보기로 이동"}
                </button>
              </div>
            </form>

            {snapshot.history && snapshot.history.length > 0 ? (
              <details className="mt-2 border-t border-mw-line pt-2 text-[11px] text-mw-sub">
                <summary className="cursor-pointer">상담 변경 이력</summary>
                <ol className="mt-1 space-y-1">
                  {snapshot.history.map((entry) => <li key={entry.id}>
                    {new Date(entry.at).toLocaleString("ko-KR")} · {members.find((member) => member.id === entry.actorId)?.label ?? "담당자"} · {CONSULTATION_PHASE_LABEL[entry.details.before.phase]} → {CONSULTATION_PHASE_LABEL[entry.details.after.phase]}
                    {" · 담당 "}{members.find((member) => member.id === entry.details.after.assigneeId)?.label ?? "미지정"}
                    {" · "}{entry.details.before.meetingAt ? new Date(entry.details.before.meetingAt).toLocaleString("ko-KR") : "일정 없음"} → {entry.details.after.meetingAt ? new Date(entry.details.after.meetingAt).toLocaleString("ko-KR") : "일정 없음"}
                  </li>)}
                </ol>
              </details>
            ) : null}
            <div className="mt-2 border-t border-mw-line pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={locked || handoffInfo?.ready !== true}
                  aria-busy={handoffPending}
                  onClick={() => {
                    void submitHandoff();
                  }}
                  className="min-h-9 bg-mw-primary px-3 text-xs font-semibold text-white disabled:opacity-60"
                  style={{ borderRadius: 11 }}
                >
                  {handoffPending ? "인계 중…" : "실무로 인계 (4단계 완료 후)"}
                </button>
                <span className="text-[11px] text-mw-sub">
                  {handoffInfo?.ready
                    ? "인계 조건을 모두 채웠습니다."
                    : handoffInfo
                      ? `남은 조건: ${(handoffInfo.missing ?? []).join(" · ") || handoffInfo.message}`
                      : "인계 조건 확인 중…"}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-5 text-mw-sub">
                인계는 정식 contact_to_work 파이프라인으로 실행되며, DB에서 4단계 완료를 다시 강제합니다. 담당·예약은 유지됩니다.
              </p>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
