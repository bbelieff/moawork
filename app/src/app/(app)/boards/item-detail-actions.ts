"use server";

import { getSession } from "@/lib/auth/session";
import { listOrgMemberOptions } from "@/lib/deal/members";
import { createClient } from "@/lib/supabase/server";
import {
  BOARD_ITEM_FILES_BUCKET,
  boardItemStoragePath,
  encodeNoticeFile,
} from "@/lib/notices/official-file";
import { sanitizeFileName } from "@/lib/services/files";
import { createRequestBoards } from "@/lib/boards/server";
import { resolveBoardDetailLayout, resolveDetailLayout } from "@/lib/boards/detail-layout";
import type { CellValue } from "@/lib/boards/types";
import type {
  DetailEventKind,
  SelectableDetailEventKind,
} from "@/lib/boards/detail-event-kinds";
import { loadPermGuard } from "@/lib/perm/guard";
import {
  CREDIT_SCORE_KEYS,
  EXISTING_LOAN_KEYS,
  parseCreditScore,
  parseLoanMonth,
  parseOptionalNumber,
} from "@/lib/new-lead/financial-profile";
import {
  cloudFolderProviderLabel,
  inspectCloudFolderUrl,
  providerFromCloudFolderUrl,
  type CloudFolderLink,
} from "@/lib/boards/cloud-folder-link";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ITEM_DETAIL_LIMITS = {
  fileBytes: 10 * 1024 * 1024,
  fileCount: 5,
  fileTotalBytes: 30 * 1024 * 1024,
  linkCount: 20,
  linkLabelChars: 100,
  linkUrlChars: 2048,
} as const;

export type ItemDetailEvent = {
  id: string;
  /* #662 — 배지에 뜨는 다섯. 고를 수 있는 넷은 아래 addItemDetailEventAction 이 좁힌다. */
  kind: DetailEventKind;
  body: string;
  metadata?: unknown;
  actor_id: string | null;
  created_at: string;
  /* #672 — 치워진 줄. 행은 남아 있고 화면에서만 접힌다. */
  deleted_at?: string | null;
  deleted_by?: string | null;
  /* v17-detail — 고친 자국. 마이그레이션 150 이전 행은 둘 다 비어 있다. */
  edited_at?: string | null;
  edit_count?: number | null;
};
export type ItemDetailLink = {
  id: string;
  label: string;
  url: string;
  created_at: string;
};
export type ItemDetailFile = {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  downloadUrl?: string;
};
export type ItemDetailSnapshot = {
  ok: boolean;
  message?: string;
  events: ItemDetailEvent[];
  links: ItemDetailLink[];
  cloudFolder?: CloudFolderLink | null;
  files: ItemDetailFile[];
  members: { id: string; name: string | null }[];
  viewerId?: string;
  /* #672 — 「치우기」를 보일지 정하는 데 쓴다. 막는 것은 서버(마이그레이션 144)다. */
  viewerRole?: string | null;
  assignedTo?: string | null;
};

async function context(boardId: string, itemId: string) {
  if (!UUID.test(boardId) || !UUID.test(itemId))
    throw new Error("잘못된 상세 요청입니다.");
  const ctx = await getSession();
  const client = await createClient({ noStore: true });
  const { data: item, error } = await client
    .from("items")
    .select("id,board_id,org_id,assigned_to,deleted_at")
    .eq("id", itemId)
    .eq("board_id", boardId)
    .eq("org_id", ctx.org.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !item)
    throw new Error("이 회사 정보를 열 권한이 없거나 항목을 찾을 수 없습니다.");
  if (
    ctx.role !== "owner" &&
    ctx.role !== "admin" &&
    ctx.scope !== "all" &&
    item.assigned_to !== ctx.user.id
  ) {
    throw new Error("이 회사 정보를 열 권한이 없거나 항목을 찾을 수 없습니다.");
  }
  return { ctx, client, item };
}

async function requireItemMutationPermission(orgId: string) {
  const permission = await loadPermGuard(orgId, "work.item_upsert");
  if (permission.kind !== "allowed") {
    throw new Error(
      permission.reason === "permission"
        ? "이 정보를 수정할 권한이 없습니다."
        : "권한을 확인하지 못했습니다.",
    );
  }
}

