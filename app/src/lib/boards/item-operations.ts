import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CellValue } from "./types";
import { NEW_LEAD_FIELD_KEYS } from "@/lib/new-lead/cell-fields";
import { CONTACT_TAB_SOURCE, NEW_LEAD_TAB_SOURCE } from "@/lib/default-tabs/types";
import { CONTRACT_WORK_TAB_SOURCE } from "@/lib/default-tabs/contract-work";

/**
 * v17 아이템 연산 3종 공용 모듈 (153 draft SQL의 앱 계층 짝).
 *
 *  - 별도 보관/복구: `archive_board_item_atomic` / `restore_archived_board_item_atomic`
 *  - 안전한 복제: 일반 보드는 `duplicate_board_item_atomic`,
 *    정본 보드는 `duplicate_canonical_deal_item_atomic` 한 호출로 같은 회사의
 *    새 신청과 출처를 만든다. 조직 고유 식별값은 원본에만 남긴다.
 *  - 상하위 연결/해제: `set_board_item_parent_atomic`
 *
 * 보호 RPC가 막히면(미적용·권한·유효성) 가드를 약화하지 않는다: 약한 쓰기 경로로
 * fallback하지 않고 건별 명시 실패로 닫는다. 조회 error를 not-found/null로 바꿔
 * 우회하지도 않는다.
 */

/** 153 draft `item_duplicate_key_blocked` 와 같은 차단 집합 (미리보기·단위검증용). */
const DUPLICATE_BLOCKED_KEY_RE =
  /(approv|seal|sign|contract|deposit|ledger|history|histor|file|assign|receipt|audit|payment|stamp|confirm)/i;

export function isDuplicateBlockedKey(key: string): boolean {
  return ["owner", "collaborators", "assignee"].includes((key ?? "").toLowerCase()) || DUPLICATE_BLOCKED_KEY_RE.test(key ?? "");
}

export function splitDuplicateKeys(keys: readonly string[]): { copied: string[]; skipped: string[] } {
  const copied: string[] = [];
  const skipped: string[] = [];
  for (const key of keys) {
    (isDuplicateBlockedKey(key) ? skipped : copied).push(key);
  }
  return { copied, skipped };
}

/**
 * 단순 JSON 복사를 쓰면 안 되는 정본 딜 계열 보드 출처
 * (153 draft SQL `item_operations_canonical_source` 와 같은 집합).
 * 신규리드·연락·계약업무 보드는 모두 deal 연결 행이므로 같은 원자 복제 RPC를 쓴다.
 */
const CANONICAL_DUPLICATE_SOURCES: ReadonlySet<string> = new Set([
  "core.default-tab/new-lead",
  "core.default-tab/contact",
  "core.default-tab/contract-work",
  "core.crm.new-lead",
  "core.crm.pipeline",
  "core.crm.contact",
  "core.crm.work",
  "new-lead",
  "contact",
  "work",
  NEW_LEAD_TAB_SOURCE,
  CONTACT_TAB_SOURCE,
  CONTRACT_WORK_TAB_SOURCE,
]);

export function requiresCanonicalDuplicate(source: string | null | undefined): boolean {
  return typeof source === "string" && CANONICAL_DUPLICATE_SOURCES.has(source);
}

export function isNewLeadDuplicateSource(source: string | null | undefined): boolean {
  return source === NEW_LEAD_TAB_SOURCE || source === "core.crm.new-lead" || source === "new-lead";
}

export class ItemOperationError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "ItemOperationError";
  }
}

/** RPC 부재(153 미적용·스텁 클라이언트)는 명시 실패 — 약한 경로로 fallback 금지. */
export function isMissingRpc(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code === "42883" || code === "PGRST202") return true;
  const message = String((error as Error | null)?.message ?? "");
  return /function .* does not exist|could not find the function/i.test(message);
}

