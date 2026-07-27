"use client";

import { FormEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import type { MyWorkspaceEntryRequest, PlatformCreateRequest } from "@/lib/workspace-entry/server";
import { normalizeWorkspaceSlug, submitWorkspaceRequest, validateWorkspaceSlug } from "@/lib/workspace-entry/contracts";
import { ApprovalQueue } from "./ApprovalQueue";
import styles from "./workspace-entry.module.css";

type View = "fork" | "create" | "join" | "pending" | "rejected";
type Notice = { tone: "error" | "pending"; message: string } | null;

type Props = {
  initialView?: View;
  requests?: MyWorkspaceEntryRequest[];
  isPlatformAdmin?: boolean;
  platformRequests?: PlatformCreateRequest[];
};

export function WorkspaceEntry({ initialView = "fork", requests = [], isPlatformAdmin = false, platformRequests = [] }: Props) {
  const currentRequest = useMemo(() => requests.find((request) => request.status === "pending") ?? null, [requests]);
  const router = useRouter();
  const latestNotApproved = useMemo(() => requests.find((request) => request.decisionState === "not_approved") ?? null, [requests]);
  const [view, setView] = useState<View>(currentRequest ? "pending" : latestNotApproved ? "rejected" : initialView);
  const [activeRequest, setActiveRequest] = useState(currentRequest);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const retryKeys = useRef<Record<"create" | "join", { payload: string; requestId: string } | null>>({ create: null, join: null });
  const nameId = useId();
  const slugId = useId();
  const lookupId = useId();

  useEffect(() => {
    if (latestNotApproved) void fetch("/api/workspace-entry-resume", { method: "DELETE" }).catch(() => undefined);
  }, [latestNotApproved]);

  async function submit(event: FormEvent<HTMLFormElement>, kind: "create" | "join") {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const slug = normalizeWorkspaceSlug(String(form.get("slug") ?? ""));
    if (kind === "create") {
      const error = validateWorkspaceSlug(slug);
      if (error) return setNotice({ tone: "error", message: error });
    }
    const payload = kind === "create" ? `${String(form.get("displayName") ?? "").trim()}:${slug}` : String(form.get("lookup") ?? "").trim();
    const prior = retryKeys.current[kind];
    const requestId = prior?.payload === payload ? prior.requestId : crypto.randomUUID();
    retryKeys.current[kind] = { payload, requestId };
    setBusy(true);
    setNotice(null);
    try {
      const result = await submitWorkspaceRequest({ kind, displayName: String(form.get("displayName") ?? ""), slug, lookup: String(form.get("lookup") ?? ""), requestId });
      setNotice({ tone: result.ok ? "pending" : "error", message: result.message });
      if (result.ok) {
        retryKeys.current[kind] = null;
        setActiveRequest({ requestId, kind, status: "pending", createdAt: new Date().toISOString(), resolvedAt: null, decisionState: "pending", approvedTargetSlug: null, reviewDeadline: null });
        setView("pending");
        router.replace("/workspace-entry?mode=resume");
      }
    } catch {
      setNotice({ tone: "error", message: "요청을 지금 처리할 수 없어요. 입력은 그대로 두었어요. 잠시 후 다시 시도해 주세요." });
    } finally { setBusy(false); }
  }

  async function cancelRequest(editAfter = false) {
    if (!activeRequest) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await submitWorkspaceRequest({ kind: "cancel", requestId: activeRequest.requestId });
      setNotice({ tone: result.ok ? "pending" : "error", message: result.message });
      if (result.ok) {
        const priorKind = activeRequest.kind;
        setActiveRequest(null);
        setView(editAfter ? priorKind : "fork");
      }
    } catch {
      setNotice({ tone: "error", message: "취소하지 못했어요. 현재 요청은 그대로예요. 목록을 새로 확인한 뒤 다시 시도해 주세요." });
    } finally { setBusy(false); }
  }

  const back = () => { setNotice(null); setView("fork"); };
  const title = view === "pending" ? "요청을 검토하고 있어요." : view === "rejected" ? "요청 결과를 확인할 수 없어요." : "어떻게 시작할까요?";
  const lead = view === "pending" ? "승인 전에는 회사에 들어갈 수 없어요. 요청을 취소하고 다시 입력할 수 있어요." : view === "rejected" ? "회사 존재 여부나 일치한 입력은 알려드리지 않아요. 입력을 확인해 다시 요청해 주세요." : "필요한 것만 하나씩 여쭤볼게요.";

  return (
    <EntryShell eyebrow="처음 오셨군요" title={title} lead={lead}>
      {notice ? <p role="status" aria-live="polite" className={notice.tone === "error" ? styles.error : styles.status}>{notice.message}</p> : null}
      <div className={styles.messages} aria-live="polite">
        {view === "fork" ? <>
          <div className={styles.bubble}><strong>새 회사를 시작할까요, 기존 회사에 합류할까요?</strong><small>지금 고른 뒤에도 요청 전에는 언제든 돌아올 수 있어요.</small></div>
          <div className={styles.quick} aria-label="시작 방법 선택">
            <button type="button" onClick={() => setView("create")}>새 회사를 시작할게요</button>
            <button type="button" onClick={() => setView("join")}>기존 회사에 합류할게요</button>
          </div>
        </> : null}

        {view === "create" ? <>
          <div className={styles.bubble}><strong>먼저 회사 이름과 주소를 알려 주세요.</strong><small>회사는 플랫폼 검토 뒤 만들어져요. 주소는 만들어진 뒤 고정돼요.</small></div>
          <form className={`${styles.form} ${styles.answerBubble}`} onSubmit={(event) => submit(event, "create")}>
            <label htmlFor={nameId}>회사 이름<input id={nameId} name="displayName" maxLength={80} required placeholder="예: 모아컴퍼니" /></label>
            <label htmlFor={slugId}>회사 주소<input id={slugId} name="slug" minLength={3} maxLength={40} required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="moa-company" autoCapitalize="none" /><small>영문 소문자·숫자·하이픈 3~40자로 입력해 주세요.</small></label>
            <div className={styles.actions}><button type="button" className={styles.quietButton} onClick={back}>다른 방법 고르기</button><button type="submit" disabled={busy}>{busy ? "확인 중…" : "회사 만들기 요청 보내기"}</button></div>
          </form>
        </> : null}

        {view === "join" ? <>
          <div className={styles.bubble}><strong>받은 회사 주소나 초대 코드를 입력해 주세요.</strong><small>어떤 값이 일치했는지와 회사 존재 여부는 공개하지 않아요.</small></div>
          <form className={`${styles.form} ${styles.answerBubble}`} onSubmit={(event) => submit(event, "join")}>
            <label htmlFor={lookupId}>영문 회사 주소 또는 초대 코드<input id={lookupId} name="lookup" required maxLength={256} placeholder="회사 주소 또는 받은 코드" autoCapitalize="none" autoCorrect="off" /></label>
            <div className={styles.actions}><button type="button" className={styles.quietButton} onClick={back}>다른 방법 고르기</button><button type="submit" disabled={busy}>{busy ? "요청 중…" : "합류 요청 보내기"}</button></div>
          </form>
        </> : null}

        {view === "pending" ? <>
          <div className={styles.bubble}><strong>요청은 도착했어요.</strong><small>{activeRequest?.kind === "join" ? activeRequest.reviewDeadline ? `${formatDeadline(activeRequest.reviewDeadline)}까지 같은 검토 중 상태로 보여요. 기한이 지나면 회사 정보 없이 다시 요청할 수 있어요.` : "7일 이내에 같은 검토 중 상태로 보여요. 새로고침하면 서버가 정한 기한을 확인할 수 있어요." : "아직 멤버십이 아니며 회사 내부는 볼 수 없어요. 승인 결과는 다음 로그인에서도 다시 확인해요."}</small></div>
          <div className={`${styles.answerBubble} ${styles.pendingActions}`}>
            <span>검토 중 · 회사 접근 0곳</span>
            <div className={styles.actions}><button type="button" className={styles.quietButton} disabled={busy} onClick={() => cancelRequest(true)}>취소하고 다시 입력하기</button><button type="button" className={styles.dangerButton} disabled={busy} onClick={() => cancelRequest(false)}>{busy ? "처리 중…" : "요청 취소하기"}</button></div>
          </div>
        </> : null}

        {view === "rejected" ? <>
          <div className={styles.bubble}><strong>이 요청으로는 회사에 들어갈 수 없어요.</strong><small>입력이 맞았는지, 회사가 있는지, 누가 결정했는지는 보여드리지 않아요.</small></div>
          <div className={styles.quick}><button type="button" onClick={() => setView("join")}>회사 합류 다시 요청하기</button><button type="button" onClick={() => setView("fork")}>다른 시작 방법 보기</button></div>
        </> : null}
      </div>
      {isPlatformAdmin ? <details className={styles.controlPlane}><summary>플랫폼 운영 요청 보기</summary><p>일반 회사 시작과 분리된 운영 영역이에요. 이 권한으로 고객 회사에 들어가지는 않아요.</p><ApprovalQueue mode="platform" requests={platformRequests} /></details> : null}
    </EntryShell>
  );
}

