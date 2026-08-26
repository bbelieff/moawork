"use client";

import { WorkspaceSwitcher } from "@/components/workspace/WorkspaceSwitcher";

/** Issue #568: sticky shell과 본문이 겹치는 실제 브라우저 레이어 회귀용 fixture. */
export function VisualWorkspaceSwitcherProbe() {
  return (
    <aside
      data-testid="visual-workspace-switcher-probe"
      className="mw-layer-shell fixed left-0 top-0 h-screen w-52 border-r border-mw-line bg-mw-card p-2"
    >
      <div className="mb-2 h-12 border-b border-mw-line px-2 py-3 font-semibold">MoaWork</div>
      <WorkspaceSwitcher
        currentOrgId="visual-org"
        workspaces={[
          { orgId: "visual-org", slug: "visual-org", name: "MoaWork 데모 조직", role: "owner", status: "active" },
          { orgId: "visual-test", slug: "visual-test", name: "테스트", role: "owner", status: "active" },
        ]}
        destinations={{ createHref: "/workspace-entry?mode=new", joinHref: "/workspace-entry?mode=resume" }}
        serverConfirmedCanAccessPlatform
        onNavigate={async () => {}}
      />
    </aside>
  );
}
