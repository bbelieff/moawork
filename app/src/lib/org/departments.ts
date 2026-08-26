import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ctx } from "@/lib/types";

/**
 * #571 — 조직도(부서) 읽기.
 *
 * ★ 이 모양이 «계약» 이다.
 *   #528(DG)이 「안정된 부서 id/name/memberCount 와 member id/displayName/departmentIds/active」
 *   를 어댑터 경계로 요구한다. 그 요구를 여기서 만족시킨다 — 저쪽이 우리 테이블을 직접
 *   읽지 않아도 되도록. 테이블 모양이 바뀌어도 이 계약이 방패가 된다.
 *
 * ★ 빈 상태가 «오류가 아니다».
 *   새 워크스페이스는 부서 0개로 시작한다(CLAUDE.md). 그래서 «없음» 과 «못 읽음» 을
 *   서로 다른 값으로 돌려준다 — 화면이 둘을 다르게 말해야 하기 때문이다.
 */

export interface DepartmentNode {
  id: string;
  name: string;
  parentId: string | null;
  headUserId: string | null;
  sortOrder: number;
  /** 이 부서에 «직접» 배정된 사람 수. 하위 부서는 포함하지 않는다. */
  memberCount: number;
}

export interface DepartmentMember {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  departmentIds: string[];
  active: boolean;
}

export type OrgChart =
  | Readonly<{ kind: "ready"; departments: DepartmentNode[]; members: DepartmentMember[]; unassignedCount: number }>
  /** 못 읽었다. «부서가 없다» 와 다른 사실이라 화면이 다르게 말해야 한다. */
  | Readonly<{ kind: "error" }>;

/** 트리로 접는다 — 화면이 들여쓰기를 그릴 수 있게 «깊이» 를 같이 준다. */
export interface DepartmentTreeRow extends DepartmentNode {
  depth: number;
  /** 자기 + 하위 전부의 인원(중복 제거). 목업의 「하위 부서 포함」 토글이 이 값을 쓴다. */
  reachCount: number;
}

export function toTree(departments: readonly DepartmentNode[], members: readonly DepartmentMember[]): DepartmentTreeRow[] {
  const byParent = new Map<string | null, DepartmentNode[]>();
  for (const node of departments) {
    const bucket = byParent.get(node.parentId) ?? [];
    bucket.push(node);
    byParent.set(node.parentId, bucket);
  }
  for (const bucket of byParent.values()) {
    bucket.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  // 부서마다 «자기 + 하위» 사람 집합. 겸직이 있으므로 Set 으로 센다 — 배열로 더하면 두 번 세어진다.
  const directMembers = new Map<string, Set<string>>();
  for (const member of members) {
    for (const id of member.departmentIds) {
      const bucket = directMembers.get(id) ?? new Set<string>();
      bucket.add(member.userId);
      directMembers.set(id, bucket);
    }
  }

  const rows: DepartmentTreeRow[] = [];
  const seen = new Set<string>();

  const walk = (parentId: string | null, depth: number): Set<string> => {
    const reach = new Set<string>();
    for (const node of byParent.get(parentId) ?? []) {
      // ⚠ 순환이 생기면 여기서 영원히 돈다. DB 가 self-parent 만 막으므로 한 번 더 막는다.
      if (seen.has(node.id)) continue;
      seen.add(node.id);

      const row: DepartmentTreeRow = { ...node, depth, reachCount: 0 };
      rows.push(row);
      const below = walk(node.id, depth + 1);
      const mine = new Set([...(directMembers.get(node.id) ?? []), ...below]);
      row.reachCount = mine.size;
      for (const userId of mine) reach.add(userId);
    }
    return reach;
  };

  walk(null, 0);
  return rows;
}

interface DepartmentRow { id: string; name: string; parent_id: string | null; head_user_id: string | null; sort_order: number }
interface AssignmentRow { dept_id: string; user_id: string }
interface MemberRow {
  user_id: string;
  status: string;
  users: { name: string | null; avatar_url: string | null } | { name: string | null; avatar_url: string | null }[] | null;
}

export async function loadOrgChart(
  ctx: Ctx,
  clientFactory: () => Promise<SupabaseClient>,
): Promise<OrgChart> {
  try {
    const client = await clientFactory();
    const [departments, assignments, members] = await Promise.all([
      client
        .from("departments")
        .select("id,name,parent_id,head_user_id,sort_order")
        .eq("org_id", ctx.org.id)
        .is("archived_at", null),
      client.from("department_members").select("dept_id,user_id").eq("org_id", ctx.org.id),
      client.from("org_members").select("user_id,status,users(name,avatar_url)").eq("org_id", ctx.org.id),
    ]);
    // 실패를 «부서 0개» 로 위장하지 않는다 — 그러면 화면이 「아직 부서가 없어요」 라고 거짓말한다.
    if (departments.error || assignments.error || members.error) return { kind: "error" };

    const departmentRows = (departments.data ?? []) as DepartmentRow[];
    const activeDepartmentIds = new Set(departmentRows.map((department) => department.id));
    const activeAssignments = ((assignments.data ?? []) as AssignmentRow[]).filter((row) =>
      activeDepartmentIds.has(row.dept_id),
    );

    const byUser = new Map<string, string[]>();
    for (const row of activeAssignments) {
      byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row.dept_id]);
    }

    const memberList: DepartmentMember[] = ((members.data ?? []) as MemberRow[]).map((row) => {
      const joined = Array.isArray(row.users) ? row.users[0] : row.users;
      return {
        userId: row.user_id,
        displayName: joined?.name?.trim() || "이름 없는 구성원",
        avatarUrl: joined?.avatar_url ?? null,
        departmentIds: byUser.get(row.user_id) ?? [],
        active: row.status === "active",
      };
    });

    const counts = new Map<string, number>();
    const activeUserIds = new Set(memberList.filter((member) => member.active).map((member) => member.userId));
    for (const row of activeAssignments) {
      if (!activeUserIds.has(row.user_id)) continue;
      counts.set(row.dept_id, (counts.get(row.dept_id) ?? 0) + 1);
    }

    return {
      kind: "ready",
      departments: departmentRows.map((row) => ({
        id: row.id,
        name: row.name,
        parentId: row.parent_id,
        headUserId: row.head_user_id,
        sortOrder: row.sort_order,
        memberCount: counts.get(row.id) ?? 0,
      })),
      members: memberList,
      // 목업이 이 숫자를 머리에 적는다 — 「부서 N · 조직원 N · 미배정 N」.
      // 활성 멤버만 센다. 나간 사람이 «미배정» 으로 남으면 할 일이 있는 것처럼 보인다.
      unassignedCount: memberList.filter((member) => member.active && member.departmentIds.length === 0).length,
    };
  } catch {
    return { kind: "error" };
  }
}