export async function loadItemDetailAction(
  boardId: string,
  itemId: string,
): Promise<ItemDetailSnapshot> {
  try {
    const { ctx, client, item } = await context(boardId, itemId);
    const [humanEventsResult, fieldEventsResult, linksResult, filesResult, collaboratorsResult, orgMembers] =
      await Promise.all([
        client
          .from("board_item_detail_events")
          .select("id,kind,body,metadata,actor_id,created_at,deleted_at,deleted_by,edited_at,edit_count")
          .eq("org_id", ctx.org.id)
          .eq("board_id", boardId)
          .eq("item_id", itemId)
          .in("kind", ["memo", "call", "admin", "meeting"])
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(100),
        client
          .from("board_item_detail_events")
          .select("id,kind,body,metadata,actor_id,created_at,deleted_at,deleted_by")
          .eq("org_id", ctx.org.id)
          .eq("board_id", boardId)
          .eq("item_id", itemId)
          .eq("kind", "field_change")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(100),
        client
          .from("board_item_detail_links")
          .select("id,label,url,created_at,link_kind")
          .eq("org_id", ctx.org.id)
          .eq("board_id", boardId)
          .eq("item_id", itemId)
          .order("created_at", { ascending: false })
          .limit(ITEM_DETAIL_LIMITS.linkCount + 1),
        client
          .from("board_item_detail_files")
          .select("id,name,mime_type,size_bytes,storage_path,created_at")
          .eq("org_id", ctx.org.id)
          .eq("board_id", boardId)
          .eq("item_id", itemId)
          .order("created_at", { ascending: false })
          .limit(ITEM_DETAIL_LIMITS.fileCount),
        client
          .from("item_values")
          .select("value_jsonb")
          .eq("org_id", ctx.org.id)
          .eq("item_id", itemId)
          .eq("column_key", "collaborators")
          .maybeSingle(),
        ctx.role === "owner" || ctx.role === "admin" || ctx.scope === "all"
          ? listOrgMemberOptions(ctx)
          : Promise.resolve([]),
      ]);
    if (humanEventsResult.error || fieldEventsResult.error || linksResult.error || filesResult.error || collaboratorsResult.error)
      throw new Error("상세 기록을 불러오지 못했습니다.");
    // Separate limits keep machine churn from crowding human conversations out.
    const events = ([...(humanEventsResult.data ?? []), ...(fieldEventsResult.data ?? [])] as ItemDetailEvent[])
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
    const files = await Promise.all(
      (
        (filesResult.data ?? []) as Array<
          ItemDetailFile & { storage_path: string }
        >
      ).map(async (file) => {
        const signed = await client.storage
          .from(BOARD_ITEM_FILES_BUCKET)
          .createSignedUrl(file.storage_path, 300);
        return {
          id: file.id,
          name: file.name,
          mime_type: file.mime_type,
          size_bytes: file.size_bytes,
          created_at: file.created_at,
          downloadUrl: signed.data?.signedUrl,
        };
      }),
    );
    const rawCollaborators = collaboratorsResult.data?.value_jsonb;
    const collaboratorIds = Array.isArray(rawCollaborators)
      ? rawCollaborators.filter((value): value is string => typeof value === "string" && UUID.test(value))
      : [];
    const eventActorIds = events.map((event) => event.actor_id);
    const referencedValues = events.flatMap((event) => {
      if (event.kind !== "field_change" || !event.metadata || typeof event.metadata !== "object") return [];
      const metadata = event.metadata as Record<string, unknown>;
      return [metadata.before, metadata.after].flat().filter((value): value is string => typeof value === "string");
    });
    const referencedMemberIds = orgMembers.filter((member) => referencedValues.includes(member.id)).map((member) => member.id);
    const memberIds = [...new Set([item.assigned_to, ...collaboratorIds, ...eventActorIds, ...referencedMemberIds].filter((value): value is string => Boolean(value)))];
    const members = memberIds.map((id) => orgMembers.find((member) => member.id === id) ?? { id, name: null });
    const rawLinks = (linksResult.data ?? []) as Array<
      ItemDetailLink & { link_kind: string | null }
    >;
    const folderRow = rawLinks.find((link) => link.link_kind === "cloud_folder");
    const folderProvider = folderRow
      ? providerFromCloudFolderUrl(folderRow.url)
      : null;
    return {
      ok: true,
      events,
      links: rawLinks
        .filter((link) => link.link_kind !== "cloud_folder")
        .map((link) => ({
          id: link.id,
          label: link.label,
          url: link.url,
          created_at: link.created_at,
        })),
      cloudFolder: folderRow && folderProvider
        ? {
            id: folderRow.id,
            url: folderRow.url,
            provider: folderProvider,
            providerLabel: cloudFolderProviderLabel(folderProvider),
          }
        : null,
      files,
      members,
      viewerId: ctx.user.id,
      viewerRole: ctx.role,
      assignedTo: item.assigned_to ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "상세 기록을 불러오지 못했습니다.",
      events: [],
      links: [],
      files: [],
      members: [],
    };
  }
}

