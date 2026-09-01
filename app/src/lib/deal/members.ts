/**
 * 조직 멤버 조회 (BBE-16 · 딜 상세 협업).
 *
 * 담당자 재배정 선택지 · @멘션 후보 · 타임라인/댓글 작성자 이름 표시에 쓴다.
 * 환경변수가 있으면 Supabase(`org_members` + `users`), 없으면 로컬 인메모리
 * (`getRepo().listMembers`) — 이 레포 전반의 표준 폴백 규약과 동일하다.
 *
 * ⚠ 실제 멘션/재배정 권한 검증은 여기서 하지 않는다. 이 목록은 화면 표시·후보 제시용이며,
 * 최종 권한 판정은 RPC(SECURITY DEFINER, 064 마이그레이션)가 서버에서 다시 한다 —
 * 클라이언트가 준 목록을 신뢰하지 않는다.
 */

import { canUseLocalSeedFallback } from "@/lib/supabase/local-fallback";
import { createClient } from "@/lib/supabase/server";
import { getRepo } from "@/lib/repo";
import type { Ctx } from "@/lib/types";

export interface OrgMemberOption {
  id: string;
  name: string | null;
}

/** 조직 멤버 목록(이름 표시용 — 이메일 등 개인정보는 가져오지 않는다). */
export async function listOrgMemberOptions(ctx: Ctx): Promise<OrgMemberOption[]> {
  // ★ BBE-203 — 이 분기는 로컬 시드 멤버 이름을 돌려준다. env 유무«만» 보면 운영에서
  //   env 가 빠졌을 때 시드 사람 이름이 «우리 회사 멤버» 로 조용히 뜬다.
  if (process.env.NODE_ENV !== "production" && canUseLocalSeedFallback()) {
    return getRepo()
      .listMembers(ctx.org.id)
      .map((m) => ({ id: m.user_id, name: m.user?.name ?? null }));
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("org_members")
      .select("user_id, users(id, name)")
      .eq("org_id", ctx.org.id);
    if (error) return [];

    // Supabase 는 FK 관계 추론에 따라 `users` 를 단일 객체 또는 배열로 돌려줄 수 있다 —
    // 둘 다 방어적으로 처리한다.
    type UserRow = { id: string; name: string | null };
    type Row = { user_id: string; users: UserRow | UserRow[] | null };
    return ((data ?? []) as unknown as Row[]).map((r) => {
      const user = Array.isArray(r.users) ? (r.users[0] ?? null) : r.users;
      return { id: r.user_id, name: user?.name ?? null };
    });
  } catch {
    // 목록 조회 실패는 "멘션/재배정 후보 없음"으로 수렴 — 화면이 죽지 않는다.
    return [];
  }
}

/** id → 이름 맵(표시용). */
export function toNameMap(members: readonly OrgMemberOption[]): Map<string, string | null> {
  return new Map(members.map((m) => [m.id, m.name]));
}
