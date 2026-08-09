"use client";

import { type FormEvent, useId, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MemberSummaryRow } from "@/lib/auth/member-org-summary";

type Props = {
  orgId: string;
  owner: MemberSummaryRow;
  admins: MemberSummaryRow[];
  members: MemberSummaryRow[];
  canEditProfiles: boolean;
  /**
   * 지금 이 화면을 보는 로그인 계정의 user id.
   * 조직도는 이름만 보여줘서 같은 사람의 다른 계정(예: 요청 계정과 승인 계정)을
   * 화면에서 구분할 수 없었다 → 자기 카드에 "나" 표식을 붙여 계정을 특정한다.
   */
  viewerUserId: string;
};

type SaveState = "idle" | "saving" | "saved" | "error" | "unavailable";
type Editor = { kind: "profile" | "hierarchy" | "permission"; member: MemberSummaryRow } | null;
type PermissionDecision = "allow" | "deny";
type PermissionAccess = "viewer" | "editor";

/** 013의 server-authorized mutation contract. */
export type MemberHierarchyRpc = {
  set_workspace_member_hierarchy_role_scope: (
    orgId: string,
    targetUserId: string,
    reportsToUserId: string | null,
    role: "owner" | "admin" | "member",
    scope: "all" | "assigned",
    requestId: string,
  ) => Promise<{ accepted: boolean; replayed: boolean }>;
  bind_workspace_lower_member_permission: (
    orgId: string,
    targetUserId: string,
    scopeKey: string,
    decision: "allow" | "deny",
    accessLevel: "viewer" | "editor",
    requestId: string,
  ) => Promise<{ accepted: boolean; replayed: boolean }>;
};

function acceptedReply(value: unknown): boolean {
  return !!value && typeof value === "object" && (value as { accepted?: unknown }).accepted === true;
}

export function isUnavailableRpcError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; message?: unknown };
  if (value.code === "42883" || value.code === "PGRST202") return true;
  const message = typeof value.message === "string" ? value.message.toLowerCase() : "";
  return message.includes("could not find the function") || message.includes("function") && message.includes("does not exist");
}

export function normalizePermissionScopeKey(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9:_./-]{0,95}$/.test(normalized) ? normalized : null;
}

function roleLabel(role: MemberSummaryRow["role"]) {
  return role === "owner" ? "대표" : role === "admin" ? "팀장" : "사원";
}

function teamLabel(teamKey: string | null) {
  return teamKey ? `팀 · ${teamKey}` : "팀 미지정";
}

function MemberCard({ member, protectedOwner, isViewer, canEdit, onProfileEdit, onHierarchyEdit, onPermissionEdit }: {
  member: MemberSummaryRow;
  protectedOwner?: boolean;
  isViewer: boolean;
  canEdit: boolean;
  onProfileEdit: (member: MemberSummaryRow) => void;
  onHierarchyEdit: (member: MemberSummaryRow) => void;
  onPermissionEdit: (member: MemberSummaryRow) => void;
}) {
  return (
    <li className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{member.displayName}{isViewer ? <span aria-label="지금 로그인한 계정" className="ml-2 rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">나</span> : null}</p>
          <p className="mt-1 text-sm text-zinc-500">{member.title ?? "직책 미지정"} · {teamLabel(member.teamKey)}</p>
          <p className="mt-1 text-xs text-zinc-500">{roleLabel(member.role)} · {member.scope === "all" ? "회사 업무 전체" : "배정된 업무"}</p>
        </div>
        {protectedOwner ? <span className="rounded-full bg-mw-tint-teal px-3 py-1 text-xs font-semibold text-mw-automation">보호된 대표</span> : canEdit ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onProfileEdit(member)} className="rounded-xl border border-zinc-300 px-3 py-2 text-sm font-semibold dark:border-zinc-700">직책·팀 수정</button>
            <button type="button" onClick={() => onHierarchyEdit(member)} className="rounded-xl border border-zinc-300 px-3 py-2 text-sm font-semibold dark:border-zinc-700">업무 역할 설정</button>
            {member.role === "member" ? <button type="button" onClick={() => onPermissionEdit(member)} className="rounded-xl border border-zinc-300 px-3 py-2 text-sm font-semibold dark:border-zinc-700">세부 권한 설정</button> : null}
          </div>
        ) : <span className="text-sm text-zinc-500">조회만 가능</span>}
      </div>
    </li>
  );
}

