import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { loadNotifySnapshot } from "@/lib/notify/server";

/**
 * 전체 보기 — 패널의 [전체 보기 →] 목적지.
 * 패널과 같은 스냅샷을 쓰되 목록만 넓게 보여준다.
 */
export default async function NotificationsPage() {
  const ctx = await getSession();
  const snapshot = await loadNotifySnapshot(ctx);

  return (
    <div className="mx-auto max-w-3xl px-1 py-2">
      <h1 className="mb-4 text-[19px] font-bold">알림</h1>

      <section className="mb-7">
        <h2 className="mb-2 text-[14px] font-semibold opacity-80">내 알림</h2>
        {snapshot.mine.length === 0 ? (
          <p className="rounded-xl border px-3 py-6 text-center text-[13px] opacity-60"
             style={{ borderColor: "var(--mw-line)" }}>
            새 알림이 없습니다
          </p>
        ) : (
          <ul className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--mw-line)" }}>
            {snapshot.mine.map(({ notification: n, href }) => (
              <li key={n.id} className="border-b last:border-b-0" style={{ borderColor: "var(--mw-line)" }}>
                <Link
                  href={href ?? "#"}
                  className="flex items-start gap-2 px-3 py-2.5 text-[13px] hover:opacity-80"
                >
                  <span aria-hidden>{n.is_action ? "🔴" : "•"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{n.title}</span>
                    {n.body ? <span className="block opacity-70">{n.body}</span> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-[14px] font-semibold opacity-80">회사 소식</h2>
        {snapshot.org.length === 0 ? (
          <p className="rounded-xl border px-3 py-6 text-center text-[13px] opacity-60"
             style={{ borderColor: "var(--mw-line)" }}>
            회사 소식이 없습니다
          </p>
        ) : (
          <ul className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--mw-line)" }}>
            {snapshot.org.map(({ group, line, href }) => (
              <li key={group.head.id} className="border-b last:border-b-0" style={{ borderColor: "var(--mw-line)" }}>
                <Link href={href ?? "#"} className="flex items-start gap-2 px-3 py-2.5 text-[13px] hover:opacity-80">
                  <span aria-hidden>{line.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">{line.actor}</span>
                    <span>님이 {line.verb}</span>
                    <span className="block text-[11.5px] opacity-60">
                      {line.where ? `${line.where} · ` : ""}
                      {line.when}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
