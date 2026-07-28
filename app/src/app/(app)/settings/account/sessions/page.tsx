import { AccountNav } from "@/components/account/AccountNav";
import { AccountState } from "@/components/account/AccountState";
import { CurrentSessionLogout } from "@/components/account/CurrentSessionLogout";
import styles from "@/components/account/account.module.css";
import { getSession } from "@/lib/auth/session";
import { listMyMemberSessions } from "@/lib/account/memberAccountOps";
import { revokeAllSessions, revokeCurrentSession } from "../actions";

const NAV_ITEMS = [
  { key: "account", label: "내 정보", href: "/account" },
  {
    key: "workspace",
    label: "회사와 팀",
    href: "/settings/account#workspace",
  },
  {
    key: "sessions",
    label: "로그인 기기",
    href: "/settings/account/sessions",
  },
  {
    key: "privacy",
    label: "개인정보",
    href: "/settings/account/privacy",
  },
] as const;

export default async function AccountSessionsPage() {
  const ctx = await getSession();
  let sessions: Awaited<ReturnType<typeof listMyMemberSessions>> = [];
  let unavailable = false;
  // The 011 RPC accepts a nullable UUID when the request has no registered
  // current-session identifier yet. Keep that server contract at this call
  // boundary instead of inventing a client-side session ID.
  const listSessions = listMyMemberSessions as (
    orgId: string,
    currentSessionId: string | null,
  ) => ReturnType<typeof listMyMemberSessions>;
  try { sessions = await listSessions(ctx.org.id, null); } catch { unavailable = true; }

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <h1>로그인 기기</h1>
        <p>지금 사용하는 브라우저의 로그인을 안전하게 끝낼 수 있어요.</p>
      </header>
      <AccountNav current="sessions" items={NAV_ITEMS} />
      {unavailable ? <AccountState kind="blocked" title="세션 정보를 불러오지 못했습니다" message="잠시 후 다시 시도해 주세요." /> : <section aria-label="로그인 세션"><p>활성 세션 {sessions.length}개</p>{sessions.map((session) => <form action={revokeCurrentSession} key={session.id}><input type="hidden" name="sessionId" value={session.id} /><p>{session.current_session ? "현재 세션" : "다른 세션"} · 마지막 사용 {session.last_seen_at}</p><button type="submit">이 세션 로그아웃</button></form>)}</section>}
      <div className={styles.actionRow}>
        <CurrentSessionLogout />
        {!unavailable && <form action={revokeAllSessions}><button type="submit">모든 기기에서 로그아웃</button></form>}
      </div>
    </div>
  );
}
