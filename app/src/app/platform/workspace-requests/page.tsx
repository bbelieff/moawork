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
  return <main className={styles.page}><section className={`${styles.shell} ${styles.compactShell}`}><header className={styles.protoTop}><Logo height={28} /><span>플랫폼 운영 영역</span></header><div className={styles.compactHub}><ApprovalQueue mode="platform" requests={context.platformCreateRequests} /></div></section></main>;
}
