import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import { ApprovalQueue } from "@/components/workspace-entry/ApprovalQueue";
import styles from "@/components/workspace-entry/workspace-entry.module.css";
import { loadWorkspaceRoutingSnapshot } from "@/lib/auth/workspace-entry-server";
import { loadWorkspaceEntryContext } from "@/lib/workspace-entry/server";

export default async function PlatformWorkspaceRequestsPage() {
  const routing = await loadWorkspaceRoutingSnapshot();
  if (routing.kind === "unauthenticated") redirect("/login?next=/platform/workspace-requests");
  const context = await loadWorkspaceEntryContext();
  if (context.kind === "error" || !context.isPlatformAdmin) redirect("/workspace-entry?error=permission");

  return (
    <main className={styles.page}>
      <section className={`${styles.shell} ${styles.compactShell}`}>
        <header className={styles.protoTop}>
          <Logo height={28} />
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
            <Link href="/account">내 계정</Link>
            <Link href="/settings/account/sessions">로그인 기기</Link>
            <Link href="/settings/account/privacy">개인정보</Link>
          </nav>

          <section aria-labelledby="support-title">
            <h2 id="support-title">지원 접근</h2>
            <p>
              지원 확인은 읽기 전용으로만 제공돼요. 사용자 전환, 개인정보 표시·내려받기, 모든 기기 로그아웃은
              감사 가능한 서버 절차가 준비될 때까지 사용할 수 없어요.
            </p>
          </section>

          <ApprovalQueue mode="platform" requests={context.platformCreateRequests} />
        </div>
      </section>
    </main>
  );
}
