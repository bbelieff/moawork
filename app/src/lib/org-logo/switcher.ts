// BBE-199 — 멤버십 + 로고 URL 지도 → 워크스페이스 스위처 입력.
//
// ★ 왜 layout.tsx 안의 inline map 을 여기로 꺼냈나
//   원래는 레이아웃 안에서 바로 map 하고 있었고, 그 결과 「로고 URL 이 실제로
//   스위처까지 도달하는가」를 재는 «행위» 테스트가 하나도 없었다.
//   소스에 이름이 있는지만 보는 검사는 「이름은 있는데 값이 안 흐른다」를 통과시킨다.
//   순수 함수로 떼어내면 값이 도착하는지를 실제로 잴 수 있다.

export type SwitcherMembership = {
  orgId: string;
  slug: string;
  name: string;
  role: "owner" | "admin" | "member";
};

export type SwitcherWorkspaceInput = SwitcherMembership & {
  status: "active";
  signedImageUrl: string | null;
};

/**
 * 로고 URL 이 있으면 붙이고, 없으면 명시적으로 null 을 준다.
 * null 이면 WorkspaceMark 가 회사명 이니셜로 떨어진다 — 빈칸이 되지 않는다.
 */
export function buildSwitcherWorkspaces(
  memberships: readonly SwitcherMembership[],
  logoUrls: ReadonlyMap<string, string>,
): SwitcherWorkspaceInput[] {
  return memberships.map((membership) => ({
    orgId: membership.orgId,
    slug: membership.slug,
    name: membership.name,
    role: membership.role,
    status: "active" as const,
    signedImageUrl: logoUrls.get(membership.orgId) ?? null,
  }));
}
