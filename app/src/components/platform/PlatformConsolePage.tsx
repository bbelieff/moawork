import { PlatformAggregatePanel, PlatformShell } from "./PlatformShell";
import { requirePlatformAccess } from "@/lib/platform/guard";
import { type PlatformSectionKey } from "@/lib/platform/contracts";
import { loadPlatformAggregate } from "@/lib/platform/server";

const COPY: Record<PlatformSectionKey, { title: string; description: string }> = {
  overview: { title: "운영 개요", description: "" },
  organizations: { title: "조직", description: "" },
  billing: { title: "결제·매출", description: "" },
  access: { title: "접근 기록", description: "" },
  support: { title: "지원", description: "" },
  analytics: { title: "운영 분석", description: "" },
  system: { title: "시스템", description: "" },
  admins: { title: "어드민 관리", description: "" },
  demo: { title: "데모 워크스페이스", description: "" },
};

export async function PlatformConsolePage({ section, pathname }: { section: PlatformSectionKey; pathname: string }) {
  await requirePlatformAccess(pathname);
  const copy = COPY[section];
  const aggregate = await loadPlatformAggregate(section);
  return <PlatformShell pathname={pathname} title={copy.title} description={copy.description} userModeAction={{ mode: "user" }}><PlatformAggregatePanel section={section} state={aggregate} /></PlatformShell>;
}
