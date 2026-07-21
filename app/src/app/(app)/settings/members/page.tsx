import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getRepo } from "@/lib/repo";
import { isManager, isMemberRole, MEMBER_ROLES } from "@/lib/auth/roles";

// 멤버·권한 화면. 조직 멤버 목록 + 역할/담당범위. owner/admin 만 역할 변경 가능.
export default async function MembersPage() {
  const ctx = await getSession();
  const repo = getRepo();
  const members = repo.listMembers(ctx.org.id);
  const canManage = isManager(ctx.role);

  async function changeRole(formData: FormData) {
    "use server";
    const current = await getSession();
    if (!isManager(current.role)) {
      throw new Error("권한 부족: 역할 변경은 owner/admin 만 가능합니다.");
    }
    const userId = String(formData.get("user_id") ?? "");
    const role = formData.get("role");
    if (!isMemberRole(role)) return;
    getRepo().setMemberRole(current.org.id, userId, role);
    redirect("/settings/members");
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">멤버·권한</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {ctx.org.name} · 멤버 {members.length}명
          {canManage ? "" : " · (열람 전용 — 역할 변경은 관리자만)"}
        </p>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
            <th className="py-2">이름</th>
            <th className="py-2">이메일</th>
            <th className="py-2">역할</th>
            <th className="py-2">담당범위</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr
              key={m.user_id}
              className="border-b border-zinc-100 dark:border-zinc-900"
            >
              <td className="py-2">{m.user?.name ?? "(알 수 없음)"}</td>
              <td className="py-2 text-zinc-500">{m.user?.email ?? "-"}</td>
              <td className="py-2">
                {canManage ? (
                  <form action={changeRole} className="flex items-center gap-2">
                    <input type="hidden" name="user_id" value={m.user_id} />
                    <select
                      name="role"
                      defaultValue={m.role}
                      className="rounded border border-zinc-300 bg-transparent px-1 py-0.5 text-xs dark:border-zinc-700"
                    >
                      {MEMBER_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                    >
                      변경
                    </button>
                  </form>
                ) : (
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
                    {m.role}
                  </span>
                )}
              </td>
              <td className="py-2 text-zinc-500">{m.scope}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
