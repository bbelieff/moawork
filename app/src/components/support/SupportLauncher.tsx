"use client";

/**
 * 플로팅 지원 버튼 + 시트 — T08.
 *
 * 우측 하단 지름 52px. 미읽음이 있으면 숫자 뱃지(숫자 = 내가 볼 일).
 * 모바일은 안전영역 여백을 두고, 열면 풀스크린 시트(sm 이상은 우하단 패널).
 * 메뉴 3개: 💬 문의 남기기 · 🔓 화면 봐달라고 하기 · 📖 도움말.
 *
 * 색은 Work Blue 계열. People Coral 은 담당자·멘션·알림 전용이라 버튼에 쓰지 않는다.
 */

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { MemberRole } from "@/lib/types";
import { isManager } from "@/lib/auth/roles";
import {
  DEFAULT_GRANT_DURATION_ID,
  GRANT_DURATIONS,
  type AccessGrant,
  type AccessGrantMode,
  type SupportMessage,
  type SupportThread,
} from "@/lib/support/types";
import styles from "./support.module.css";

type View = "menu" | "threads" | "thread" | "new" | "grant" | "help";

export interface SupportLauncherProps {
  role: MemberRole;
  orgSlug: string | null;
  appVersion: string;
  /** 서버가 계산한 초기 뱃지 숫자. 열고 닫을 때마다 다시 읽는다. */
  initialUnread: number;
  /** 현재 살아 있는 위임(없으면 null) — 메뉴 표시를 바꾼다. */
  activeGrant: AccessGrant | null;
}

async function api<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  const body = (await res.json().catch(() => null)) as
    | { data?: T; error?: string }
    | null;
  if (!res.ok) throw new Error(body?.error ?? "요청에 실패했습니다");
  return body?.data as T;
}