export function itemOperationMessage(error: unknown): string {
  if (isMissingRpc(error)) {
    return "저장 경로를 준비 중입니다. 잠시 뒤 다시 시도해 주세요.";
  }
  const code = (error as { code?: string } | null)?.code;
  if (code === "42501") return "이 작업을 실행할 권한이 없어요.";
  if (code === "40001") return "다른 사람이 먼저 바꿨습니다. 새로 불러온 뒤 다시 시도해 주세요.";
  if (code === "22023") {
    const message = String((error as Error | null)?.message ?? "");
    if (/canonical/i.test(message)) return "정본 보드는 낱개 정본 흐름으로 복제해 주세요. 단순 복사는 지원하지 않습니다.";
    if (/cycle/i.test(message)) return "상하위 연결이 순환됩니다. 다른 부모를 선택해 주세요.";
    if (/own parent/i.test(message)) return "자기 자신을 부모로 연결할 수 없습니다.";
    if (/same workspace and board/i.test(message)) return "부모는 같은 보드의 항목에서만 고를 수 있습니다.";
    if (/already archived/i.test(message)) return "이미 보관된 항목입니다.";
    if (/not archived/i.test(message)) return "보관된 항목이 아닙니다.";
    if (/trashed/i.test(message)) return "휴지통 항목은 먼저 복구한 뒤 처리해 주세요.";
    if (/payload mismatch/i.test(message)) return "이전 요청과 내용이 달라 처리할 수 없습니다. 선택을 확인해 주세요.";
    return "요청 내용과 보드 상태를 확인해 주세요.";
  }
  const message = String((error as Error | null)?.message ?? "").trim();
  return message || "저장하지 못했습니다. 다시 시도해 주세요.";
}

function oneRow<T>(data: unknown, required: readonly string[]): T {
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row || required.some((key) => !(key in row))) {
    throw new ItemOperationError("서버 결과를 확인하지 못했습니다.");
  }
  return row as T;
}

async function callRpc<T>(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
  required: readonly string[],
): Promise<T> {
  const result = await client.rpc(fn, args);
  if (result.error) throw new ItemOperationError(itemOperationMessage(result.error), result.error.code);
  return oneRow<T>(result.data, required);
}

export interface ArchiveReceipt {
  item_id: string;
  archived_at: string;
  replayed: boolean;
}

export interface ParentReceipt {
  item_id: string;
  parent_item_id: string | null;
  replayed: boolean;
}

export interface DuplicateReceipt {
  source_item_id: string;
  new_item_id: string;
  copied_values: number;
  skipped_values: number;
  replayed: boolean;
}

export interface DuplicateLinkReceipt {
  source_item_id: string;
  new_item_id: string;
  replayed: boolean;
}

export async function archiveItemAtomic(
  client: SupabaseClient,
  input: Readonly<{ orgId: string; boardId: string; itemId: string; requestId: string; expectedUpdatedAt?: string | null }>,
): Promise<ArchiveReceipt> {
  return callRpc<ArchiveReceipt>(client, "archive_board_item_atomic", {
    p_org_id: input.orgId,
    p_board_id: input.boardId,
    p_item_id: input.itemId,
    p_request_id: input.requestId,
    p_expected_updated_at: input.expectedUpdatedAt ?? null,
  }, ["item_id", "replayed"]);
}

export async function restoreArchivedItemAtomic(
  client: SupabaseClient,
  input: Readonly<{ orgId: string; boardId: string; itemId: string; requestId: string; expectedUpdatedAt?: string | null }>,
): Promise<{ item_id: string; replayed: boolean }> {
  return callRpc(client, "restore_archived_board_item_atomic", {
    p_org_id: input.orgId,
    p_board_id: input.boardId,
    p_item_id: input.itemId,
    p_request_id: input.requestId,
    p_expected_updated_at: input.expectedUpdatedAt ?? null,
  }, ["item_id", "replayed"]);
}

