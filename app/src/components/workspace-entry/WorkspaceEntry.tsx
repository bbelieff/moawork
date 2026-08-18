"use client";

import { FormEvent, type ReactNode, type RefObject, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import type { MyWorkspaceEntryRequest, PlatformCreateRequest } from "@/lib/workspace-entry/server";
import { normalizeWorkspaceSlug, submitWorkspaceRequest, validateWorkspaceSlug } from "@/lib/workspace-entry/contracts";
import { ApprovalQueue } from "./ApprovalQueue";
import { useTrack } from "@/lib/analytics/useTrack";
import type { WorkspaceEntryState } from "@/lib/analytics/events";
import { noticeLive, noticeRole } from "@/lib/ui/result-notice";
import styles from "./workspace-entry.module.css";

type InitialView = "fork" | "create" | "join" | "pending" | "rejected" | "blocked";
export type WorkspaceEntryView =
  | "fork"
  | "create-name"
  | "create-slug"
  | "create-confirm"
  | "join-address"
  | "join-confirm"
  | "pending"
  | "pending-manage"
  | "rejected"
  | "blocked"
  | "operator";
type Notice = { tone: "error" | "pending"; message: string } | null;

type Props = {
  initialView?: InitialView;
  requests?: MyWorkspaceEntryRequest[];
  isPlatformAdmin?: boolean;
  platformRequests?: PlatformCreateRequest[];
  freshStart?: boolean;
};

export function resolveWorkspaceEntryView({
  initialView = "fork",
  hasPendingRequest,
  hasRejectedRequest,
  isPlatformAdmin,
  freshStart = false,
}: {
  initialView?: InitialView;
  hasPendingRequest: boolean;
  hasRejectedRequest: boolean;
  isPlatformAdmin: boolean;
  freshStart?: boolean;
}): WorkspaceEntryView {
  if (isPlatformAdmin) return "operator";
  if (hasPendingRequest) return "pending";
  if (hasRejectedRequest && !freshStart) return "rejected";
  if (initialView === "create") return "create-name";
  if (initialView === "join") return "join-address";
  return initialView;
}

export function nextWorkspaceEntryQuestion(view: WorkspaceEntryView): WorkspaceEntryView {
  if (view === "create-name") return "create-slug";
  if (view === "create-slug") return "create-confirm";
  if (view === "join-address") return "join-confirm";
  return view;
}

export function workspaceAddressPreview(value: string): string {
  return `https://www.moa-work.com/w/${normalizeWorkspaceSlug(value) || "{주소}"}`;
}

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

export function workspaceEntryPendingSummary(request: MyWorkspaceEntryRequest | null): {
  kindLabel: string;
  expiryLabel: string | null;
} | null {
  if (!request || request.status !== "pending" || request.decisionState !== "pending") return null;
  const createdAt = Date.parse(request.createdAt);
  const deadline = request.reviewDeadline ? Date.parse(request.reviewDeadline) : Number.NaN;
  const hasVerifiedFourteenDayDeadline =
    request.kind === "join" &&
    Number.isFinite(createdAt) &&
    Number.isFinite(deadline) &&
    deadline - createdAt === FOURTEEN_DAYS_MS;

  return {
    kindLabel: request.kind === "join" ? "회사 합류 요청" : "회사 만들기 요청",
    expiryLabel: hasVerifiedFourteenDayDeadline
      ? `${formatDeadline(request.reviewDeadline!)} · 요청 후 14일 자동 만료`
      : null,
  };
}

export function WorkspaceEntry({ initialView = "fork", requests = [], isPlatformAdmin = false, platformRequests = [], freshStart = false }: Props) {
  const currentRequest = useMemo(() => requests.find((request) => request.status === "pending") ?? null, [requests]);
  const router = useRouter();
  const latestNotApproved = useMemo(() => requests.find((request) => request.decisionState === "not_approved") ?? null, [requests]);
  const [view, setView] = useState<WorkspaceEntryView>(() => resolveWorkspaceEntryView({
    initialView,
    hasPendingRequest: currentRequest !== null,
    hasRejectedRequest: latestNotApproved !== null,
    isPlatformAdmin,
    freshStart,
  }));
  const [activeRequest, setActiveRequest] = useState(currentRequest);
  const [draftName, setDraftName] = useState("");
  const [draftSlug, setDraftSlug] = useState("");
  const [slugInput, setSlugInput] = useState("");
  const [joinSlug, setJoinSlug] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const retryKeys = useRef<Record<"create" | "join", { payload: string; requestId: string } | null>>({ create: null, join: null });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nameId = useId();
  const slugId = useId();
  const joinSlugId = useId();
  const track = useTrack();

  useEffect(() => {
    if (latestNotApproved) void fetch("/api/workspace-entry-resume", { method: "DELETE" }).catch(() => undefined);
  }, [latestNotApproved]);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    track("workspace_entry_state", { state: analyticsStateForView(view) });
  }, [track, view]);

  async function submit(kind: "create" | "join", fields: { displayName?: string; slug?: string; lookup?: string }) {
    const slug = normalizeWorkspaceSlug(fields.slug ?? "");
    const lookup = kind === "join" ? normalizeWorkspaceSlug(fields.lookup ?? "") : "";
    const candidate = kind === "create" ? slug : lookup;
    const error = validateWorkspaceSlug(candidate);
    if (error) return setNotice({ tone: "error", message: error });
    const displayName = fields.displayName?.trim() ?? "";
    const payload = kind === "create" ? `${displayName}:${slug}` : lookup;
    const prior = retryKeys.current[kind];
    const requestId = prior?.payload === payload ? prior.requestId : crypto.randomUUID();
    retryKeys.current[kind] = { payload, requestId };
    setBusy(true);
    setNotice(null);
    try {
      const result = await submitWorkspaceRequest({ kind, displayName, slug, lookup, requestId });
      track("workspace_request_result", { kind, outcome: result.ok ? "success" : "failure" });
      setNotice({ tone: result.ok ? "pending" : "error", message: result.message });
      if (result.ok) {
        retryKeys.current[kind] = null;
        // 플랫폼 관리자의 회사 만들기는 즉시 생성된다(018) → 대기 화면을 거치지 않고 바로 입장.
        if (result.state === "approved" && result.redirectTo) {
          setNotice({ tone: "pending", message: result.message });
          router.replace(result.redirectTo);
          return;
        }
        setActiveRequest({ requestId, kind, status: "pending", createdAt: new Date().toISOString(), resolvedAt: null, decisionState: "pending", approvedTargetSlug: null, reviewDeadline: null });
        setView("pending");
        router.replace("/workspace-entry?mode=resume");
      }
    } catch {
      track("workspace_request_result", { kind, outcome: "failure" });
      setNotice({ tone: "error", message: "요청을 지금 처리할 수 없어요. 입력은 그대로 두었어요. 잠시 후 다시 시도해 주세요." });
    } finally { setBusy(false); }
  }

  function continueWithCompanyName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const displayName = String(form.get("displayName") ?? "").trim();
    if (!displayName) return;
    setDraftName(displayName);
    setNotice(null);
    setView(nextWorkspaceEntryQuestion("create-name"));
  }

  function continueWithCreateSlug(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeWorkspaceSlug(slugInput);
    const error = validateWorkspaceSlug(normalized);
    if (error) return setNotice({ tone: "error", message: error });
    setDraftSlug(normalized);
    setNotice(null);
    setView(nextWorkspaceEntryQuestion("create-slug"));
  }

  function continueWithJoinAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const normalized = normalizeWorkspaceSlug(String(form.get("slug") ?? ""));
    const error = validateWorkspaceSlug(normalized);
    if (error) return setNotice({ tone: "error", message: error });
    setJoinSlug(normalized);
    setNotice(null);
    setView(nextWorkspaceEntryQuestion("join-address"));
  }

  const confirmCreate = () => submit("create", { displayName: draftName, slug: draftSlug });
  const confirmJoin = () => submit("join", { lookup: joinSlug });

  async function cancelRequest(next: "fork" | "same" | "create" = "fork") {
    if (!activeRequest) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await submitWorkspaceRequest({ kind: "cancel", requestId: activeRequest.requestId });
      setNotice({ tone: result.ok ? "pending" : "error", message: result.message });
      if (result.ok) {
        const priorKind = activeRequest.kind;
        setActiveRequest(null);
        setView(
          next === "create"
            ? "create-name"
            : next === "same"
              ? priorKind === "create" ? "create-name" : "join-address"
              : "fork",
        );
      }
    } catch {
      setNotice({ tone: "error", message: "취소하지 못했어요. 현재 요청은 그대로예요. 목록을 새로 확인한 뒤 다시 시도해 주세요." });
    } finally { setBusy(false); }
  }

  const back = () => { setNotice(null); setDraftName(""); setDraftSlug(""); setSlugInput(""); setJoinSlug(""); setView("fork"); };
  const copy = workspaceEntryCopy(view);
  const pendingSummary = workspaceEntryPendingSummary(activeRequest);

  return (
    <EntryShell eyebrow={view === "operator" ? "운영 영역" : "처음 오셨군요"} title={copy.title} lead={copy.lead} view={view} headingRef={headingRef}>
      {notice ? <p role={noticeRole(notice.tone !== "error")} aria-live={noticeLive(notice.tone !== "error")} className={notice.tone === "error" ? styles.error : styles.status}>{notice.message}</p> : null}
      <div className={styles.messages} aria-live="polite">
        {view === "fork" ? <>
          <div className={styles.bubble}><strong>새 회사를 시작할까요, 기존 회사에 합류할까요?</strong><small>지금 고른 뒤에도 요청 전에는 언제든 돌아올 수 있어요.</small></div>
          <div className={styles.quick} aria-label="시작 방법 선택">
            <button type="button" onClick={() => setView("create-name")}>새 회사를 시작할게요</button>
            <button type="button" onClick={() => setView("join-address")}>기존 회사에 합류할게요</button>
          </div>
        </> : null}

        {view === "create-name" ? <>
          <div className={styles.bubble}><strong>회사 이름은 무엇인가요?</strong><small>한글을 포함해 편하게 적어 주세요. 다음 질문에서 회사 주소를 정해요.</small></div>
          <form className={`${styles.form} ${styles.answerBubble}`} onSubmit={continueWithCompanyName}>
            <label htmlFor={nameId}>회사 이름<input id={nameId} name="displayName" maxLength={80} required defaultValue={draftName} placeholder="예: 모아컴퍼니" autoComplete="organization" /></label>
            <div className={styles.actions}><button type="button" className={styles.quietButton} onClick={back}>다른 방법 고르기</button><button type="submit">다음 질문</button></div>
          </form>
        </> : null}

        {view === "create-slug" ? <>
          <div className={styles.answerPreview} aria-label="앞서 답한 회사 이름"><span>회사 이름</span><strong>{draftName}</strong></div>
          <div className={styles.bubble}><strong>회사 주소는 무엇으로 할까요?</strong><small>영문 소문자·숫자·하이픈 3~40자로 적어 주세요. 회사가 만들어진 뒤에는 고정돼요.</small></div>
          <form className={`${styles.form} ${styles.answerBubble}`} onSubmit={continueWithCreateSlug}>
            <label htmlFor={slugId}>회사 주소<input id={slugId} name="slug" minLength={3} maxLength={80} required value={slugInput} onChange={(event) => setSlugInput(event.currentTarget.value)} placeholder="moa-company" autoCapitalize="none" autoCorrect="off" /><small>영문 소문자·숫자·하이픈만 사용할 수 있어요.</small></label>
            <div className={styles.slugPreview} aria-live="polite"><span>주소 미리보기</span><code>{workspaceAddressPreview(slugInput)}</code><small>미리보기일 뿐 예약이나 생성 성공을 뜻하지 않아요.</small></div>
            <div className={styles.actions}><button type="button" className={styles.quietButton} onClick={() => setView("create-name")}>이전 질문</button><button type="submit">다음 질문</button></div>
          </form>
        </> : null}

        {view === "create-confirm" ? <>
          <div className={styles.bubble}><strong>이 내용으로 회사 만들기를 신청할까요?</strong><small>운영팀이 신청을 승인하면 회사 공간과 대표 권한을 사용할 수 있어요.</small></div>
          <div className={styles.confirmCard}><span>회사 이름</span><strong>{draftName}</strong><span>회사 주소</span><code>https://www.moa-work.com/w/{draftSlug}</code></div>
          <div className={styles.actions}><button type="button" className={styles.quietButton} onClick={() => setView("create-slug")}>이전 질문</button><button type="button" disabled={busy} onClick={() => void confirmCreate()}>{busy ? "신청 중…" : "이대로 신청하기"}</button></div>
        </> : null}

        {view === "join-address" ? <>
          <div className={styles.bubble}><strong>합류할 회사 주소를 입력해 주세요.</strong><small>보안을 위해 회사가 있는지 여부는 따로 알려드리지 않아요.</small></div>
          <form className={`${styles.form} ${styles.answerBubble}`} onSubmit={continueWithJoinAddress}>
            <label htmlFor={joinSlugId}>회사 주소<input id={joinSlugId} name="slug" required maxLength={80} defaultValue={joinSlug} placeholder="company-address" autoCapitalize="none" autoCorrect="off" /></label>
            <div className={styles.actions}><button type="button" className={styles.quietButton} onClick={back}>다른 방법 고르기</button><button type="submit">다음 질문</button></div>
          </form>
        </> : null}

        {view === "join-confirm" ? <>
          <div className={styles.bubble}><strong>이 주소로 합류를 신청할까요?</strong><small>신청 뒤에도 대표가 승인하기 전에는 회사 접근 권한이 없어요.</small></div>
          <div className={styles.confirmCard}><span>회사 주소</span><code>https://www.moa-work.com/w/{joinSlug}</code><small>보안을 위해 주소 오류와 존재 여부는 같은 안내로 처리해요.</small></div>
          <div className={styles.actions}><button type="button" className={styles.quietButton} onClick={() => setView("join-address")}>이전 질문</button><button type="button" disabled={busy} onClick={() => void confirmJoin()}>{busy ? "신청 중…" : "이대로 신청하기"}</button></div>
        </> : null}

        {view === "pending" ? <>
          <section className={styles.pendingState} aria-label="대기 요청 상태">
            <div className={styles.bubble}><strong>요청은 도착했어요.</strong><small>{pendingSummary?.expiryLabel ? `${pendingSummary.expiryLabel}로 서버에서 확인됐어요. 만료 뒤에는 회사 정보 없이 다시 요청할 수 있어요.` : "아직 멤버십이 아니며 회사 내부는 볼 수 없어요. 만료 기한은 서버에서 확인된 경우에만 표시해요."}</small></div>
            <div className={styles.pendingMeta}>
              {pendingSummary ? <dl className={styles.pendingSummary} aria-label="대기 요청 요약"><div><dt>요청</dt><dd>{pendingSummary.kindLabel}</dd></div><div><dt>상태</dt><dd>검토 중</dd></div>{pendingSummary.expiryLabel ? <div><dt>만료</dt><dd>{pendingSummary.expiryLabel}</dd></div> : null}</dl> : null}
              <div className={styles.answerPreview}><span>현재 상태</span><strong>검토 중 · 회사 접근 0곳</strong></div>
            </div>
          </section>
          <div className={styles.pendingDivider} aria-hidden="true" />
          <section className={styles.pendingActions} aria-label="대기 요청 행동">
            <div className={styles.quick}><button type="button" onClick={() => setView("pending-manage")}>취소하거나 다시 입력하기</button></div>
            <div className={styles.pendingExits} aria-label="다른 안전한 이동">
              <Link href="/workspaces">다른 회사 보기</Link>
              <form action="/auth/signout" method="post"><button type="submit">로그아웃</button></form>
            </div>
          </section>
        </> : null}

        {view === "pending-manage" ? <>
          <div className={styles.bubble}><strong>요청을 다시 입력할까요, 취소할까요?</strong><small>둘 다 현재 요청을 서버에서 안전하게 취소한 뒤 반영해요.</small></div>
          <div className={styles.quick} aria-label="대기 요청 관리">
            <button type="button" disabled={busy} onClick={() => void cancelRequest("same")}>취소하고 다시 입력할게요</button>
            <button type="button" className={styles.dangerChoice} disabled={busy} onClick={() => void cancelRequest("fork")}>{busy ? "처리 중…" : "요청을 취소할게요"}</button>
          </div>
        </> : null}

        {view === "rejected" ? <>
          <div className={styles.bubble}><strong>이 요청으로는 회사에 들어갈 수 없어요.</strong><small>검토 사유와 회사 정보는 보여드리지 않아요.</small></div>
          <div className={styles.quick}><button type="button" onClick={back}>안전하게 다시 시작하기</button></div>
        </> : null}

        {view === "blocked" ? <>
          <div className={styles.bubble}><strong>회사 접근 상태를 다시 확인해야 해요.</strong><small>중지됐거나 일관되지 않은 소속을 새 회사 없음으로 바꾸지 않아요. 회사 정보 없이 안전하게 멈췄어요.</small></div>
          <div className={styles.quick}><button type="button" onClick={() => router.refresh()}>접근 상태 다시 확인하기</button></div>
        </> : null}

        {view === "operator" ? <>
          <div className={styles.bubble}><strong>승인된 운영 요청만 확인할 수 있어요.</strong><small>플랫폼 역할만으로 고객 회사 멤버십이나 대표 권한은 생기지 않아요.</small></div>
          <details className={styles.controlPlane}><summary>회사 만들기 검토 요청 확인</summary><p>이 운영 영역에는 회사 전환·생성·합류·진입 행동이 없어요.</p><ApprovalQueue mode="platform" requests={platformRequests} /></details>
          <div className={styles.pendingExits} aria-label="플랫폼 운영 계정 행동">
            <form action="/mode/preference" method="post">
              <input type="hidden" name="mode" value="platform" />
              <input type="hidden" name="next" value="/platform" />
              <button type="submit">플랫폼 관리로 가기</button>
            </form>
            <form action="/auth/signout" method="post">
              <button type="submit">로그아웃</button>
            </form>
          </div>
        </> : null}
      </div>
    </EntryShell>
  );
}

