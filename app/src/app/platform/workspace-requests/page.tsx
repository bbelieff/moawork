import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import { ApprovalQueue } from "@/components/workspace-entry/ApprovalQueue";
import styles from "@/components/workspace-entry/workspace-entry.module.css";
import { loadWorkspaceRoutingSnapshot } from "@/lib/auth/workspace-entry-server";
import { loadWorkspaceEntryContext } from "@/lib/workspace-entry/server";
import { getMySupportReadScope } from "@/lib/account/memberAccountOps";

export default async function PlatformWorkspaceRequestsPage() {
  const routing = await loadWorkspaceRoutingSnapshot();
  if (routing.kind === "unauthenticated") redirect("/login?next=/platform/workspace-requests");
  const context = await loadWorkspaceEntryContext();
  if (context.kind === "error" || !context.isPlatformAdmin) redirect("/workspace-entry?error=permission");
  let supportScopes: Awaited<ReturnType<typeof getMySupportReadScope>> | null = null;
  try { supportScopes = await getMySupportReadScope(); } catch { supportScopes = null; }

  return (
    <main className={styles.page}>
      <section className={`${styles.shell} ${styles.compactShell}`}>
        <header className={styles.protoTop}>
          <Logo height={28} href="/platform" />
          <span>플랫폼 운영 영역</span>
        </header>

        <div className={styles.compactHub}>
          <section aria-labelledby="platform-title">
            <p>플랫폼 운영</p>
            <h1 id="platform-title">요청을 안전하게 검토하세요</h1>
            <p>
              회사 만들기 요청만 확인할 수 있어요. 고객사의 업무, 멤버, 고객 정보는 이 화면에서 열리지 않아요.
            </p>
          </section>

          <nav aria-label="플랫폼 운영 탐색">
            <Link href="/platform/workspace-requests">회사 만들기 요청</Link>
            <Link href="/platform/metrics">제품 사용 지표</Link>
            <Link href="/account">내 계정</Link>
            <Link href="/settings/account/sessions">로그인 기기</Link>
            <Link href="/settings/account/privacy">개인정보</Link>
          </nav>

          <div className={styles.pendingExits} aria-label="플랫폼 운영 계정 행동">
            <form action="/auth/signout" method="post">
              <button type="submit">로그아웃</button>
            </form>
          </div>

          <section aria-labelledby="support-title">
            <h2 id="support-title">지원 접근</h2>
            {supportScopes === null ? <p>지원 접근 상태를 불러오지 못했습니다. 권한을 가정하지 않습니다.</p> : supportScopes.length === 0 ? <p>승인된 읽기 전용 지원 접근이 없습니다.</p> : <ul>{supportScopes.map((scope) => <li key={`${scope.org_id}-${scope.expires_at}`}>목적: {scope.purpose} · 만료: {scope.expires_at} · 읽기 전용</li>)}</ul>}
            <p>지원 확인은 읽기 전용으로만 제공돼요. 개인정보 표시·내려받기, 사용자 전환, 원본 개인정보 조회, 직접 수정은 제공하지 않습니다.</p>
          </section>

          <ApprovalQueue mode="platform" requests={context.platformCreateRequests} />
        </div>
      </section>
    </main>
  );
}
