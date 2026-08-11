"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { NotifySnapshot } from "@/lib/notify/server";
import { NOTIFY_TABS, type NotifyTab } from "@/lib/notify/types";
import { notificationTargetHref } from "@/lib/notify/highlight";
import { NotificationRoute } from "./NotificationRoute";
import {
  PANEL_HEIGHT_CLASS,
  PANEL_SCROLL_CLASS,
  PANEL_WIDTH_CLASS,
  TEXT_CLAMP_CLASS,
} from "./layout";

/**
 * 소식창 — 탭 2개(내 알림 / 회사 소식).
 * 375px 에서도 깨지지 않도록 뷰포트 기준 폭을 함께 건다.
 */
export function NotificationPanel({
  snapshot,
  onClose,
  onChanged,
}: {
  snapshot: NotifySnapshot;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  // 기본 탭 = 내 알림(행동 필요).
  const [tab, setTab] = useState<NotifyTab>(NOTIFY_TABS.mine);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const markAllRead = async () => {
    setBusy(true);
    try {
      // 점만 지운다 — 숫자는 서버에서도 유지된다.
      await fetch("/api/notifications/read-all", { method: "POST" });
      await onChanged();
      router.refresh();
    } catch {
      // 실패해도 조용히 — 오류 팝업 금지.
    } finally {
      setBusy(false);
    }
  };

  /** 항목 클릭 = 딥링크 이동. 행동 필요 항목은 이동과 함께 '했다' 처리한다. */
  const go = async (
    href: string | null,
    resolveId: string | null,
    notificationId?: string,
  ) => {
    if (resolveId) {
      try {
        await fetch(`/api/notifications/${resolveId}/resolve`, { method: "POST" });
      } catch {
        /* 조용히 */
      }
    }
    onClose();
    if (href) router.push(notificationId ? notificationTargetHref(href, notificationId) : href);
    void onChanged();
  };

  return (
    <div
      role="dialog"
      aria-label="알림"
      className={`absolute right-0 z-50 mt-2 flex ${PANEL_HEIGHT_CLASS} ${PANEL_WIDTH_CLASS} flex-col overflow-hidden rounded-2xl border shadow-lg`}
      style={{ background: "var(--mw-card)", borderColor: "var(--mw-line)" }}
    >
      <div className="flex shrink-0 border-b" style={{ borderColor: "var(--mw-line)" }}>
        <TabButton active={tab === NOTIFY_TABS.mine} onClick={() => setTab(NOTIFY_TABS.mine)}>
          내 알림
        </TabButton>
        <TabButton active={tab === NOTIFY_TABS.org} onClick={() => setTab(NOTIFY_TABS.org)}>
          회사 소식
        </TabButton>
      </div>

      <div className={PANEL_SCROLL_CLASS}>
        {tab === NOTIFY_TABS.mine ? (
          snapshot.mine.length === 0 ? (
            <Empty>새 알림이 없습니다</Empty>
          ) : (
            <ul>
              {snapshot.mine.map(({ notification: n, href }) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => void go(href, n.is_action ? n.id : null, n.target_id ?? n.id)}
                    className="flex w-full items-start gap-2 border-b px-3 py-2.5 text-left transition-colors hover:opacity-80"
                    style={{ borderColor: "var(--mw-line)" }}
                  >
                    <span aria-hidden className="mt-[1px] shrink-0">
                      {n.is_action ? "🔴" : "•"}
                    </span>
                    <span className={TEXT_CLAMP_CLASS}>
                      <span className="block truncate text-[13px] font-semibold">{n.title}</span>
                      {n.body ? (
                        <span className="block truncate text-[12px] opacity-70">{n.body}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : snapshot.org.length === 0 ? (
          <Empty>회사 소식이 없습니다</Empty>
        ) : (
          <ul>
            {snapshot.org.map(({ group, line, href, recipient }) => (
              <li key={group.head.id}>
                <button
                  type="button"
                  onClick={() => void go(href, null)}
                  className="flex w-full items-start gap-2 border-b px-3 py-2.5 text-left transition-colors hover:opacity-80"
                  style={{ borderColor: "var(--mw-line)" }}
                >
                  <span aria-hidden className="mt-[1px] shrink-0">
                    {line.icon}
                  </span>
                  <span className={`${TEXT_CLAMP_CLASS} text-[13px]`}>
                    <NotificationRoute recipient={recipient} />
                    {/* 주어를 반드시 먼저 보여준다. */}
                    <span className="font-semibold">{line.actor}</span>
                    <span>님이 {line.verb}</span>
                    <span className="block text-[11.5px] opacity-60">
                      {line.where ? `${line.where} · ` : ""}
                      {line.when}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div
        className="flex shrink-0 items-center justify-between gap-2 border-t px-3 py-2"
        style={{ borderColor: "var(--mw-line)" }}
      >
        <button
          type="button"
          onClick={() => void markAllRead()}
          disabled={busy}
          className="rounded-lg px-2 py-1 text-[12px] font-semibold disabled:opacity-50"
        >
          모두 읽음
        </button>
        <Link
          href="/settings/notifications"
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-[12px] font-semibold opacity-80"
        >
          전체 보기 →
        </Link>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="flex-1 px-3 py-2 text-[13px] font-semibold transition-opacity"
      style={{
        opacity: active ? 1 : 0.55,
        borderBottom: active ? "2px solid var(--mw-people, #f2704e)" : "2px solid transparent",
      }}
    >
      {children}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-8 text-center text-[12.5px] opacity-60">{children}</p>;
}
