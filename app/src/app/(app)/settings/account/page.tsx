import { workspaceHref } from "@/components/shell/workspace-href";
import { AccountHub } from "@/components/account/AccountHub";
import { AccountNav } from "@/components/account/AccountNav";
import styles from "@/components/account/account.module.css";
import { getSession } from "@/lib/auth/session";
import { buildAccountViewModel } from "@/lib/account/presentation";
import { loadAccountOrgProfile } from "@/lib/account/profile-server";
import { loadWorkspaceRoutingSnapshot } from "@/lib/auth/workspace-entry-server";
import { loadOwnerWorkspaceDeletionRows } from "@/lib/workspace-deletion/server";
import type { ManagedWorkspace } from "@/components/account/WorkspaceManagementPanel";

const NAV_ITEMS = [
  { key: "account", label: "내 정보", href: "/account" },
  {
    key: "workspace",
    label: "내 회사 관리",
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

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const ctx = await getSession();
  const account = buildAccountViewModel(ctx);
  const { error } = await searchParams;
  const [routing, ownerResult, orgProfile] = await Promise.all([
    loadWorkspaceRoutingSnapshot(),
    loadOwnerWorkspaceDeletionRows().then((rows) => ({ ok: true as const, rows })).catch(() => ({ ok: false as const, rows: [] })),
    loadAccountOrgProfile(ctx),
  ]);
  const workspaceLoadError = routing.kind !== "ready" || !ownerResult.ok;
  const workspaces: ManagedWorkspace[] = [];
  if (!workspaceLoadError && routing.kind === "ready") {
    const owners = new Map(ownerResult.rows.map((row) => [row.orgId, row]));
    for (const membership of routing.memberships) {
      const owner = owners.get(membership.orgId);
      workspaces.push({ ...membership, status: "active", deletionRequestedAt: owner?.deletionRequestedAt ?? null });
      owners.delete(membership.orgId);
    }
    for (const row of owners.values()) if (row.status === "pending_delete") workspaces.push(row);
  }

  const currentMembership = routing.kind === "ready" ? routing.memberships.find((membership) => membership.orgId === ctx.org.id) : undefined;
  const basePath = currentMembership ? `/w/${currentMembership.slug}` : undefined;
  const localHref = (href: string) => workspaceHref(basePath, href);
  workspaces.sort((a, b) => Number(b.orgId === ctx.org.id) - Number(a.orgId === ctx.org.id));

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <h1>내 계정과 팀</h1>
      </header>

      {error === "signout" ? (
        <section className={`${styles.state} ${styles.blocked}`} role="alert">
          <h2>로그아웃하지 못했어요</h2>
          <p>현재 로그인은 그대로예요. 잠시 뒤 다시 시도해 주세요.</p>
        </section>
      ) : null}

      <AccountNav current="account" items={NAV_ITEMS.map((item) => ({ ...item, href: localHref(item.href) }))} />
      <AccountHub
        account={account}
        orgProfile={orgProfile}
        workspaces={workspaces}
        workspaceLoadError={workspaceLoadError}
        links={{
          workspace: localHref("/settings/members"),
          sessions: localHref("/settings/account/sessions"),
          privacy: localHref("/settings/account/privacy"),
          newWorkspace: "/workspace-entry?mode=new",
        }}
      />
    </div>
  );
}
