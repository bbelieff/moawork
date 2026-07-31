import { PlatformAggregatePanel, PlatformShell } from "./PlatformShell";
import { requirePlatformAccess } from "@/lib/platform/guard";
import { type PlatformSectionKey } from "@/lib/platform/contracts";
import { loadPlatformAggregate } from "@/lib/platform/server";
import { createClient } from "@/lib/supabase/server";
import {
  resolveInternalDemoOptions,
  resolveReleaseSelector,
  type ReleaseSelector,
} from "@/lib/release-rings/resolve";

const COPY: Record<PlatformSectionKey, { title: string; description: string }> = {
  overview: { title: "운영 개요", description: "플랫폼 전체의 안전한 집계와 연결 상태를 확인해요." },
  organizations: { title: "조직", description: "조직 이름이나 구성원 목록 없이 연결 가능한 메타데이터만 다뤄요." },
  billing: { title: "결제·매출", description: "결제 원본이나 세무 정보 없이 집계 계약의 상태만 보여줘요." },
  access: { title: "접근 기록", description: "개인 활동 원본이 아닌 감사 가능한 메타데이터만 표시해요." },
  support: { title: "지원", description: "지원 확인은 읽기 전용으로만 제공돼요." },
  analytics: { title: "운영 분석", description: "집계 계약이 준비된 뒤에만 실제 운영 지표를 표시해요." },
  system: { title: "시스템", description: "운영 연결 상태를 확인하되 고객 데이터는 읽지 않아요." },
  admins: { title: "어드민 관리", description: "권한 변경은 별도 보안 계약이 연결될 때까지 제공하지 않아요." },
};

function selectorPayload(selector: ReleaseSelector): unknown {
  if (selector.kind !== "ready") return { kind: "unavailable" };
  return {
    route_path: selector.routePath,
    route_authorization: selector.routeAuthorization,
    release_ring: selector.releaseRing,
    is_internal: selector.isInternal,
    internal_source: selector.internalSource,
    feature_releases: selector.featureReleases,
  };
}

/**
 * Called only after the canonical platform guard. Discovery and every entry
 * selector are server-authorized; no current membership or local slug is used.
 */
async function loadPlatformDemoSelectors(): Promise<readonly unknown[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("list_reviewed_internal_demo_release_options");
    if (error) return [];
    const discovered = resolveInternalDemoOptions(data);
    if (discovered.kind !== "ready" || discovered.options.length === 0) return [];

    const selectors: unknown[] = [];
    for (const option of discovered.options) {
      const selected = await supabase.rpc("resolve_workspace_release_selector", {
        p_org_id: option.orgId,
      });
      if (selected.error) return [];
      const selector = resolveReleaseSelector(
        Array.isArray(selected.data) ? selected.data[0] : selected.data,
      );
      if (selector.kind !== "ready" || selector.routePath !== option.routePath) return [];
      selectors.push(selectorPayload(selector));
    }
    return selectors;
  } catch {
    return [];
  }
}

export async function PlatformConsolePage({ section, pathname }: { section: PlatformSectionKey; pathname: string }) {
  await requirePlatformAccess(pathname);
  const demoSelectors = await loadPlatformDemoSelectors();
  const copy = COPY[section];
  const aggregate = await loadPlatformAggregate(section);
  return <PlatformShell pathname={pathname} title={copy.title} description={copy.description} userModeAction={{ mode: "user" }} demoSelectors={demoSelectors}><PlatformAggregatePanel section={section} state={aggregate} /></PlatformShell>;
}
