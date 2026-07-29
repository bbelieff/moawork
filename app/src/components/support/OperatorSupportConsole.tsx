"use client";

/**
 * 운영자 지원 콘솔 — T08 (/platform/지원 본문).
 *
 * 문의 목록 · 스레드 뷰 · [위임 요청 보내기] · 위임 상태 표시.
 *
 * "위임 요청 보내기"는 **권한을 스스로 얻는 버튼이 아니다** — 고객에게 열어달라고
 * 부탁하는 메시지를 스레드에 남길 뿐이다. 실제 개시는 고객만 할 수 있다(기본 경로).
 */

import { useEffect, useState } from "react";
import type { AccessGrant, SupportMessage, SupportThread } from "@/lib/support/types";
import { formatRemaining, grantRemainingMs } from "@/lib/support/types";
import styles from "./support.module.css";

export interface ThreadDetail {
  thread: SupportThread;
  messages: SupportMessage[];
}

const GRANT_REQUEST_TEMPLATE =
  "확인을 위해 화면을 잠깐 열어주실 수 있을까요?\n" +
  "우측 하단 💬 버튼 → 🔓 화면 봐달라고 하기 → 기간(2시간) · 보기만 을 선택해 주세요.\n" +
  "여신 뒤에는 화면 상단 배너에서 언제든 중단하실 수 있습니다.";

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

export function OperatorSupportConsole({
  threads,
  initialDetail,
}: {
  threads: SupportThread[];
  initialDetail: ThreadDetail | null;
}) {
  const [detail, setDetail] = useState<ThreadDetail | null>(initialDetail);
  const [grant, setGrant] = useState<AccessGrant | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const orgId = detail?.thread.org_id ?? null;

  // 위임 상태 표시 — 선택한 문의의 조직에 지금 열린 위임이 있는지.
  // 갱신은 비동기 콜백에서만 한다(effect 본문에서 동기 setState 금지).
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await api<{ active: AccessGrant | null }>(
          `/api/support/grants?org=${encodeURIComponent(orgId)}`,
        );
        if (!cancelled) setGrant(data.active);
      } catch {
        if (!cancelled) setGrant(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const load = async (id: string) => {
    setError(null);
    setBusy(true);
    try {
      setDetail(await api<ThreadDetail>(`/api/support/threads/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오지 못했습니다");
    } finally {
      setBusy(false);
    }
  };

  const send = async (body: string) => {
    if (!detail || body.trim() === "") return;
    setError(null);
    setBusy(true);
    try {
      await api(`/api/support/threads/${detail.thread.id}`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      setReply("");
      await load(detail.thread.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "보내지 못했습니다");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        display: "grid",
        gap: 16,
        gridTemplateColumns: "minmax(0, 260px) minmax(0, 1fr)",
        alignItems: "start",
      }}
    >
      <section>
        <h2 style={{ fontSize: 13, color: "var(--mw-sub)", marginBottom: 8 }}>
          문의 {threads.length}건
        </h2>
        <div className={styles.threadList}>
          {threads.length === 0 ? (
            <p className={styles.note}>들어온 문의가 없습니다.</p>
          ) : (
            threads.map((t) => (
              <button
                key={t.id}
                type="button"
                className={styles.threadRow}
                onClick={() => load(t.id)}
                aria-current={detail?.thread.id === t.id}
              >
                <span className={styles.threadSubject}>{t.subject}</span>
                <small className={styles.menuSub}>
                  {t.status === "answered"
                    ? "답변함"
                    : t.status === "closed"
                      ? "종료"
                      : "대기"}
                </small>
              </button>
            ))
          )}
        </div>
      </section>

      <section>
        {error ? <p className={styles.error}>{error}</p> : null}
        {!detail ? (
          <p className={styles.note}>왼쪽에서 문의를 선택하세요.</p>
        ) : (
          <>
            <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
              {detail.thread.subject}
            </h2>

            {/* 위임 상태 표시 */}
            <p
              className={styles.note}
              style={{ marginBottom: 10 }}
              role="status"
              aria-live="polite"
            >
              {grant ? (
                <>
                  🔓 <b>위임 열림</b> · {grant.mode === "write" ? "보기+고치기" : "보기만"} ·
                  남은 시간 {formatRemaining(grantRemainingMs(grant))}
                </>
              ) : (
                <>🔒 위임 없음 — 고객이 열어주어야 화면을 볼 수 있습니다.</>
              )}
            </p>

            {/* 진단 컨텍스트 — 고객사명·대표자명·연락처·금액은 애초에 들어오지 않는다. */}
            <p className={styles.note} style={{ marginBottom: 12 }}>
              {Object.entries(detail.thread.diag)
                .map(([k, v]) => `${k}: ${v}`)
                .join(" · ") || "진단 정보 없음"}
            </p>

            {detail.messages.map((m) => (
              <div
                key={m.id}
                className={`${styles.msg} ${
                  m.author_kind === "operator" ? styles.msgOperator : styles.msgCustomer
                }`}
              >
                <small className={styles.msgWho}>
                  {m.author_kind === "operator" ? "운영자" : "고객"}
                </small>
                {m.body}
              </div>
            ))}

            <label className={styles.field}>
              <span className={styles.label}>답변</span>
              <textarea
                className={styles.textarea}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
              />
            </label>
            <button
              type="button"
              className={styles.primary}
              onClick={() => send(reply)}
              disabled={busy || reply.trim() === ""}
            >
              {busy ? "보내는 중…" : "답변 보내기"}
            </button>
            <button
              type="button"
              className={styles.ghost}
              onClick={() => send(GRANT_REQUEST_TEMPLATE)}
              disabled={busy}
            >
              🔓 위임 요청 보내기
            </button>
            <p className={styles.note}>
              위임은 고객이 직접 열어야 시작됩니다. 운영자가 임의로 들어갈 수 없습니다.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
