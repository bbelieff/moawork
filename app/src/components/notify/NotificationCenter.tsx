"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { NotifySnapshot } from "@/lib/notify/server";
import {
  workspaceBaseFromPathname,
  workspaceHref,
} from "@/components/shell/workspace-href";
import {
  centerItems,
  EMPTY_FILTERS,
  filterCenterItems,
  requestReadAll,
  ROUTES,
  TYPES,
  type CenterFilters,
} from "./center-model";
import styles from "./notification-center.module.css";
export function NotificationCenter({
  snapshot,
  readAll = requestReadAll,
}: {
  snapshot: NotifySnapshot;
  readAll?: () => Promise<void>;
}) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    error: boolean;
    text: string;
  } | null>(null);
  const router = useRouter();
  const base = workspaceBaseFromPathname(usePathname()) ?? undefined;
  const href = (path: string) => workspaceHref(base, path);
  const items = centerItems(snapshot);
  const shown = filterCenterItems(items, filters);
  const routes = Object.keys(ROUTES);
  const set = <K extends keyof CenterFilters>(
    key: K,
    value: CenterFilters[K],
  ) => setFilters((old) => ({ ...old, [key]: value }));
  async function markRead() {
    setBusy(true);
    setFeedback(null);
    try {
      await readAll();
      router.refresh();
      setFeedback({
        error: false,
        text: "모두 읽음으로 표시했어요. 처리할 일은 완료할 때까지 남아요.",
      });
    } catch (error) {
      setFeedback({
        error: true,
        text:
          error instanceof Error
            ? error.message
            : "읽음 처리에 실패했어요. 다시 시도해 주세요.",
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.center}>
      <header>
        <h1>알림</h1>
        <p>받은 알림을 경로와 조건으로 골라 보세요.</p>
      </header>
      <section className={styles.filters} aria-label="알림 필터">
        <label>
          검색
          <input
            placeholder="알림 검색"
            value={filters.search}
            onChange={(e) => set("search", e.target.value)}
          />
        </label>
        <label>
          받은 경로
          <select
            value={filters.route}
            onChange={(e) => set("route", e.target.value)}
          >
            <option value="">전체</option>
            {routes.map((r) => (
              <option key={r} value={r}>
                {ROUTES[r]}
              </option>
            ))}
          </select>
        </label>
        <label>
          종류
          <select
            value={filters.type}
            onChange={(e) => set("type", e.target.value)}
          >
            <option value="">전체</option>
            {Array.from(new Set(items.map((n) => n.type))).map((t) => (
              <option key={t} value={t}>
                {TYPES[t] ?? "기타 활동"}
              </option>
            ))}
          </select>
        </label>
        <label>
          보낸 사람
          <select
            value={filters.actor}
            onChange={(e) => set("actor", e.target.value)}
          >
            <option value="">전체</option>
            {Array.from(new Set(items.map((n) => n.actor))).map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label>
          회사·내용
          <input
            placeholder="제목·내용에서 검색"
            value={filters.company}
            onChange={(e) => set("company", e.target.value)}
          />
        </label>
        <label>
          시작일
          <input
            type="date"
            value={filters.from}
            onChange={(e) => set("from", e.target.value)}
          />
        </label>
        <label>
          종료일
          <input
            type="date"
            min={filters.from}
            value={filters.to}
            onChange={(e) => set("to", e.target.value)}
          />
        </label>
        <button
          type="button"
          aria-pressed={filters.unread}
          onClick={() => set("unread", !filters.unread)}
        >
          안 읽음만
        </button>
        <button type="button" onClick={() => setFilters(EMPTY_FILTERS)}>
          초기화
        </button>
        <span className={styles.count}>{shown.length}건</span>
        <button
          type="button"
          disabled={busy || !!snapshot.loadError || !items.length}
          onClick={() => void markRead()}
        >
          {busy ? "읽음 처리 중…" : "모두 읽음"}
        </button>
      </section>
      <p className={styles.note}>
        최근 불러온 내 알림과 회사 소식 안에서 검색합니다. 회사·내용은 제목과
        본문을 검색하며, 기간은 한국 시간 기준입니다.
      </p>
      {snapshot.loadError ? (
        <p role="alert" className={styles.feedback}>
          알림 일부를 불러오지 못했어요.{" "}
          <button type="button" onClick={() => router.refresh()}>
            다시 불러오기
          </button>
        </p>
      ) : null}
      {feedback ? (
        <p
          role={feedback.error ? "alert" : "status"}
          className={styles.feedback}
        >
          {feedback.text}
        </p>
      ) : null}
      <div className={styles.layout}>
        <section className={styles.pane} aria-label="받은 알림">
          {shown.length === 0 ? (
            <p className={styles.empty}>
              {snapshot.loadError
                ? "알림을 다시 불러와 주세요."
                : items.length
                  ? "선택한 조건에 맞는 알림이 없어요."
                  : "아직 받은 알림이 없어요."}
            </p>
          ) : (
            routes.map((route) => {
              const group = shown.filter((n) => n.route === route);
              return group.length ? (
                <section key={route}>
                  <h2 className={styles.groupTitle}>
                    {route === "direct" ? "직속에서 바로" : route === "hierarchy" ? "계통을 타고 올라옴" : ROUTES[route]}
                    <span />
                    <small>{group.length}</small>
                  </h2>
                  {group.map((n) => (
                    <article
                      key={n.id}
                      className={styles.row}
                      style={{
                        borderLeftColor:
                          n.route === "mine"
                            ? "var(--mw-primary)"
                            : n.distance <= 1
                              ? "var(--mw-people)"
                              : n.distance === 2
                                ? "color-mix(in srgb, var(--mw-people) 55%, transparent)"
                                : "color-mix(in srgb, var(--mw-people) 30%, transparent)",
                      }}
                    >
                      <span
                        className={styles.dot}
                        aria-label={
                          n.read === undefined
                            ? "읽음 여부 미확인"
                            : n.read
                              ? "읽음"
                              : "안 읽음"
                        }
                      >
                        {n.read === undefined ? "−" : n.read ? "○" : "●"}
                      </span>
                      <div className={styles.content}>
                        <strong>{n.title}</strong>
                        {n.body ? <p>{n.body}</p> : null}
                        <div className={styles.meta}>
                          <span>{ROUTES[n.route]}</span>
                          {n.path ? <span>{n.path}</span> : null}
                          {n.action ? <b>처리 필요</b> : null}
                          <time dateTime={n.at}>
                            {new Date(n.at).toLocaleString("ko-KR", {
                              timeZone: "Asia/Seoul",
                              month: "numeric",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </time>
                        </div>
                      </div>
                      {n.href ? (
                        <Link className={styles.go} href={href(n.href)}>
                          보러 가기
                        </Link>
                      ) : (
                        <span className={styles.note}>연결된 화면 없음</span>
                      )}
                    </article>
                  ))}
                </section>
              ) : null;
            })
          )}
        </section>
        <aside className={styles.aside}>
          <section className={styles.pane}>
            <h2 className={styles.sideTitle}>받은 경로</h2>
            {routes.length ? (
              routes.map((r) => (
                <button
                  type="button"
                  className={styles.route}
                  key={r}
                  aria-pressed={filters.route === r}
                  onClick={() => set("route", filters.route === r ? "" : r)}
                >
                  <span>{ROUTES[r]}</span>
                  <b>{items.filter((n) => n.route === r).length}</b>
                </button>
              ))
            ) : (
              <p className={styles.note}>
                알림이 도착하면 받은 경로가 표시돼요.
              </p>
            )}
            <p className={styles.note}>현재 불러온 알림 기준입니다.</p>
          </section>
          <section className={styles.pane}>
            <h2 className={styles.sideTitle}>설정</h2>
            <Link className={styles.setting} href={href("/account")}>
              내 프로필
            </Link>
            <Link
              className={styles.setting}
              href={href("/settings/members?view=rules")}
            >
              알림 규칙
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
