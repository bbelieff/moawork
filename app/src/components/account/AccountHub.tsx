import Link from "next/link";
import type { AccountViewModel } from "@/lib/account/presentation";
import { CurrentSessionLogout } from "./CurrentSessionLogout";
import styles from "./account.module.css";
import { WorkspaceManagementPanel, type ManagedWorkspace } from "./WorkspaceManagementPanel";

export type AccountHubLinks = {
  workspace?: string;
  sessions?: string;
  privacy?: string;
  companyManagement?: string;
  newWorkspace?: string;
};

export function AccountHub({
  account,
  links = {},
  workspaces = [],
  workspaceLoadError = false,
}: {
  account: AccountViewModel;
  links?: AccountHubLinks;
  workspaces?: ManagedWorkspace[];
  workspaceLoadError?: boolean;
}) {
  return (
    <>
      <section className={styles.identity} aria-labelledby="account-identity">
        <span className={styles.avatar} aria-hidden="true">
          {account.initial}
        </span>
        <div>
          <h2 id="account-identity">{account.displayName}</h2>
          <p>{account.workspaceName}에서 함께 일하고 있어요.</p>
        </div>
        <span className={styles.roleBadge}>{account.roleLabel}</span>
      </section>

      <div className={styles.bento}>
        <section className={styles.card} aria-labelledby="my-info-title">
          <h2 id="my-info-title">내 정보</h2>
          <div className={styles.stat}>{account.roleLabel}</div>
          <dl className={styles.definitionList}>
            <div>
              <dt>표시 이름</dt>
              <dd>{account.displayName}</dd>
            </div>
            <div>
              <dt>로그인 이메일</dt>
              <dd>{account.loginEmail}</dd>
            </div>
            <div>
              <dt>역할</dt>
              <dd>{account.roleDescription}</dd>
            </div>
            <div>
              <dt>볼 수 있는 범위</dt>
              <dd>{account.scopeLabel}</dd>
            </div>
          </dl>
        </section>

        <section className={styles.card} aria-labelledby="current-login-title">
          <h2 id="current-login-title">현재 로그인</h2>
          <p>이 브라우저에서 MoaWork를 사용하고 있어요.</p>
          <small>
            다른 기기 목록은 안전한 세션 기능이 준비된 뒤 보여드려요.
          </small>
          <div className={styles.actionRow}>
            {links.sessions ? (
              <Link href={links.sessions} className={styles.secondaryAction}>
                로그인 기기 확인하기
              </Link>
            ) : null}
          </div>
        </section>

        <section
          id="workspace"
          className={`${styles.card} ${styles.cardWide}`}
          aria-labelledby="workspace-title"
        >
          <h2 id="workspace-title">내 회사와 팀</h2>
          <p>접근할 수 있는 회사와 내 역할을 확인하고, 대표는 회사를 삭제 예정으로 바꾸거나 되돌릴 수 있어요.</p>
          <WorkspaceManagementPanel workspaces={workspaces} loadError={workspaceLoadError} />
          <dl className={styles.definitionList}>
            <div>
              <dt>현재 회사</dt>
              <dd>{account.workspaceName}</dd>
            </div>
            <div>
              <dt>팀</dt>
              <dd>{account.teamMessage}</dd>
            </div>
          </dl>
          <div className={styles.actionRow}>
            {links.workspace ? (
              <Link href={links.workspace} className={styles.primaryAction}>
                회사와 팀 보기
              </Link>
            ) : null}
            <CurrentSessionLogout />
            {links.newWorkspace ? (
              <Link href={links.newWorkspace} className={styles.secondaryAction}>
                새 회사를 시작하거나 합류하기
              </Link>
            ) : null}
          </div>
          {account.canManageCompany ? (
            <details className={styles.advanced}>
              <summary>회사가 성장하면 여는 관리</summary>
              <p>
                구성원과 팀을 안전하게 관리하는 기능을 준비하고 있어요. 대표
                보호 계약이 확인되기 전에는 변경할 수 없어요.
              </p>
              {links.companyManagement ? (
                <Link
                  href={links.companyManagement}
                  className={styles.secondaryAction}
                >
                  회사 관리
                </Link>
              ) : null}
            </details>
          ) : null}
        </section>

        <section
          className={`${styles.card} ${styles.cardWide} ${styles.blocked}`}
          aria-labelledby="protected-features-title"
        >
          <h2 id="protected-features-title">안전하게 준비 중인 기능</h2>
          <p>
            다른 기기 로그아웃, 개인정보 내려받기, 계정 탈퇴는 서버의 보호
            계약이 확인된 뒤 열어요. 지금은 완료된 것처럼 표시하지 않아요.
          </p>
          {links.privacy ? (
            <Link href={links.privacy} className={styles.secondaryAction}>
              개인정보 범위 확인하기
            </Link>
          ) : null}
        </section>
      </div>
    </>
  );
}