export async function saveItemCloudFolderAction(input: {
  boardId: string;
  itemId: string;
  url: string;
  requestId: string;
}): Promise<ItemDetailSnapshot> {
  try {
    const inspected = inspectCloudFolderUrl(input.url);
    if (!inspected.ok) throw new Error(inspected.message);
    if (!UUID.test(input.requestId))
      throw new Error("요청 식별자가 올바르지 않습니다.");
    const { ctx, client } = await context(input.boardId, input.itemId);
    await requireItemMutationPermission(ctx.org.id);
    const { error } = await client.rpc("set_board_item_cloud_folder", {
      p_org_id: ctx.org.id,
      p_board_id: input.boardId,
      p_item_id: input.itemId,
      p_provider: inspected.provider,
      p_folder_ref: inspected.folderRef,
      p_request_id: input.requestId,
    });
    if (error)
      throw new Error(
        error.code === "42501"
          ? "클라우드 폴더를 연결할 권한이 없습니다."
          : error.code === "22023"
            ? "파일이 아닌 클라우드 폴더 공유 주소인지 확인해 주세요."
            : "클라우드 폴더를 저장하지 못했습니다. 입력은 그대로 두었습니다.",
      );
    return loadItemDetailAction(input.boardId, input.itemId);
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "클라우드 폴더를 저장하지 못했습니다.",
      events: [],
      links: [],
      files: [],
      members: [],
    };
  }
}

export async function removeItemCloudFolderAction(input: {
  boardId: string;
  itemId: string;
  requestId: string;
}): Promise<ItemDetailSnapshot> {
  try {
    if (!UUID.test(input.requestId))
      throw new Error("요청 식별자가 올바르지 않습니다.");
    const { ctx, client } = await context(input.boardId, input.itemId);
    await requireItemMutationPermission(ctx.org.id);
    const { error } = await client.rpc("set_board_item_cloud_folder", {
      p_org_id: ctx.org.id,
      p_board_id: input.boardId,
      p_item_id: input.itemId,
      p_provider: null,
      p_folder_ref: null,
      p_request_id: input.requestId,
    });
    if (error)
      throw new Error(
        error.code === "42501"
          ? "클라우드 폴더 연결을 해제할 권한이 없습니다."
          : "클라우드 폴더 연결을 해제하지 못했습니다.",
      );
    return loadItemDetailAction(input.boardId, input.itemId);
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "클라우드 폴더 연결을 해제하지 못했습니다.",
      events: [],
      links: [],
      files: [],
      members: [],
    };
  }
}

/*
 * #672 — 히스토리를 «치운다». 지우지 않는다.
 *
 * ★ 서버 함수가 권한을 판정한다(마이그레이션 144). 화면의 버튼 감추기는 «안내» 일 뿐이고,
 *   여기서 다시 규칙을 흉내 내지 않는다 — 두 곳에 같은 규칙을 적으면 반드시 어긋난다.
 */
export async function removeItemDetailEventAction(input: {
  boardId: string;
  itemId: string;
  eventId: string;
}): Promise<ItemDetailSnapshot> {
  return runDetailEventLifecycle(input, "remove_board_item_detail_event", "기록을 치우지");
}