export function MemberOrganizationChart({ orgId, owner, admins, members, canEditProfiles, viewerUserId }: Props) {
  const [editor, setEditor] = useState<Editor>(null);
  const [title, setTitle] = useState("");
  const [teamKey, setTeamKey] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [scope, setScope] = useState<"all" | "assigned">("assigned");
  const [reportsToUserId, setReportsToUserId] = useState("");
  const [permissionScopeKey, setPermissionScopeKey] = useState("");
  const [permissionDecision, setPermissionDecision] = useState<PermissionDecision>("allow");
  const [permissionAccess, setPermissionAccess] = useState<PermissionAccess>("viewer");
  const [state, setState] = useState<SaveState>("idle");
  const titleId = useId();
  const teamId = useId();

  const reportingLineCandidates = useMemo(
    () => [...admins, ...members],
    [admins, members],
  );

  function beginProfileEdit(member: MemberSummaryRow) {
    setEditor({ kind: "profile", member });
    setTitle(member.title ?? "");
    setTeamKey(member.teamKey ?? "");
    setState("idle");
  }

  function beginHierarchyEdit(member: MemberSummaryRow) {
    if (member.role === "owner") return;
    setEditor({ kind: "hierarchy", member });
    setRole(member.role);
    setScope(member.scope);
    setReportsToUserId("");
    setState("idle");
  }

  function beginPermissionEdit(member: MemberSummaryRow) {
    if (member.role !== "member") return;
    setEditor({ kind: "permission", member });
    setPermissionScopeKey("");
    setPermissionDecision("allow");
    setPermissionAccess("viewer");
    setState("idle");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || editor.kind !== "profile" || !canEditProfiles || state === "saving") return;
    setState("saving");
    const { data, error } = await createClient().rpc("save_member_account_profile", {
      p_org_id: orgId,
      p_target_user_id: editor.member.userId,
      p_title: title.trim(),
      p_team_key: teamKey.trim().toLowerCase(),
      p_request_id: crypto.randomUUID(),
    });
    if (error || !acceptedReply(data)) {
      setState("error");
      return;
    }
    setState("saved");
  }

  async function saveHierarchy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || editor.kind !== "hierarchy" || !canEditProfiles || state === "saving") return;
    setState("saving");
    const { data, error } = await createClient().rpc("set_workspace_member_hierarchy_role_scope", {
      p_org_id: orgId,
      p_target_user_id: editor.member.userId,
      p_reports_to_user_id: reportsToUserId || null,
      p_role: role,
      p_scope: scope,
      p_request_id: crypto.randomUUID(),
    });
    if (error || !acceptedReply(data)) {
      setState(isUnavailableRpcError(error) ? "unavailable" : "error");
      return;
    }
    setState("saved");
  }

  async function savePermission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || editor.kind !== "permission" || editor.member.role !== "member" || !canEditProfiles || state === "saving") return;
    const scopeKey = normalizePermissionScopeKey(permissionScopeKey);
    if (!scopeKey) {
      setState("error");
      return;
    }
    setState("saving");
    const { data, error } = await createClient().rpc("bind_workspace_lower_member_permission", {
      p_org_id: orgId,
      p_target_user_id: editor.member.userId,
      p_scope_key: scopeKey,
      p_decision: permissionDecision,
      p_access_level: permissionAccess,
      p_request_id: crypto.randomUUID(),
    });
    if (error || !acceptedReply(data)) {
      setState(isUnavailableRpcError(error) ? "unavailable" : "error");
      return;
    }
    setState("saved");
  }

  const section = (label: string, rows: MemberSummaryRow[], empty: string) => (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="font-semibold">{label}</h2>
      {rows.length ? <ul className="mt-3 grid gap-2"><>{rows.map((member) => <MemberCard key={member.userId} member={member} isViewer={member.userId === viewerUserId} canEdit={canEditProfiles} onProfileEdit={beginProfileEdit} onHierarchyEdit={beginHierarchyEdit} onPermissionEdit={beginPermissionEdit} />)}</></ul> : <p className="mt-2 text-sm text-zinc-500">{empty}</p>}
    </section>
  );

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-mw-automation bg-mw-tint-teal p-4">
        <h2 className="font-semibold">대표</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">대표 권한과 조직 단계는 이 화면에서 바꾸거나 지울 수 없어요.</p>
        <ul className="mt-3"><MemberCard member={owner} protectedOwner isViewer={owner.userId === viewerUserId} canEdit={false} onProfileEdit={beginProfileEdit} onHierarchyEdit={beginHierarchyEdit} onPermissionEdit={beginPermissionEdit} /></ul>
      </section>
      {section("팀장", admins, "아직 팀장이 없어요.")}
      {section("사원", members, "아직 사원이 없어요.")}
      {editor?.kind === "profile" ? (
        <section aria-label="구성원 프로필 수정" className="rounded-2xl border border-mw-primary bg-white p-4 dark:bg-zinc-950">
          <h2 className="font-semibold">{editor.member.displayName}의 직책과 팀</h2>
          <form className="mt-4 grid gap-3" onSubmit={save}>
            <label htmlFor={titleId} className="grid gap-1 text-sm font-medium">직책<input id={titleId} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} className="rounded-xl border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700" /></label>
            <label htmlFor={teamId} className="grid gap-1 text-sm font-medium">팀 식별자<input id={teamId} value={teamKey} onChange={(event) => setTeamKey(event.target.value)} maxLength={64} pattern="[a-z0-9][a-z0-9_-]{0,63}" className="rounded-xl border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700" /></label>
            {state === "error" ? <p role="alert" className="text-sm text-red-600">저장하지 못했어요. 권한과 연결을 다시 확인해 주세요.</p> : null}
            {state === "saved" ? <p role="status" className="text-sm text-emerald-700">저장했어요. 새로고침하면 최신 조직도에 반영돼요.</p> : null}
            <div className="flex flex-wrap gap-2"><button type="submit" disabled={state === "saving"} className="rounded-xl bg-mw-primary px-4 py-2 text-sm font-semibold text-mw-on-accent">{state === "saving" ? "저장 중…" : "저장"}</button><button type="button" onClick={() => setEditor(null)} className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold dark:border-zinc-700">닫기</button></div>
          </form>
        </section>
      ) : null}
      {editor?.kind === "hierarchy" ? (
        <section aria-label="구성원 업무 역할 설정" className="rounded-2xl border border-mw-primary bg-white p-4 dark:bg-zinc-950">
          <h2 className="font-semibold">{editor.member.displayName}의 업무 역할</h2>
          <p className="mt-1 text-sm text-zinc-500">대표 본인·다른 회사 구성원은 바꿀 수 없어요. 저장 시 서버가 세션, 대상, 순환 보고선을 다시 확인해요.</p>
          <form className="mt-4 grid gap-3" onSubmit={saveHierarchy}>
            <label className="grid gap-1 text-sm font-medium">역할<select value={role} onChange={(event) => setRole(event.target.value as "admin" | "member")} className="rounded-xl border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"><option value="admin">팀장</option><option value="member">사원</option></select></label>
            <label className="grid gap-1 text-sm font-medium">업무 범위<select value={scope} onChange={(event) => setScope(event.target.value as "all" | "assigned")} className="rounded-xl border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"><option value="assigned">배정된 업무</option><option value="all">회사 업무 전체</option></select></label>
            <label className="grid gap-1 text-sm font-medium">보고받는 사람<select value={reportsToUserId} onChange={(event) => setReportsToUserId(event.target.value)} className="rounded-xl border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"><option value="">지정하지 않음</option>{reportingLineCandidates.filter((candidate) => candidate.userId !== editor.member.userId).map((candidate) => <option key={candidate.userId} value={candidate.userId}>{candidate.displayName} · {roleLabel(candidate.role)}</option>)}</select></label>
            {state === "unavailable" ? <p role="alert" className="text-sm text-zinc-600">업무 역할 변경 기능을 아직 사용할 수 없어요. 서버 준비가 끝난 뒤 다시 시도해 주세요.</p> : null}
            {state === "error" ? <p role="alert" className="text-sm text-red-600">저장하지 못했어요. 본인·대표·다른 회사 구성원은 변경할 수 없고, 순환되는 보고선도 설정할 수 없어요.</p> : null}
            {state === "saved" ? <p role="status" className="text-sm text-emerald-700">저장했어요. 새로고침하면 최신 조직도에 반영돼요.</p> : null}
            <div className="flex flex-wrap gap-2"><button type="submit" disabled={state === "saving"} className="rounded-xl bg-mw-primary px-4 py-2 text-sm font-semibold text-mw-on-accent">{state === "saving" ? "저장 중…" : "변경 저장"}</button><button type="button" onClick={() => setEditor(null)} className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold dark:border-zinc-700">닫기</button></div>
          </form>
        </section>
      ) : null}
      {editor?.kind === "permission" ? (
        <section aria-label="사원 세부 권한 설정" className="rounded-2xl border border-mw-primary bg-white p-4 dark:bg-zinc-950">
          <h2 className="font-semibold">{editor.member.displayName}의 세부 권한</h2>
          <p className="mt-1 text-sm text-zinc-500">사원에게만 적용해요. 범위 키는 회사 안에서 이미 정한 업무 영역만 입력해 주세요.</p>
          <form className="mt-4 grid gap-3" onSubmit={savePermission}>
            <label className="grid gap-1 text-sm font-medium">업무 범위 키<input value={permissionScopeKey} onChange={(event) => setPermissionScopeKey(event.target.value)} maxLength={96} pattern="[a-z0-9][a-z0-9:_./-]{0,95}" placeholder="예: board:sales" className="rounded-xl border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700" /></label>
            <label className="grid gap-1 text-sm font-medium">결정<select value={permissionDecision} onChange={(event) => setPermissionDecision(event.target.value as PermissionDecision)} className="rounded-xl border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"><option value="allow">허용</option><option value="deny">차단</option></select></label>
            <label className="grid gap-1 text-sm font-medium">접근 수준<select value={permissionAccess} onChange={(event) => setPermissionAccess(event.target.value as PermissionAccess)} className="rounded-xl border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"><option value="viewer">보기</option><option value="editor">편집</option></select></label>
            {state === "unavailable" ? <p role="alert" className="text-sm text-zinc-600">세부 권한 변경 기능을 아직 사용할 수 없어요. 서버 준비가 끝난 뒤 다시 시도해 주세요.</p> : null}
            {state === "error" ? <p role="alert" className="text-sm text-red-600">저장하지 못했어요. 범위 형식과 대표 권한, 대상 상태를 다시 확인해 주세요.</p> : null}
            {state === "saved" ? <p role="status" className="text-sm text-emerald-700">저장했어요. 새로고침하면 최신 권한 상태에 반영돼요.</p> : null}
            <div className="flex flex-wrap gap-2"><button type="submit" disabled={state === "saving"} className="rounded-xl bg-mw-primary px-4 py-2 text-sm font-semibold text-mw-on-accent">{state === "saving" ? "저장 중…" : "권한 저장"}</button><button type="button" onClick={() => setEditor(null)} className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold dark:border-zinc-700">닫기</button></div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
