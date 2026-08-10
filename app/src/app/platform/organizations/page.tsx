import { PlatformOrganizationsPanel } from "@/components/platform/PlatformOrganizationsPanel";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { requirePlatformAccess } from "@/lib/platform/guard";
import { loadPlatformAggregate } from "@/lib/platform/server";
import { loadWorkspaceEntryContext } from "@/lib/workspace-entry/server";

const PATHNAME = "/platform/organizations";

export default async function PlatformOrganizationsPage() {
  await requirePlatformAccess(PATHNAME);
  const [context, aggregate] = await Promise.all([
    loadWorkspaceEntryContext(),
    loadPlatformAggregate("organizations"),
  ]);
  const requests = context.kind === "ready" && context.isPlatformAdmin
    ? context.platformCreateRequests
    : null;

  return (
    <PlatformShell
      pathname={PATHNAME}
      title="고객사 관리"
      description="회사 만들기 요청을 승인해 첫 사용자가 바로 업무를 시작할 수 있게 해요."
      userModeAction={{ mode: "user" }}
    >
      <PlatformOrganizationsPanel requests={requests} aggregate={aggregate} />
    </PlatformShell>
  );
}