/** 되살리기 — 치운 사람과 대표만. 판정은 역시 서버가 한다. */
export async function restoreItemDetailEventAction(input: {
  boardId: string;
  itemId: string;
  eventId: string;
}): Promise<ItemDetailSnapshot> {
  return runDetailEventLifecycle(input, "restore_board_item_detail_event", "기록을 되살리지");
}

async function runDetailEventLifecycle(
  input: { boardId: string; itemId: string; eventId: string },
  rpc: "remove_board_item_detail_event" | "restore_board_item_detail_event",
  verb: string,
): Promise<ItemDetailSnapshot> {
  try {
    const { ctx, client } = await context(input.boardId, input.itemId);
    await requireItemMutationPermission(ctx.org.id);
    if (!UUID.test(input.eventId)) throw new Error("기록 식별자가 올바르지 않습니다.");
    const { error } = await client.rpc(rpc, {
      p_org_id: ctx.org.id,
      p_board_id: input.boardId,
      p_item_id: input.itemId,
      p_event_id: input.eventId,
    });
    if (error) {
      throw new Error(
        error.code === "42501"
          ? `${verb} 권한이 없습니다.`
          : error.code === "P0002"
            ? "그 기록을 찾지 못했습니다. 화면을 새로 고쳐 주세요."
            : `${verb} 못했습니다. 잠시 뒤 다시 시도해 주세요.`,
      );
    }
    return loadItemDetailAction(input.boardId, input.itemId);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : `${verb} 못했습니다.`,
      events: [],
      links: [],
      files: [],
      members: [],
    };
  }
}

export async function addItemDetailEventAction(input: {
  boardId: string;
  itemId: string;
  /* #662 — 사람이 고를 수 있는 넷만. 자동(field_change)은 시스템이 남긴다. */
  kind: SelectableDetailEventKind;
  body: string;
  requestId: string;
  mentionedUserIds: string[];
}): Promise<ItemDetailSnapshot> {
  try {
    const { ctx, client } = await context(input.boardId, input.itemId);
    await requireItemMutationPermission(ctx.org.id);
    if (!UUID.test(input.requestId))
      throw new Error("요청 식별자가 올바르지 않습니다.");
    const { error } = await client.rpc("add_board_item_detail_event", {
      p_org_id: ctx.org.id,
      p_board_id: input.boardId,
      p_item_id: input.itemId,
      p_kind: input.kind,
      p_body: input.body,
      p_request_id: input.requestId,
      p_mentioned_user_ids: input.mentionedUserIds,
    });
    if (error)
      throw new Error(
        error.code === "42501"
          ? "기록을 추가할 권한이 없습니다."
          : "기록을 저장하지 못했습니다. 입력은 그대로 두었습니다.",
      );
    return loadItemDetailAction(input.boardId, input.itemId);
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "기록을 저장하지 못했습니다.",
      events: [],
      links: [],
      files: [],
      members: [],
    };
  }
}

export async function addItemDetailLinkAction(input: {
  boardId: string;
  itemId: string;
  label: string;
  url: string;
  requestId: string;
}): Promise<ItemDetailSnapshot> {
  try {
    const { ctx, client } = await context(input.boardId, input.itemId);
    await requireItemMutationPermission(ctx.org.id);
    if (!UUID.test(input.requestId))
      throw new Error("요청 식별자가 올바르지 않습니다.");
    const label = input.label.trim();
    const url = input.url.trim();
    if (!label || label.length > ITEM_DETAIL_LIMITS.linkLabelChars)
      throw new Error("링크 이름은 100자 이내로 입력해 주세요.");
    if (url.length > ITEM_DETAIL_LIMITS.linkUrlChars || !url.startsWith("https://"))
      throw new Error("2048자 이내의 https:// 링크를 입력해 주세요.");
    const existing = await client
      .from("board_item_detail_links")
      .select("id", { count: "exact", head: true })
      .eq("org_id", ctx.org.id)
      .eq("board_id", input.boardId)
      .eq("item_id", input.itemId);
    if (existing.error) throw new Error("링크 수를 확인하지 못했습니다.");
    if ((existing.count ?? 0) >= ITEM_DETAIL_LIMITS.linkCount)
      throw new Error("링크는 항목당 20개까지 연결할 수 있습니다.");
    const { error } = await client.rpc("add_board_item_detail_link", {
      p_org_id: ctx.org.id,
      p_board_id: input.boardId,
      p_item_id: input.itemId,
      p_label: label,
      p_url: url,
      p_request_id: input.requestId,
    });
    if (error)
      throw new Error(
        error.code === "42501"
          ? "링크를 추가할 권한이 없습니다."
          : "https:// 링크와 이름을 확인해 주세요.",
      );
    return loadItemDetailAction(input.boardId, input.itemId);
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "링크를 저장하지 못했습니다.",
      events: [],
      links: [],
      files: [],
      members: [],
    };
  }
}

