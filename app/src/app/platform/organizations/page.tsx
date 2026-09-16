import { PlatformCustomerRegistry } from "@/components/platform/PlatformCustomerRegistry";
import { PlatformOrganizationsPanel } from "@/components/platform/PlatformOrganizationsPanel";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { requirePlatformAccess } from "@/lib/platform/guard";
import { parseCustomerListQuery } from "@/lib/platform/customers/contracts";
import { platformCustomerClient, readPlatformCustomerList } from "@/lib/platform/customers/server";
import { loadPlatformAggregate } from "@/lib/platform/server";
import { loadWorkspaceEntryContext } from "@/lib/workspace-entry/server";

const PATHNAME = "/platform/organizations";

export default async function PlatformOrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  await requirePlatformAccess(PATHNAME);
  const params = await searchParams;
  const query = parseCustomerListQuery(params);
  const [context, aggregate] = await Promise.all([
    loadWorkspaceEntryContext(),
    loadPlatformAggregate("organizations"),
  ]);
  const requests = context.kind === "ready" && context.isPlatformAdmin
    ? context.platformCreateRequests
    : null;

  let customers = null;
  let problem: null | "denied" | "unavailable" = null;
  try {
    const result = await readPlatformCustomerList(await platformCustomerClient(), query);
    if (result.ok) {
      customers = result.customers;
    } else if (result.reason === "denied") {
      problem = "denied";
    } else {
      problem = "unavailable";
    }
  } catch {
    problem = "unavailable";
  }

  return (
    <PlatformShell
      pathname={PATHNAME}
      title="고객사 관리"
      description=""
      userModeAction={{ mode: "user" }}
    >
      <PlatformCustomerRegistry
        customers={customers ?? []}
        query={query}
        problem={problem}
      />
      <PlatformOrganizationsPanel requests={requests} aggregate={aggregate} />
    </PlatformShell>
  );
}
