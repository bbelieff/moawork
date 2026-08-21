"use client";

import { useActionState, useEffect, useState } from "react";
import { requestWorkspaceDeletionAction, restoreWorkspaceDeletionAction, type WorkspaceDeletionActionState } from "@/app/(app)/settings/account/actions";
import styles from "./account.module.css";

export type ManagedWorkspace = {
  orgId: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "member";
  status: "active" | "pending_delete";
  deletionRequestedAt: string | null;
};

const initialState: WorkspaceDeletionActionState = { kind: "idle", message: "" };

export function deletionConfirmationMatches(name: string, confirmation: string) {
  return confirmation === name;
}

function ActiveWorkspaceCard({ workspace }: { workspace: ManagedWorkspace }) {
  const [confirmation, setConfirmation] = useState("");
  const [state, action, pending] = useActionState(requestWorkspaceDeletionAction, initialState);
  useEffect(() => {
    if (state.kind === "success") window.location.assign("/workspaces");
  }, [state.kind]);
  const owner = workspace.role === "owner";
  return <li className={styles.workspaceRow}>
    <div><strong>{workspace.name}</strong><small>/w/{workspace.slug} · {workspace.role === "owner" ? "대표" : workspace.role === "admin" ? "관리자" : "멤버"}</small></div>
    {owner ? <details className={styles.deletionDetails}>
      <summary>회사 삭제 예약</summary>
      <p>회사는 즉시 지워지지 않아요. 목록에서 숨겨지고, 되돌릴 수 있는 삭제 예정 상태로 바뀝니다.</p>
      <form action={action}>
        <input type="hidden" name="orgId" value={workspace.orgId} />
        <input type="hidden" name="workspaceName" value={workspace.name} />
        <label>확인을 위해 <strong>{workspace.name}</strong> 입력
          <input name="confirmation" value={confirmation} onChange={(event) => setConfirmation(event.currentTarget.value)} autoComplete="off" />
        </label>
        <button className={styles.dangerAction} disabled={pending || !deletionConfirmationMatches(workspace.name, confirmation)}>{pending ? "삭제 예약 중…" : "회사 삭제 예약"}</button>
      </form>
      {state.kind === "error" ? <p role="alert" className={styles.errorText}>{state.message}</p> : null}
    </details> : <p className={styles.permissionReason}>회사 삭제는 현재 대표만 요청할 수 있어요.</p>}
  </li>;
}

function PendingWorkspaceCard({ workspace }: { workspace: ManagedWorkspace }) {
  const [state, action, pending] = useActionState(restoreWorkspaceDeletionAction, initialState);
  useEffect(() => {
    if (state.kind === "success") window.location.assign(`/w/${workspace.slug}`);
  }, [state.kind, workspace.slug]);
  return <li className={`${styles.workspaceRow} ${styles.pendingWorkspace}`}>
    <div><strong>{workspace.name}</strong><small>삭제 예정 · 데이터는 보존 중</small></div>
    <form action={action}>
      <input type="hidden" name="orgId" value={workspace.orgId} />
      <button className={styles.secondaryAction} disabled={pending}>{pending ? "되돌리는 중…" : "삭제 예정 되돌리기"}</button>
    </form>
    {state.kind === "error" ? <p role="alert" className={styles.errorText}>{state.message}</p> : null}
  </li>;
}

export function WorkspaceManagementPanel({ workspaces, loadError = false }: { workspaces: ManagedWorkspace[]; loadError?: boolean }) {
  if (loadError) return <div className={styles.workspaceError} role="alert"><strong>회사 목록을 불러오지 못했어요.</strong><p>회사가 없는 상태가 아니에요. 잠시 뒤 다시 확인해 주세요.</p></div>;
  if (workspaces.length === 0) return <p>접근 가능한 회사가 없어요.</p>;
  return <ul className={styles.workspaceList}>{workspaces.map((workspace) => workspace.status === "pending_delete"
    ? <PendingWorkspaceCard key={workspace.orgId} workspace={workspace} />
    : <ActiveWorkspaceCard key={workspace.orgId} workspace={workspace} />)}</ul>;
}
