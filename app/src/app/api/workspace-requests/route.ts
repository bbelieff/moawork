import { NextResponse } from "next/server";
import { loadWorkspaceRoutingSnapshot, type WorkspaceRoutingSnapshot } from "@/lib/auth/workspace-entry-server";
import { parseWorkspaceRequest, workspaceEntryResumeValue, WORKSPACE_ENTRY_RESUME_COOKIE } from "@/lib/workspace-entry/contracts";
import { createClient } from "@/lib/supabase/server";
import { executeWorkspaceRequest, type WorkspaceEntryRpcClient } from "@/lib/workspace-entry/server";

type SnapshotLoader = () => Promise<WorkspaceRoutingSnapshot>;
type RpcClientLoader = () => Promise<WorkspaceEntryRpcClient>;

export async function handleWorkspaceRequest(
  request: Request,
  loadSnapshot: SnapshotLoader = loadWorkspaceRoutingSnapshot,
  loadRpcClient: RpcClientLoader = async () => await createClient() as unknown as WorkspaceEntryRpcClient,
): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, state: "invalid", message: "요청을 확인할 수 없어요." }, { status: 400 });
  }

  const parsed = parseWorkspaceRequest(payload);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, state: "invalid", message: parsed.message }, { status: 400 });
  }

  if (parsed.input.kind === "select_workspace") {
    const snapshot = await loadSnapshot();
    if (snapshot.kind === "unauthenticated") {
      return NextResponse.json({ ok: false, state: "unavailable", message: "로그인이 필요해요. 다시 로그인해 주세요." }, { status: 401 });
    }
    const matches = snapshot.kind === "ready"
      ? snapshot.memberships.filter((membership) => membership.orgId === parsed.input.workspaceId)
      : [];
    if (matches.length !== 1) {
      return NextResponse.json({ ok: false, state: "unavailable", message: "회사 접근을 확인할 수 없어요. 목록을 새로 확인해 주세요." }, { status: snapshot.kind === "error" ? 503 : 403 });
    }
    return NextResponse.json({
      ok: true,
      state: "selection_revalidation",
      message: "회사 접근을 다시 확인했어요. 안전하게 이동할게요.",
      redirectTo: `/w/${matches[0].slug}`,
    });
  }

  const { result, status } = await executeWorkspaceRequest(await loadRpcClient(), parsed.input);
  const response = NextResponse.json(result, { status });
  if (result.ok && (parsed.input.kind === "create" || parsed.input.kind === "join")) {
    const resume = workspaceEntryResumeValue(parsed.input.kind, parsed.input.requestId!);
    if (resume) response.cookies.set(WORKSPACE_ENTRY_RESUME_COOKIE, resume, {
      path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
      // The helper cookie cannot outlive the server-side 14-day review window.
      maxAge: 14 * 24 * 60 * 60,
    });
  } else if (result.ok && parsed.input.kind === "cancel") {
    response.cookies.delete(WORKSPACE_ENTRY_RESUME_COOKIE);
  }
  return response;
}

export async function POST(request: Request): Promise<Response> {
  return handleWorkspaceRequest(request);
}
