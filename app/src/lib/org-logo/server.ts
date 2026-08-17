import { createClient } from "@/lib/supabase/server";
import { ORG_LOGO_BUCKET } from "./contracts";

/**
 * 서명 URL 수명.
 *
 * 사이드바는 모든 화면에 뜬다. 너무 짧으면 페이지마다 다시 만들어야 하고,
 * 너무 길면 유출된 URL 이 오래 산다. 1시간이 그 사이다.
 */
export const ORG_LOGO_SIGNED_URL_TTL_SECONDS = 3600;

export type OrgLogoView =
  | { kind: "none" }
  | { kind: "ready"; signedUrl: string }
  | { kind: "unavailable" };

type LogoRow = { id: string; logo_path: string | null };
type SignedRow = { path?: string | null; signedUrl?: string | null; error?: unknown };

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * 여러 조직의 로고 서명 URL을 «한 번의 왕복» 으로 만든다.
 *
 * ★ 로고가 하나도 없으면 Storage 를 아예 호출하지 않는다 — 왕복 0.
 *   새 워크스페이스의 기본값이 «로고 없음» 이므로 이 경로가 가장 흔하다.
 *   로고가 없을 때 화면은 이니셜 마크로 떨어진다(WorkspaceMark). 빈칸이 되지 않는다.
 */
export async function loadOrgLogoSignedUrls(
  orgIds: readonly string[],
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  const unique = [...new Set(orgIds.filter(isNonEmpty))];
  if (unique.length === 0) return resolved;

  try {
    const supabase = await createClient();
    // orgs 의 select 정책이 이미 «내가 속한 조직» 으로 좁힌다. id 목록은 그 위의 추가 제한이다.
    const { data, error } = await supabase.from("orgs").select("id, logo_path").in("id", unique);
    if (error || !Array.isArray(data)) return resolved;

    const rows = (data as LogoRow[]).filter((row) => isNonEmpty(row?.logo_path));
    if (rows.length === 0) return resolved;

    const { data: signed, error: signError } = await supabase.storage
      .from(ORG_LOGO_BUCKET)
      .createSignedUrls(rows.map((row) => row.logo_path as string), ORG_LOGO_SIGNED_URL_TTL_SECONDS);
    if (signError || !Array.isArray(signed)) return resolved;

    const byPath = new Map<string, string>();
    for (const entry of signed as SignedRow[]) {
      if (!entry?.error && isNonEmpty(entry?.path) && isNonEmpty(entry?.signedUrl)) {
        byPath.set(entry.path, entry.signedUrl);
      }
    }
    for (const row of rows) {
      const url = byPath.get(row.logo_path as string);
      if (url) resolved.set(row.id, url);
    }
    return resolved;
  } catch {
    return resolved;
  }
}

/**
 * 설정 화면용 — 「아직 없음」과 「불러오지 못함」을 구분한다.
 * 둘을 뭉개면 빈 상태를 장애로, 장애를 빈 상태로 위장하게 된다.
 */
export async function loadOrgLogoView(orgId: string): Promise<OrgLogoView> {
  if (!isNonEmpty(orgId)) return { kind: "unavailable" };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("orgs")
      .select("id, logo_path")
      .eq("id", orgId)
      .maybeSingle();
    if (error) return { kind: "unavailable" };

    const path = (data as LogoRow | null)?.logo_path ?? null;
    if (!isNonEmpty(path)) return { kind: "none" };

    const { data: signed, error: signError } = await supabase.storage
      .from(ORG_LOGO_BUCKET)
      .createSignedUrl(path, ORG_LOGO_SIGNED_URL_TTL_SECONDS);
    if (signError || !isNonEmpty((signed as { signedUrl?: string } | null)?.signedUrl)) {
      return { kind: "unavailable" };
    }
    return { kind: "ready", signedUrl: (signed as { signedUrl: string }).signedUrl };
  } catch {
    return { kind: "unavailable" };
  }
}
