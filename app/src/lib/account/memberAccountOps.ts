import { createClient } from "@/lib/supabase/server";

type RpcResult = { accepted?: boolean; replayed?: boolean };

async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error("account_operation_unavailable");
  return data as T;
}

export type MemberSession = { id: string; created_at: string; last_seen_at: string; current_session: boolean };

export async function listMyMemberSessions(orgId: string, currentSessionId: string) {
  return call<MemberSession[]>("list_my_member_account_sessions", {
    p_org_id: orgId,
    p_current_session_id: currentSessionId,
  });
}

export async function revokeCurrentMemberSession(requestId: string, sessionId: string) {
  return call<RpcResult>("revoke_current_member_account_session", { p_request_id: requestId, p_session_id: sessionId });
}

export async function revokeAllMemberSessions(requestId: string) {
  return call<RpcResult>("revoke_all_member_account_sessions", { p_request_id: requestId });
}

export async function getMyPrivacyAccountData(orgId: string) {
  return call<Record<string, unknown>>("get_my_privacy_account_data", { p_org_id: orgId });
}

export async function requestMyPrivacyExport(requestId: string, orgId: string) {
  return call<RpcResult>("request_my_privacy_export", { p_request_id: requestId, p_org_id: orgId });
}

export async function getMySupportReadScope() {
  return call<Array<{ org_id: string; purpose: string; expires_at: string }>>("get_my_support_read_scope", {});
}