export async function setItemParentAtomic(
  client: SupabaseClient,
  input: Readonly<{ orgId: string; boardId: string; itemId: string; parentItemId: string | null; requestId: string; expectedUpdatedAt?: string | null }>,
): Promise<ParentReceipt> {
  return callRpc<ParentReceipt>(client, "set_board_item_parent_atomic", {
    p_org_id: input.orgId,
    p_board_id: input.boardId,
    p_item_id: input.itemId,
    p_parent_item_id: input.parentItemId,
    p_request_id: input.requestId,
    p_expected_updated_at: input.expectedUpdatedAt ?? null,
  }, ["item_id", "replayed"]);
}

export async function duplicateItemAtomic(
  client: SupabaseClient,
  input: Readonly<{ orgId: string; boardId: string; itemId: string; requestId: string; newItemId?: string; titleOverride?: string | null }>,
): Promise<DuplicateReceipt> {
  return callRpc<DuplicateReceipt>(client, "duplicate_board_item_atomic", {
    p_org_id: input.orgId,
    p_board_id: input.boardId,
    p_item_id: input.itemId,
    p_request_id: input.requestId,
    p_new_item_id: input.newItemId ?? null,
    p_title_override: input.titleOverride ?? null,
  }, ["source_item_id", "new_item_id", "replayed"]);
}

export interface CanonicalDuplicateReceipt {
  source_item_id: string;
  new_item_id: string;
  new_deal_id: string;
  company_id: string | null;
  copied_values: number;
  skipped_values: number;
  replayed: boolean;
}

/**
 * 정본 딜 계열 원자 복제 — 회사 식별자를 새로 만들지 않고 원본 deal의
 * company_id를 새 deal에 그대로 물리는 단일 트랜잭션이다.
 * 출처 기록까지 같은 트랜잭션에서 끝나므로 별도 link 호출이 없다.
 */
export async function duplicateCanonicalDealItemAtomic(
  client: SupabaseClient,
  input: Readonly<{
    orgId: string;
    boardId: string;
    sourceItemId: string;
    requestId: string;
    targetGroupId?: string | null;
    newItemId?: string;
    titleOverride?: string | null;
  }>,
): Promise<CanonicalDuplicateReceipt> {
  return callRpc<CanonicalDuplicateReceipt>(client, "duplicate_canonical_deal_item_atomic", {
    p_org_id: input.orgId,
    p_board_id: input.boardId,
    p_source_item_id: input.sourceItemId,
    p_request_id: input.requestId,
    p_target_group_id: input.targetGroupId ?? null,
    p_new_item_id: input.newItemId ?? null,
    p_title_override: input.titleOverride ?? null,
  }, ["source_item_id", "new_item_id", "new_deal_id", "replayed"]);
}

/**
 * 재시도 멱등 키 — 한 일괄 묶음 키와 연산·항목을 해시해 항목별 안정 requestId를
 * 만든다. 실패분만 다시 실행해도 같은 requestId가 나가므로 RPC가 replay하고
 * 중복 행을 만들지 않는다. 새 복제 ID도 같은 방식으로 안정 생성한다.
 */
export function deriveItemRequestId(bulkKey: string, operation: string, itemId: string): string {
  const digest = createHash("sha256").update(`${bulkKey}:${operation}:${itemId}`, "utf8").digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

export function newBulkKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return deriveItemRequestId(String(Date.now()), "bulk", String(Math.random()));
}

/**
 * 신규리드 정본 복제 입력 — 원본 행의 허용된 입력값만 정본 생성 인자로 옮긴다.
 * EAV 직접 쓰기가 아니라 `create_new_lead` 정본 RPC의 입력이 되므로
 * rep_name/industry/ad_name/biz_reg_type 보호를 그대로 받는다.
 * 담당자·딜 연결·히스토리는 옮기지 않는다 (새 딜/행이 원자 생성된다).
 */
export function buildNewLeadDuplicateInput(values: Readonly<Record<string, CellValue>>): Record<string, string | null> {
  const patch: Record<string, string | null> = {};
  for (const [columnKey, field] of Object.entries(NEW_LEAD_FIELD_KEYS)) {
    const raw = values[columnKey];
    if (typeof raw === "string" && raw.trim() !== "") {
      patch[field] = raw;
    }
  }
  return patch;
}
