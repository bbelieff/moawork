import Link from "next/link";
import type { AccountOrgProfile, AccountViewModel, ProfileReadState } from "@/lib/account/presentation";
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
  orgProfile,
  links = {},
  workspaces = [],
  workspaceLoadError = false,
}: {
  account: AccountViewModel;
  orgProfile: AccountOrgProfile;
  links?: AccountHubLinks;
  workspaces?: ManagedWorkspace[];
  workspaceLoadError?: boolean;
}) {
  const profileValue = (state: ProfileReadState) => {
    if (state.kind === "ready") return <dd data-profile-state="ready">{state.value}</dd>;
    if (state.kind === "empty") {
      return <dd className={styles.emptyValue} data-profile-state="empty">미등록</dd>;
    }
    return <dd className={styles.errorValue} data-profile-state="error">{state.message}</dd>;
  };

  return (
    <div className={styles.bento}>
      <section className={styles.card} aria-labelledby="my-info-title" data-account-scope="global">
        <h2 id="my-info-title">내 정보</h2>
        <dl className={styles.definitionList}>
          <div><dt>표시 이름</dt><dd>{account.displayName}</dd></div>
          <div><dt>로그인 이메일</dt><dd>{account.loginEmail}</dd></div>
        </dl>
      </section>
      <section className={styles.card} aria-labelledby="company-profile-title" data-account-scope="organization">
        <header className={styles.sectionHeading}><h2 id="company-profile-title">현재 회사에서의 내 정보</h2><span>{account.workspaceName}</span></header>
        <dl className={`${styles.definitionList} ${styles.profileGrid}`}>
          <div><dt>역할</dt><dd>{account.roleLabel}</dd></div>
          <div><dt>볼 수 있는 범위</dt><dd>{account.scopeLabel}</dd>{account.scopeNote ? <small>{account.scopeNote}</small> : null}</div>
          <div><dt>호칭</dt>{profileValue(orgProfile.title)}</div>
          <div><dt>주부서</dt>{profileValue(orgProfile.department)}</div>
          <div><dt>직무</dt>{profileValue(orgProfile.job)}</div>
          <div><dt>보고 대상</dt>{profileValue(orgProfile.reportsTo)}</div>
        </dl>
      </section>
      <section id="workspace" className={styles.card} aria-labelledby="workspace-title">
        <header className={styles.sectionHeading}>
          <h2 id="workspace-title">내 회사 관리</h2>
          {links.newWorkspace ? <Link href={links.newWorkspace} className={styles.secondaryAction}>＋ 회사 추가</Link> : null}
        </header>
        <WorkspaceManagementPanel workspaces={workspaces} loadError={workspaceLoadError} />
        {links.workspace ? <div className={styles.actionRow}><Link href={links.workspace} className={styles.secondaryAction}>회사와 팀 보기</Link></div> : null}
        {account.canManageCompany && links.companyManagement ? <div className={styles.actionRow}><Link href={links.companyManagement} className={styles.secondaryAction}>회사 관리</Link></div> : null}
      </section>
      <section className={styles.card} aria-labelledby="current-login-title">
        <h2 id="current-login-title">로그인 · 개인정보</h2>
        <div className={styles.securityRow}><span>로그인 기기</span>{links.sessions ? <Link href={links.sessions} className={styles.secondaryAction}>확인</Link> : <span className={styles.emptyValue}>준비 중</span>}</div>
        <div className={styles.securityRow}><span>개인정보</span>{links.privacy ? <Link href={links.privacy} className={styles.secondaryAction}>확인</Link> : <span className={styles.emptyValue}>준비 중</span>}</div>
        <div className={styles.securityRow}><span>현재 로그인</span><CurrentSessionLogout /></div>
      </section>
    </div>
  );
}
