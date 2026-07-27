import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { loadMemberOrgSummary, type MemberSummaryRow } from "@/lib/auth/member-org-summary";

function roleLabel(role: MemberSummaryRow["role"]) {
  if (role === "owner") return "대표";
  if (role === "admin") return "관리자 · 팀장";
  return "팀원";
}

function scopeLabel(scope: MemberSummaryRow["scope"]) {
  return scope === "all" ? "회사 업무 전체" : "내게 배정된 업무";
}

function MemberRow({ member, protectedOwner = false }: { member: MemberSummaryRow; protectedOwner?: boolean }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 py-3 last:border-0 dark:border-zinc-900">
      <div>
        <strong>{member.displayName}</strong>
        <p className="mt-1 text-sm text-zinc-500">{roleLabel(member.role)} · {scopeLabel(member.scope)}</p>
      </div>
      {protectedOwner ? (
        <span className="rounded-full bg-mw-tint-teal px-3 py-1 text-xs font-semibold text-mw-automation">보호된 대표</span>
      ) : (
        <span className="text-sm text-zinc-500">권한 변경은 안전한 관리 기능이 준비된 뒤 열어요.</span>
      )}
    </li>
  );
}

function Group({ title, members }: { title: string; members: MemberSummaryRow[] }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="font-semibold">{title}</h2>
      {members.length === 0 ? <p className="mt-2 text-sm text-zinc-500">아직 이 그룹에 함께하는 사람이 없어요.</p> : <ul className="mt-2"><>{members.map((member) => <MemberRow key={member.userId} member={member} />)}</></ul>}
    </section>
  );
}

export default async function MembersPage() {
  const ctx = await getSession();
  const summary = await loadMemberOrgSummary(ctx);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold">우리 회사와 팀</h1>
        <p className="mt-1 text-sm text-zinc-500">{ctx.org.name}에서 함께 일하는 사람과 업무 범위를 확인해요.</p>
      </header>

      {summary.kind === "ready" ? (
        <>
          <section className="rounded-2xl border border-mw-automation bg-mw-tint-teal p-4">
            <h2 className="font-semibold">보호된 대표</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">대표 권한은 이 화면에서 바꾸거나 지울 수 없어요.</p>
            <ul className="mt-2"><MemberRow member={summary.owner} protectedOwner /></ul>
          </section>
          <Group title="관리자와 팀장" members={summary.admins} />
          <Group title="팀원" members={summary.members} />
          {ctx.role === "owner" ? <Link href="/settings/members/approvals" className="w-fit rounded-xl bg-mw-primary px-4 py-3 text-sm font-semibold text-mw-on-accent">회사 합류 요청 확인하기</Link> : null}
        </>
      ) : null}
      {summary.kind === "unavailable" ? <section role="status" className="rounded-2xl border border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">회사 구성원 정보는 서버 연결이 준비되면 안전하게 보여드려요.</section> : null}
      {summary.kind === "error" ? <section role="alert" className="rounded-2xl border border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">회사 구성원 정보를 불러오지 못했어요. 잠시 뒤 다시 확인해 주세요.</section> : null}
      {summary.kind === "owner_integrity_error" ? <section role="alert" className="rounded-2xl border border-red-200 p-4 text-sm text-red-700 dark:border-red-900 dark:text-red-300">보호된 대표 정보를 안전하게 확인하지 못했어요. 이 화면에서는 어떤 권한도 바꿀 수 없어요.</section> : null}
    </div>
  );
}