function analyticsStateForView(view: WorkspaceEntryView): WorkspaceEntryState {
  if (view === "fork") return "choose_path";
  if (view.startsWith("create")) return "create";
  if (view.startsWith("join")) return "join";
  if (view.startsWith("pending")) return "pending";
  if (view === "rejected") return "rejected";
  if (view === "blocked") return "blocked";
  return "operator";
}

export function workspaceEntryCopy(view: WorkspaceEntryView): { title: string; lead: string } {
  if (view === "create-name") return { title: "회사 만들기를 시작할게요.", lead: "지금은 회사 이름 하나만 여쭤볼게요." };
  if (view === "create-slug") return { title: "회사 주소를 정해요.", lead: "앞서 답한 이름은 그대로 두고 주소 하나만 확인해요." };
  if (view === "create-confirm") return { title: "신청 내용을 확인해요.", lead: "저장하기 전에 지금까지 답한 내용만 확인해 주세요." };
  if (view === "join-address") return { title: "기존 회사에 합류할게요.", lead: "합류할 회사 주소만 확인할게요." };
  if (view === "join-confirm") return { title: "합류 신청을 확인해요.", lead: "신청하기 전에 주소를 한 번만 확인해 주세요." };
  if (view === "pending") return { title: "요청을 검토하고 있어요.", lead: "승인 전에는 회사에 들어갈 수 없어요. 지금 필요한 행동 하나만 보여드려요." };
  if (view === "pending-manage") return { title: "대기 요청을 관리해요.", lead: "현재 요청을 어떻게 바꿀지 한 번만 선택해 주세요." };
  if (view === "rejected") return { title: "회사 접근을 확인할 수 없어요.", lead: "회사 정보는 드러내지 않고 안전한 다음 행동만 안내할게요." };
  if (view === "blocked") return { title: "회사 접근 상태를 확인하고 있어요.", lead: "새 회사를 권하지 않고 안전한 재확인만 안내할게요." };
  if (view === "operator") return { title: "플랫폼 운영 요청을 확인해요.", lead: "고객 회사 접근과 완전히 분리된 운영 영역이에요." };
  return { title: "어떻게 시작할까요?", lead: "필요한 것만 하나씩 여쭤볼게요." };
}

