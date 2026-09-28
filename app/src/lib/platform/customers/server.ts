import { createClient } from "@/lib/supabase/server";
import {
  isCustomerSetupStatus,
  isCustomerTaskKind,
  isCustomerTaskStatus,
  parseCustomerDetail,
  parseCustomerHistory,
  parseCustomerList,
  parseCustomerTaskList,
  type CustomerDetail,
  type CustomerHistoryEntry,
  type CustomerListFilter,
  type CustomerSummary,
  type CustomerTask,
} from "./contracts";

export type CustomerRpcClient = {
  rpc(
    name: string,
    params?: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { code?: string | null } | null }>;
};

export type CustomerFailure =
  | { ok: false; reason: "denied" }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "invalid"; message: string }
  | { ok: false; reason: "unavailable" };

export type CustomerListResult = { ok: true; customers: CustomerSummary[] } | CustomerFailure;

export type CustomerDetailResult =
  | { ok: true; customer: CustomerDetail; tasks: CustomerTask[]; history: CustomerHistoryEntry[] }
  | CustomerFailure;

export type CustomerMutationResult =
  | { ok: true; changed: boolean }
  | { ok: true; created: boolean; taskId: string }
  | CustomerFailure;

const INVALID_MESSAGE_BY_CODE: Record<string, string> = {
  "customer status filter invalid": "상태 필터를 확인해 주세요.",
  "customer search too long": "검색어가 너무 길어요.",
  "customer page window invalid": "목록 범위를 확인해 주세요.",
  "customer setup status invalid": "도입 상태를 확인해 주세요.",
  "customer invite state invalid": "초대 상태를 확인해 주세요.",
  "customer task title length invalid": "작업 내용을 1~120자로 입력해 주세요.",
  "customer task kind invalid": "작업 구분을 확인해 주세요.",
  "customer task status invalid": "작업 상태를 확인해 주세요.",
  "task id required": "작업 식별자를 확인해 주세요.",
  "idempotency key reuse with different task": "이미 같은 번호로 다른 작업이 있어요. 새로 추가해 주세요.",
};

/**
 * PostgREST 오류 → 화면 계약. 권한 거부·없음·잘못된 입력·일시 실패를 섞지 않는다.
 * DB 메시지는 키로만 쓰고, 화면 문구는 여기서 정한다(내부명 노출 금지).
 */
export function customerFailureFromRpcError(error: { code?: string | null; message?: string | null }): CustomerFailure {
  if (error.code === "42501") return { ok: false, reason: "denied" };
  if (error.code === "P0002") return { ok: false, reason: "not-found" };
  if (error.code === "22023" || error.code === "23505" || error.code === "23514") {
    const message = error.message ?? "";
    for (const [key, text] of Object.entries(INVALID_MESSAGE_BY_CODE)) {
      if (message.includes(key)) return { ok: false, reason: "invalid", message: text };
    }
    return { ok: false, reason: "invalid", message: "입력값을 확인해 주세요." };
  }
  return { ok: false, reason: "unavailable" };
}

export async function readPlatformCustomerList(
  client: CustomerRpcClient,
  query: { search: string; status: CustomerListFilter; limit?: number; offset?: number },
): Promise<CustomerListResult> {
  const { data, error } = await client.rpc("list_platform_customers", {
    p_search: query.search,
    p_status: query.status,
    p_limit: query.limit ?? 50,
    p_offset: query.offset ?? 0,
  });
  if (error) return customerFailureFromRpcError(error);
  const customers = parseCustomerList(data);
  if (!customers) return { ok: false, reason: "unavailable" };
  return { ok: true, customers };
}

export async function readPlatformCustomerDetail(
  client: CustomerRpcClient,
  orgId: string,
): Promise<CustomerDetailResult> {
  const [detail, tasks, history] = await Promise.all([
    client.rpc("get_platform_customer", { p_org_id: orgId }),
    client.rpc("list_platform_customer_tasks", { p_org_id: orgId }),
    client.rpc("list_platform_customer_history", { p_org_id: orgId, p_limit: 200 }),
  ]);
  if (detail.error) return customerFailureFromRpcError(detail.error);
  // 상세는 셋이 한 묶음이다. 하나라도 깨지면 반쪽 화면을 그리지 않는다.
  if (tasks.error || history.error) return { ok: false, reason: "unavailable" };
  const customer = parseCustomerDetail(detail.data);
  const taskList = parseCustomerTaskList(tasks.data);
  const historyList = parseCustomerHistory(history.data);
  if (!customer || !taskList || !historyList) return { ok: false, reason: "unavailable" };
  return { ok: true, customer, tasks: taskList, history: historyList };
}