function formatDeadline(value: string): string {
  const deadline = new Date(value);
  return Number.isNaN(deadline.getTime()) ? "서버가 안내한 기한" : new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(deadline);
}

function EntryShell({ eyebrow, title, lead, children }: { eyebrow: string; title: string; lead: string; children: ReactNode }) {
  return <main className={styles.page}><section className={styles.shell} aria-labelledby="workspace-entry-title"><header className={styles.protoTop}><Logo height={28} /><span>회사 시작 안내</span></header><div className={styles.wrap}><div className={styles.chat}><div className={styles.guideHead}><span className={styles.guideAvatar} aria-hidden="true">M</span><div><strong>모아 가이드</strong><small>필요한 것만 하나씩 도와드릴게요.</small></div></div><p className={styles.eyebrow}>{eyebrow}</p><h1 id="workspace-entry-title">{title}</h1><p className={styles.lead}>{lead}</p>{children}</div><aside className={styles.summary} aria-label="안전한 시작 원칙"><h2>진행 상태</h2><div className={styles.summarySteps}><div className={`${styles.summaryStep} ${styles.current}`}><span className={styles.stepNumber}>1</span><div><strong>시작 방법</strong><small>회사 만들기 또는 합류</small></div></div><div className={styles.summaryStep}><span className={styles.stepNumber}>2</span><div><strong>승인 확인</strong><small>승인 전 접근 권한 없음</small></div></div><div className={styles.summaryStep}><span className={styles.stepNumber}>3</span><div><strong>회사로 이동</strong><small>현재 멤버십을 다시 확인</small></div></div></div><p className={styles.safety}>플랫폼 운영자는 고객 회사에 자동 접근하지 않아요. 회사에는 보호된 대표가 정확히 한 명 있어요.</p></aside></div></section></main>;
}
