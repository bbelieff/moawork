import { NextResponse } from "next/server";
import { loadWorkspaceRoutingSnapshot, type WorkspaceRoutingSnapshot } from "@/lib/auth/workspace-entry-server";
import { parseWorkspaceRequest, workspaceEntryResumeValue, WORKSPACE_ENTRY_RESUME_COOKIE } from "@/lib/workspace-entry/contracts";
import { createClient } from "@/lib/supabase/server";
import { canUseLocalSeedFallback } from "@/lib/supabase/local-fallback";
import { executeWorkspaceRequest, type WorkspaceEntryRpcClient } from "@/lib/workspace-entry/server";
import { bootstrapApprovedWorkspace } from "@/lib/workspace-entry/bootstrap";
import type { SupabaseClient } from "@supabase/supabase-js";

type SnapshotLoader = () => Promise<WorkspaceRoutingSnapshot>;
type RpcClientLoader = () => Promise<WorkspaceEntryRpcClient>;
type WorkspaceBootstrapper = (client: WorkspaceEntryRpcClient, slug: string) => Promise<void>;
const defaultLoadRpcClient: RpcClientLoader = async () => await createClient() as unknown as WorkspaceEntryRpcClient;

export async function handleWorkspaceRequest(
  request: Request,
  loadSnapshot: SnapshotLoader = loadWorkspaceRoutingSnapshot,
  loadRpcClient: RpcClientLoader = defaultLoadRpcClient,
  bootstrapWorkspace: WorkspaceBootstrapper = async (client, slug) =>
    bootstrapApprovedWorkspace(client as unknown as SupabaseClient, slug),
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

  // 회사 생성·가입·취소는 영속 RPC가 필요한 쓰기다. 개발 미연결 상태에서 성공한 척하지 않고,
  // 운영에서는 종전처럼 Supabase 설정 누락을 fail-closed로 유지한다.
  if (loadRpcClient === defaultLoadRpcClient
    && process.env.NODE_ENV !== "production"
    && canUseLocalSeedFallback()) {
    return NextResponse.json({
      ok: false,
      state: "unavailable",
      message: "회사 요청은 연결된 워크스페이스가 필요합니다.",
    }, { status: 503 });
  }

  const rpcClient = await loadRpcClient();
  const { result, status } = await executeWorkspaceRequest(rpcClient, parsed.input);
  if (parsed.input.kind === "create" && result.ok && result.state === "approved" && result.redirectTo) {
    const slug = result.redirectTo.startsWith("/w/") ? result.redirectTo.slice(3) : "";
    try {
      if (!slug) throw new Error("invalid workspace redirect");
      await bootstrapWorkspace(rpcClient, slug);
    } catch {
      return NextResponse.json({
        ok: false,
        state: "unavailable",
        message: "회사 기본 구조를 준비하지 못했습니다. 같은 요청으로 다시 시도해 주세요.",
      }, { status: 503 });
    }
  }
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

