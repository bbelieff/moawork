"use client";

/**
 * 상담 확인 패널 — 리드컨택 행의 비대면/대면 보기 + 계약 확인 2단계 + 실무 인계.
 *
 * ★ #830(167): 계약 확인은 1단계 «계약금 입금 확인»(보드 «계약금 완료여부» 칸) →
 * 2단계 «직인»(대표·관리자 승인)이다. 4단계 체크리스트 UI 는 없앴다 — 1단계는
 * 보드 칸에서 바꾸고, 이 패널은 두 단계의 상태를 읽기 전용으로 보여준다.
 *
 * 재사용 지점: ① 업무이동 대화상자(기존 ContactPipelineAction 옆, 호환 유지),
 * ② 표의 상담 진행 셀 팝오버(그 자리 확인), ③ 행 상세(ItemDetailPanel) 인라인.
 * 업무이동 메뉴를 찾아야만 닿는 구조가 아니라 세 자리 어디서든 같은 패널이 뜬다.
 *
 * 조회·예약·보기전이·직인·인계는 모두 `lib/consultation/actions` 서버 액션
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
import { consultationPhase, CONSULTATION_PHASE_LABEL, REMOTE_PHASES, INPERSON_PHASES, phaseLabel, phaseNeedsSchedule, type ConsultationPhase } from "@/lib/consultation/phases";
import {
  mutateConsultationHandoff,
  mutateConsultationSeal,
  mutateConsultationMode,
  mutateConsultationWorkflow,
  readConsultationHandoff,
  readConsultationSnapshot,
  type ConsultationActionState,
} from "@/lib/consultation/actions";
import type { ConsultationSnapshot } from "@/lib/consultation/store";

const CHECK_INITIAL: ConsultationActionState = { ok: false, message: "" };
const READ_ERROR = "상담 기록을 불러오지 못했습니다. 잠시 후 다시 읽어 주세요.";
const UNKNOWN_RESULT = "응답을 받지 못해 저장 여부를 확인할 수 없습니다. 입력은 유지했습니다. 같은 요청을 다시 확인해 주세요.";

type Submission = Readonly<{
  kind: "mode" | "handoff" | "workflow" | "seal";
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
  const [handoffInfo, setHandoffInfo] = useState<{ ready: boolean; missing: readonly string[]; message: string; canApproveSeal: boolean; sealApproved: boolean } | null>(null);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
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
          canApproveSeal: handoff.canApproveSeal === true, sealApproved: handoff.sealApproved === true,
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
          canApproveSeal: handoff.canApproveSeal === true, sealApproved: handoff.sealApproved === true,
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

  const busy = modePending || handoffPending;
  const locked = busy || uncertain;

  async function runSubmission(submission: Submission): Promise<void> {
    // A ref closes the interval before React renders disabled controls.
    if (inFlight.current) return;
    inFlight.current = true;
    unresolved.current = submission;
    setModePending(submission.kind === "mode" || submission.kind === "workflow");
    setHandoffPending(submission.kind === "handoff" || submission.kind === "seal");
    setActionError("");
    setNotice("");
    try {
      const mutate = submission.kind === "mode"
        ? mutateConsultationMode
        : submission.kind === "workflow" ? mutateConsultationWorkflow : submission.kind === "seal" ? mutateConsultationSeal : mutateConsultationHandoff;
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
      setModePending(false);
      setHandoffPending(false);
    }
  }

  function retryUnresolved(): void {
    if (unresolved.current) void runSubmission(unresolved.current);
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

  async function submitSeal(): Promise<void> {
    if (!snapshot || inFlight.current || unresolved.current) return;
    await runSubmission({ kind: "seal", fields: { itemId, requestId: newRequestId(), expectedVersion: String(snapshot.version) },
      success: "직인 승인을 기록했습니다.", failure: "직인 승인을 기록하지 못했습니다." });
  }

  /** 명시적 인계 — 계약금 완 + 직인 조건을 DB 가 다시 강제한다. */
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
          계약금 입금 확인 → 직인 순서로 진행합니다.
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
            {snapshot.phase === "absent" && snapshot.absentFromPhase ? (
              <p className="mb-2 text-[11px] text-mw-sub">{phaseLabel("absent", snapshot.absentFromPhase)}</p>
            ) : null}
            <dl aria-label="계약 확인 2단계" className="text-xs">
              <div className="flex flex-wrap items-baseline gap-x-2 border-t border-mw-line py-1.5">
                <dt className="font-medium">1단계 계약금 입금 확인</dt>
                <dd className={snapshot.contractFee?.ready ? "text-mw-success" : "text-mw-body"}>
                  {snapshot.contractFee?.status ?? "계약금 미"}
                </dd>
                <dd className="w-full text-[11px] text-mw-sub">보드 «계약금 완료여부» 칸에서 바꿉니다</dd>
              </div>
              <div className="flex flex-wrap items-baseline gap-x-2 border-t border-mw-line py-1.5">
                <dt className="font-medium">2단계 직인</dt>
                <dd className={handoffInfo?.sealApproved ? "text-mw-success" : "text-mw-body"}>
                  {handoffInfo?.sealApproved ? "완료" : "대기"}
                </dd>
              </div>
            </dl>
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
            {busy ? <p className="mt-1 text-[11px] leading-5 text-mw-sub">저장 중…</p> : null}

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
                    {new Date(entry.at).toLocaleString("ko-KR")} · {members.find((member) => member.id === entry.actorId)?.label ?? "담당자"} · {entry.kind === "seal_approved" ? "직인 승인 완료" : <>{phaseLabel(entry.details.before.phase, entry.details.before.absentFromPhase)} → {phaseLabel(entry.details.after.phase, entry.details.after.absentFromPhase)}
                    {" · 담당 "}{members.find((member) => member.id === entry.details.after.assigneeId)?.label ?? "미지정"}
                    {" · "}{entry.details.before.meetingAt ? new Date(entry.details.before.meetingAt).toLocaleString("ko-KR") : "일정 없음"} → {entry.details.after.meetingAt ? new Date(entry.details.after.meetingAt).toLocaleString("ko-KR") : "일정 없음"}</>}
                  </li>)}
                </ol>
              </details>
            ) : null}
            <div className="mt-2 border-t border-mw-line pt-2">
              <p className="mb-2 text-xs text-mw-body">{handoffInfo?.sealApproved ? "직인 승인 완료" : "대표·관리자 직인 승인 대기"}</p>
              {handoffInfo?.canApproveSeal && !handoffInfo.sealApproved ? <button type="button"
                disabled={locked || snapshot.contractFee?.ready !== true}
                title={snapshot.contractFee?.ready ? undefined : "1단계 계약금 입금 확인 후 승인할 수 있습니다."}
                onClick={() => void submitSeal()} className="mb-2 min-h-9 border border-mw-line px-3 text-xs font-semibold disabled:opacity-60" style={{ borderRadius: 11 }}>직인 승인 완료</button> : null}
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
                  {handoffPending ? "인계 중…" : "실무로 인계 (계약금·직인 완료 후)"}
                </button>
                <span className="text-[11px] text-mw-sub">
                  {handoffInfo?.ready
                    ? "인계 조건을 모두 채웠습니다."
                    : handoffInfo
                      ? `남은 조건: ${(handoffInfo.missing ?? []).join(" · ") || handoffInfo.message}`
                      : "인계 조건 확인 중…"}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