export async function writeCustomerSetup(
  client: CustomerRpcClient,
  orgId: string,
  setupStatus: string,
): Promise<CustomerMutationResult> {
  if (!isCustomerSetupStatus(setupStatus)) {
    return { ok: false, reason: "invalid", message: "도입 상태를 확인해 주세요." };
  }
  const { data, error } = await client.rpc("set_platform_customer_setup", {
    p_org_id: orgId,
    p_setup_status: setupStatus,
  });
  if (error) return customerFailureFromRpcError(error);
  const row = data !== null && typeof data === "object" ? (data as Record<string, unknown>) : null;
  if (!row || row.ok !== true || typeof row.changed !== "boolean") return { ok: false, reason: "unavailable" };
  return { ok: true, changed: row.changed };
}

export async function writeCustomerInvite(
  client: CustomerRpcClient,
  orgId: string,
  inviteState: string,
): Promise<CustomerMutationResult> {
  // 'active'는 파생값이라 직접 기록하지 않는다 — DB도 같은 이유로 거부한다.
  if (inviteState !== "pending" && inviteState !== "sent") {
    return { ok: false, reason: "invalid", message: "초대 상태는 발송 전·발송만 기록할 수 있어요." };
  }
  const { data, error } = await client.rpc("record_platform_customer_invite", {
    p_org_id: orgId,
    p_invite_state: inviteState,
  });
  if (error) return customerFailureFromRpcError(error);
  const row = data !== null && typeof data === "object" ? (data as Record<string, unknown>) : null;
  if (!row || row.ok !== true || typeof row.changed !== "boolean") return { ok: false, reason: "unavailable" };
  return { ok: true, changed: row.changed };
}

export async function writeCustomerTask(
  client: CustomerRpcClient,
  orgId: string,
  input: { taskId: string; title: string; kind: string },
): Promise<CustomerMutationResult> {
  const title = input.title.trim();
  if (title.length < 1 || title.length > 120) {
    return { ok: false, reason: "invalid", message: "작업 내용을 1~120자로 입력해 주세요." };
  }
  if (!isCustomerTaskKind(input.kind)) {
    return { ok: false, reason: "invalid", message: "작업 구분을 확인해 주세요." };
  }
  const { data, error } = await client.rpc("create_platform_customer_task", {
    p_task_id: input.taskId,
    p_org_id: orgId,
    p_title: title,
    p_kind: input.kind,
  });
  if (error) return customerFailureFromRpcError(error);
  const row = data !== null && typeof data === "object" ? (data as Record<string, unknown>) : null;
  if (!row || row.ok !== true || typeof row.created !== "boolean") return { ok: false, reason: "unavailable" };
  return { ok: true, created: row.created, taskId: input.taskId };
}

export async function writeCustomerTaskStatus(
  client: CustomerRpcClient,
  orgId: string,
  taskId: string,
  status: string,
): Promise<CustomerMutationResult> {
  if (!isCustomerTaskStatus(status)) {
    return { ok: false, reason: "invalid", message: "작업 상태를 확인해 주세요." };
  }
  const { data, error } = await client.rpc("update_platform_customer_task", {
    p_task_id: taskId,
    p_org_id: orgId,
    p_status: status,
  });
  if (error) return customerFailureFromRpcError(error);
  const row = data !== null && typeof data === "object" ? (data as Record<string, unknown>) : null;
  if (!row || row.ok !== true || typeof row.changed !== "boolean") return { ok: false, reason: "unavailable" };
  return { ok: true, changed: row.changed };
}

/** 페이지·API 라우트의 기본 클라이언트. 테스트는 주입된 스텁을 쓴다. */
export async function platformCustomerClient(): Promise<CustomerRpcClient> {
  return (await createClient()) as unknown as CustomerRpcClient;
}
