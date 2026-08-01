import { PlatformDemoWorkspaceTab } from "@/components/platform/PlatformDemoWorkspaceTab";
import { loadPlatformDemoTabState } from "@/lib/platform/demo";
import { requirePlatformAccess } from "@/lib/platform/guard";

export default async function PlatformDemoPage() {
  await requirePlatformAccess("/platform/demo");
  const state = await loadPlatformDemoTabState();
  return <PlatformDemoWorkspaceTab state={state} />;
}