export async function uploadItemDetailFileAction(
  boardId: string,
  itemId: string,
  formData: FormData,
): Promise<ItemDetailSnapshot> {
  let uploadedPath: string | undefined;
  let reservation: { orgId: string; requestId: string } | undefined;
  try {
    const { ctx, client } = await context(boardId, itemId);
    await requireItemMutationPermission(ctx.org.id);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0)
      throw new Error("올릴 파일을 선택해 주세요.");
    const requestId = String(formData.get("requestId") ?? "");
    if (!UUID.test(requestId))
      throw new Error("첨부 요청을 다시 시작해 주세요.");
    if (file.size > ITEM_DETAIL_LIMITS.fileBytes)
      throw new Error("파일 한 개는 10MB까지 올릴 수 있습니다.");
    const existing = await client
      .from("board_item_detail_files")
      .select("size_bytes")
      .eq("org_id", ctx.org.id)
      .eq("board_id", boardId)
      .eq("item_id", itemId);
    if (existing.error) throw new Error("첨부 용량을 확인하지 못했습니다.");
    const existingFiles = existing.data ?? [];
    if (existingFiles.length >= ITEM_DETAIL_LIMITS.fileCount)
      throw new Error("파일은 항목당 5개까지 첨부할 수 있습니다.");
    if (existingFiles.reduce((sum, row) => sum + Number(row.size_bytes || 0), 0) + file.size > ITEM_DETAIL_LIMITS.fileTotalBytes)
      throw new Error("첨부 파일 전체 용량은 항목당 30MB까지입니다.");
    const storedName = sanitizeFileName(file.name);
    const mimeType = file.type || "application/octet-stream";
    const storagePath = boardItemStoragePath(
      ctx.org.id,
      boardId,
      itemId,
      requestId,
      storedName,
    );
    const reserved = await client.rpc("reserve_board_item_detail_file", {
      p_org_id: ctx.org.id,
      p_board_id: boardId,
      p_item_id: itemId,
      p_file_id: requestId,
      p_name: storedName,
      p_mime_type: mimeType,
      p_size_bytes: file.size,
      p_storage_path: storagePath,
      p_request_id: requestId,
    });
    if (reserved.error)
      throw new Error(
        reserved.error.code === "42501"
          ? "파일을 올릴 권한이 없습니다."
          : "첨부 한도와 파일 정보를 확인해 주세요.",
      );
    const reservationRow = Array.isArray(reserved.data) ? reserved.data[0] : reserved.data;
    const reservationState = reservationRow && typeof reservationRow === "object" && "state" in reservationRow
      ? (reservationRow as { state?: unknown }).state
      : null;
    if (reservationState === "finalized") return loadItemDetailAction(boardId, itemId);
    if (reservationState !== "pending") throw new Error("첨부 예약 상태를 확인하지 못했습니다.");
    reservation = { orgId: ctx.org.id, requestId };
    uploadedPath = storagePath;
    const stored = await encodeNoticeFile(file, {
      client,
      orgId: ctx.org.id,
      boardId,
      itemId,
      fileId: requestId,
      upsert: true,
    });
    if (!stored.storagePath)
      throw new Error("파일 저장소를 사용할 수 없습니다.");
    const { error } = await client.rpc("register_board_item_detail_file", {
      p_org_id: ctx.org.id,
      p_board_id: boardId,
      p_item_id: itemId,
      p_file_id: stored.id,
      p_name: stored.name,
      p_mime_type: stored.mimeType,
      p_size_bytes: stored.size,
      p_storage_path: stored.storagePath,
      p_request_id: requestId,
    });
    if (error)
      throw new Error(
        error.code === "42501"
          ? "파일을 올릴 권한이 없습니다."
          : "파일 정보를 저장하지 못했습니다.",
      );
    return loadItemDetailAction(boardId, itemId);
  } catch (error) {
    if (uploadedPath || reservation) {
      try {
        const client = await createClient();
        let cancelled = false;
        if (reservation) {
          const cancellation = await client.rpc("cancel_board_item_detail_file", {
            p_org_id: reservation.orgId,
            p_request_id: reservation.requestId,
          });
          cancelled = !cancellation.error && cancellation.data === true;
        }
        if (uploadedPath && cancelled) {
          await client.storage
            .from(BOARD_ITEM_FILES_BUCKET)
            .remove([uploadedPath]);
        }
      } catch {
        /* best-effort orphan prevention */
      }
    }
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "파일을 올리지 못했습니다.",
      events: [],
      links: [],
      files: [],
      members: [],
    };
  }
}