export function SupportLauncher({
  role,
  orgSlug,
  appVersion,
  initialUnread,
  activeGrant,
}: SupportLauncherProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("menu");
  const [unread, setUnread] = useState(initialUnread);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [thread, setThread] = useState<{
    thread: SupportThread;
    messages: SupportMessage[];
  } | null>(null);

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState("");

  const [duration, setDuration] = useState(DEFAULT_GRANT_DURATION_ID);
  const [mode, setMode] = useState<AccessGrantMode>("read");
  const [reason, setReason] = useState("");

  // 서버가 새 뱃지 숫자를 내려주면(router.refresh) 그 값이 이긴다.
  // effect 대신 "렌더 중 상태 조정" 패턴 — cascading render 를 만들지 않는다.
  const [seenUnread, setSeenUnread] = useState(initialUnread);
  if (seenUnread !== initialUnread) {
    setSeenUnread(initialUnread);
    setUnread(initialUnread);
  }

  // 멤버는 "보기+고치기"를 고를 수 없다 — 서버가 읽기 전용으로 되돌리므로 UI 도 막는다.
  const canWrite = isManager(role);

  const refreshBadge = useCallback(async () => {
    try {
      const data = await api<{ unread: number }>("/api/support/notifications");
      setUnread(data.unread);
    } catch {
      // 뱃지 갱신 실패는 조용히 무시(위젯이 화면을 막으면 안 된다).
    }
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setView("menu");
    setError(null);
    void refreshBadge();
  }, [refreshBadge]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const openThreads = async () => {
    setError(null);
    setBusy(true);
    try {
      setThreads(await api<SupportThread[]>("/api/support/threads"));
      setView("threads");
      // 목록을 열면 내가 볼 일을 처리한 것으로 본다.
      await api("/api/support/notifications", { method: "POST", body: "{}" });
      await refreshBadge();
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오지 못했습니다");
    } finally {
      setBusy(false);
    }
  };

  const openThread = async (id: string) => {
    setError(null);
    setBusy(true);
    try {
      setThread(
        await api<{ thread: SupportThread; messages: SupportMessage[] }>(
          `/api/support/threads/${id}`,
        ),
      );
      setView("thread");
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오지 못했습니다");
    } finally {
      setBusy(false);
    }
  };

  const submitThread = async () => {
    setError(null);
    setBusy(true);
    try {
      // 진단용 컨텍스트만 담는다. 고객사명·대표자명·연락처·금액은 넣지 않는다.
      const diag = {
        path: pathname,
        org_slug: orgSlug ?? undefined,
        role,
        app_version: appVersion,
        browser:
          typeof navigator === "undefined" ? undefined : navigator.userAgent.slice(0, 200),
      };
      const created = await api<{ thread: SupportThread }>("/api/support/threads", {
        method: "POST",
        body: JSON.stringify({ subject, body, diag }),
      });
      setSubject("");
      setBody("");
      await openThread(created.thread.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "보내지 못했습니다");
    } finally {
      setBusy(false);
    }
  };

  const submitReply = async () => {
    if (!thread) return;
    setError(null);
    setBusy(true);
    try {
      await api(`/api/support/threads/${thread.thread.id}`, {
        method: "POST",
        body: JSON.stringify({ body: reply }),
      });
      setReply("");
      await openThread(thread.thread.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "보내지 못했습니다");
    } finally {
      setBusy(false);
    }
  };

  const submitGrant = async () => {
    setError(null);
    setBusy(true);
    try {
      await api<AccessGrant>("/api/support/grants", {
        method: "POST",
        body: JSON.stringify({ duration, mode, reason }),
      });
      setReason("");
      close();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "권한을 열지 못했습니다");
    } finally {
      setBusy(false);
    }
  };

  const stopGrant = async () => {
    if (!activeGrant) return;
    setError(null);
    setBusy(true);
    try {
      await api(`/api/support/grants/${activeGrant.id}`, { method: "DELETE" });
      close();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "중단하지 못했습니다");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={styles.launcher}
        aria-label={unread > 0 ? `지원 · 확인할 항목 ${unread}건` : "지원"}
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {open ? "✕" : "💬"}
        {!open && unread > 0 ? (
          <span className={styles.badge}>{unread > 99 ? "99+" : unread}</span>
        ) : null}
      </button>

      {open ? (
        <>
          <button
            type="button"
            className={styles.scrim}
            aria-label="닫기"
            onClick={close}
          />
          <section
            className={styles.sheet}
            role="dialog"
            aria-modal="true"
            aria-label="지원"
          >
            <header className={styles.sheetHead}>
              {view !== "menu" ? (
                <button
                  type="button"
                  className={styles.back}
                  onClick={() => setView(view === "thread" ? "threads" : "menu")}
                >
                  ←
                </button>
              ) : null}
              <h2 className={styles.sheetTitle}>
                {view === "menu"
                  ? "무엇을 도와드릴까요?"
                  : view === "threads"
                    ? "내 문의"
                    : view === "thread"
                      ? (thread?.thread.subject ?? "문의")
                      : view === "new"
                        ? "문의 남기기"
                        : view === "grant"
                          ? "화면 봐달라고 하기"
                          : "도움말"}
              </h2>
              <button
                type="button"
                className={styles.sheetClose}
                aria-label="닫기"
                onClick={close}
              >
                ✕
              </button>
            </header>

            <div className={styles.sheetBody}>
              {error ? <p className={styles.error}>{error}</p> : null}

              {view === "menu" ? (
                <div className={styles.menu}>
                  <button
                    type="button"
                    className={styles.menuItem}
                    onClick={() => setView("new")}
                  >
                    <span className={styles.menuGlyph} aria-hidden>
                      💬
                    </span>
                    <span>
                      문의 남기기
                      <small className={styles.menuSub}>담당자가 확인 후 답변합니다</small>
                    </span>
                  </button>

                  <button
                    type="button"
                    className={styles.menuItem}
                    onClick={() => setView("grant")}
                  >
                    <span className={styles.menuGlyph} aria-hidden>
                      🔓
                    </span>
                    <span>
                      화면 봐달라고 하기
                      <small className={styles.menuSub}>
                        {activeGrant
                          ? "지금 열려 있어요 — 중단할 수 있습니다"
                          : "정해진 시간만 내 화면을 열어줍니다"}
                      </small>
                    </span>
                  </button>

                  <button
                    type="button"
                    className={styles.menuItem}
                    onClick={() => setView("help")}
                  >
                    <span className={styles.menuGlyph} aria-hidden>
                      📖
                    </span>
                    <span>
                      도움말
                      <small className={styles.menuSub}>자주 묻는 질문</small>
                    </span>
                  </button>

                  <button
                    type="button"
                    className={styles.menuItem}
                    onClick={openThreads}
                    disabled={busy}
                  >
                    <span className={styles.menuGlyph} aria-hidden>
                      📨
                    </span>
                    <span>
                      내 문의 보기
                      <small className={styles.menuSub}>지난 문의와 답변</small>
                    </span>
                    {unread > 0 ? <span className={styles.menuCount}>{unread}</span> : null}
                  </button>
                </div>
              ) : null}

              {view === "new" ? (
                <>
                  <label className={styles.field}>
                    <span className={styles.label}>제목</span>
                    <input
                      className={styles.input}
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="무엇이 문제인가요?"
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>내용</span>
                    <textarea
                      className={styles.textarea}
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      placeholder="어떤 화면에서 무엇을 하려다 막혔는지 적어주세요"
                    />
                  </label>
                  <p className={styles.note}>
                    진단을 위해 <b>현재 경로 · 워크스페이스 · 역할 · 앱 버전 · 브라우저</b>가
                    함께 전달됩니다. 고객사명·대표자명·연락처·금액은 <b>전달되지 않습니다</b>.
                  </p>
                  <button
                    type="button"
                    className={styles.primary}
                    onClick={submitThread}
                    disabled={busy || subject.trim() === "" || body.trim() === ""}
                  >
                    {busy ? "보내는 중…" : "보내기"}
                  </button>
                </>
              ) : null}

              {view === "threads" ? (
                <div className={styles.threadList}>
                  {threads.length === 0 ? (
                    <p className={styles.note}>아직 문의가 없습니다.</p>
                  ) : (
                    threads.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className={styles.threadRow}
                        onClick={() => openThread(t.id)}
                      >
                        <span className={styles.threadSubject}>{t.subject}</span>
                        <small className={styles.menuSub}>
                          {t.status === "answered"
                            ? "답변 도착"
                            : t.status === "closed"
                              ? "종료됨"
                              : "확인 중"}
                        </small>
                      </button>
                    ))
                  )}
                </div>
              ) : null}

              {view === "thread" && thread ? (
                <>
                  {thread.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`${styles.msg} ${
                        m.author_kind === "operator"
                          ? styles.msgOperator
                          : styles.msgCustomer
                      }`}
                    >
                      <small className={styles.msgWho}>
                        {m.author_kind === "operator" ? "운영자" : "나"}
                      </small>
                      {m.body}
                    </div>
                  ))}
                  {thread.thread.status !== "closed" ? (
                    <>
                      <label className={styles.field}>
                        <span className={styles.label}>답장</span>
                        <textarea
                          className={styles.textarea}
                          value={reply}
                          onChange={(e) => setReply(e.target.value)}
                        />
                      </label>
                      <button
                        type="button"
                        className={styles.primary}
                        onClick={submitReply}
                        disabled={busy || reply.trim() === ""}
                      >
                        {busy ? "보내는 중…" : "보내기"}
                      </button>
                    </>
                  ) : (
                    <p className={styles.note}>종료된 문의입니다.</p>
                  )}
                </>
              ) : null}

              {view === "grant" ? (
                activeGrant ? (
                  <>
                    <p className={styles.note}>
                      지금 운영자가 내 화면을 보고 있습니다.
                      <br />
                      범위: {activeGrant.mode === "write" ? "보기+고치기" : "보기만"}
                    </p>
                    <button
                      type="button"
                      className={styles.primary}
                      onClick={stopGrant}
                      disabled={busy}
                    >
                      {busy ? "중단 중…" : "지금 중단"}
                    </button>
                  </>
                ) : (
                  <>
                    <div className={styles.field}>
                      <span className={styles.label}>기간</span>
                      <div className={styles.chips}>
                        {GRANT_DURATIONS.map((d) => (
                          <button
                            key={d.id}
                            type="button"
                            className={`${styles.chip} ${
                              duration === d.id ? styles.chipOn : ""
                            }`}
                            aria-pressed={duration === d.id}
                            onClick={() => setDuration(d.id)}
                          >
                            {d.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className={styles.field}>
                      <span className={styles.label}>범위</span>
                      <div className={styles.chips}>
                        <button
                          type="button"
                          className={`${styles.chip} ${mode === "read" ? styles.chipOn : ""}`}
                          aria-pressed={mode === "read"}
                          onClick={() => setMode("read")}
                        >
                          보기만
                        </button>
                        <button
                          type="button"
                          className={`${styles.chip} ${mode === "write" ? styles.chipOn : ""}`}
                          aria-pressed={mode === "write"}
                          onClick={() => setMode("write")}
                          disabled={!canWrite}
                          title={canWrite ? undefined : "보기+고치기는 소유자·관리자만 선택할 수 있습니다"}
                        >
                          보기+고치기
                        </button>
                      </div>
                      {!canWrite ? (
                        <p className={styles.note}>
                          멤버가 여는 권한은 <b>보기 전용</b>으로 고정됩니다.
                        </p>
                      ) : null}
                    </div>

                    <label className={styles.field}>
                      <span className={styles.label}>사유(선택)</span>
                      <input
                        className={styles.input}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="예: 정산 화면이 안 열려요"
                      />
                    </label>

                    <p className={styles.note}>
                      여는 즉시 적용되고 <b>소유자에게 알림</b>이 갑니다. 화면 상단 배너에서
                      언제든 중단할 수 있으며, 홈택스 위임·수집 서류는 <b>열리지 않습니다</b>.
                    </p>
                    <button
                      type="button"
                      className={styles.primary}
                      onClick={submitGrant}
                      disabled={busy}
                    >
                      {busy ? "여는 중…" : "지금 열어주기"}
                    </button>
                  </>
                )
              ) : null}

              {view === "help" ? (
                <>
                  <p className={styles.note}>
                    <b>화면 봐달라고 하기</b>는 정해진 시간 동안만 운영자가 내 워크스페이스를
                    볼 수 있게 여는 기능입니다. 기본은 <b>2시간 · 보기만</b>이고, 여는
                    동안에는 화면 위쪽에 배너가 계속 보입니다.
                  </p>
                  <p className={styles.note}>
                    운영자가 무엇을 봤는지는 모두 기록으로 남습니다. 홈택스 위임·수집 서류는
                    위임 중에도 <b>절대 열리지 않습니다</b>.
                  </p>
                  <p className={styles.note}>
                    내 담당 건만 보도록 설정된 멤버가 열면, 운영자도 <b>그 멤버 담당 건만</b>
                    볼 수 있습니다.
                  </p>
                  <button type="button" className={styles.ghost} onClick={() => setView("new")}>
                    그래도 문의할래요
                  </button>
                </>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}