function formatDeadline(value: string): string {
  const deadline = new Date(value);
  return Number.isNaN(deadline.getTime()) ? "서버가 안내한 기한" : new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(deadline);
}

function EntryShell({ eyebrow, title, lead, view, headingRef, children }: { eyebrow: string; title: string; lead: string; view: WorkspaceEntryView; headingRef: RefObject<HTMLHeadingElement | null>; children: ReactNode }) {
  const progress = workspaceEntryProgress(view);
  const isPending = view === "pending";
  return <main className={styles.page} data-entry-view={view}><section className={styles.shell} aria-labelledby="workspace-entry-title"><header className={styles.protoTop}><Logo height={28} href="/" /><span>회사 시작 안내</span></header><div className={styles.wrap}><div className={styles.chat}><div className={styles.guideHead}><span className={styles.guideAvatar} aria-hidden="true">M</span><div><strong>모아 가이드</strong><small>필요한 것만 하나씩 도와드릴게요.</small></div></div><p className={styles.eyebrow}>{eyebrow}</p><h1 id="workspace-entry-title" ref={headingRef} tabIndex={-1} data-focus-target="current-question">{title}</h1><p className={styles.lead}>{lead}</p>{isPending ? <div className={styles.pendingProgress} aria-label="현재 질문 요약"><span>{progress.label}</span><strong>{progress.detail}</strong></div> : null}{children}</div>{!isPending ? <aside className={styles.summary} aria-label="현재 질문 요약"><h2>지금 확인하는 것</h2><div className={styles.summarySteps}><div className={`${styles.summaryStep} ${styles.current}`}><span className={styles.stepNumber}>1</span><div><strong>{progress.label}</strong><small>{progress.detail}</small></div></div></div><p className={styles.safety}>확인이 끝난 내용은 다시 묻지 않아요. 서비스 관리자 권한만으로 고객 회사에 들어갈 수는 없어요.</p></aside> : null}</div></section></main>;
}

export function workspaceEntryProgress(view: WorkspaceEntryView): { label: string; detail: string } {
  if (view === "create-name") return { label: "회사 이름", detail: "현재 질문 1개" };
  if (view === "create-slug") return { label: "회사 주소", detail: "현재 질문 1개" };
  if (view === "create-confirm") return { label: "회사 만들기 신청", detail: "현재 확인 1개" };
  if (view === "join-address") return { label: "합류 주소", detail: "현재 질문 1개" };
  if (view === "join-confirm") return { label: "합류 신청", detail: "현재 확인 1개" };
  if (view === "pending") return { label: "검토 상태", detail: "다음 행동 1개" };
  if (view === "pending-manage") return { label: "요청 관리", detail: "현재 질문 1개" };
  if (view === "rejected") return { label: "안전한 복구", detail: "다음 행동 1개" };
  if (view === "blocked") return { label: "접근 상태 재확인", detail: "안전하게 재확인" };
  if (view === "operator") return { label: "플랫폼 운영", detail: "회사 접근 행동 없음" };
  return { label: "시작 방법", detail: "현재 질문 1개" };
}