export async function saveItemDetailFieldAction(input: {
  boardId: string;
  itemId: string;
  fieldKey: string;
  source: "column" | "detail";
  value: string;
}): Promise<{ ok: boolean; message: string }> {
  try {
    const { ctx } = await context(input.boardId, input.itemId);
    await requireItemMutationPermission(ctx.org.id);
    const graph = await createRequestBoards();
    if (input.source === "column") {
      let storedValue: CellValue = input.value;
      if (input.fieldKey === CREDIT_SCORE_KEYS.ncb || input.fieldKey === CREDIT_SCORE_KEYS.kcb) {
        const label = input.fieldKey === CREDIT_SCORE_KEYS.ncb ? "NCB" : "KCB";
        const parsed = parseCreditScore(input.value, label);
        if (!parsed.ok) throw new Error(parsed.message);
        storedValue = parsed.value;
      } else if (input.fieldKey === EXISTING_LOAN_KEYS.month) {
        const parsed = parseLoanMonth(input.value);
        if (!parsed.ok) throw new Error(parsed.message);
        storedValue = parsed.value;
      } else if (input.fieldKey === EXISTING_LOAN_KEYS.amount || input.fieldKey === EXISTING_LOAN_KEYS.rate) {
        const parsed = parseOptionalNumber(
          input.value,
          input.fieldKey === EXISTING_LOAN_KEYS.amount ? "대출 금액" : "대출 금리",
          input.fieldKey === EXISTING_LOAN_KEYS.rate ? 100 : Number.MAX_SAFE_INTEGER,
        );
        if (!parsed.ok) throw new Error(parsed.message);
        storedValue = parsed.value;
      }
      const result = await graph.service.setCells(
        ctx,
        input.boardId,
        input.itemId,
        {
          [input.fieldKey]: storedValue,
        },
      );
      const failure = result.errors.find(
        (error) => error.key === input.fieldKey,
      );
      if (failure) throw new Error(failure.message);
    } else {
      const [board, item] = await Promise.all([
        graph.service.getBoardDetail(ctx, input.boardId),
        graph.repo.getItem(ctx, input.itemId),
      ]);
      if (!item || item.board_id !== input.boardId)
        throw new Error("아이템을 찾을 수 없습니다.");
      const group = item.group_id
        ? board.groups.find((candidate) => candidate.id === item.group_id)
        : undefined;
      const boardLayout = resolveBoardDetailLayout(
        board.board.source,
        board.board.detail_layout_jsonb,
        board.columns,
      );
      const valid = resolveDetailLayout(
        boardLayout,
        group?.detail_layout_jsonb,
      ).entries.some(
        (entry) => entry.key === input.fieldKey && entry.source === "detail",
      );
      if (!valid) throw new Error("현재 상세 배치에 없는 필드입니다.");
      await graph.repo.setValues(ctx, input.itemId, {
        [input.fieldKey]: input.value,
      });
    }
    return { ok: true, message: "✓ 자동 저장됨" };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "저장하지 못했습니다. 입력은 유지됩니다.",
    };
  }
}
