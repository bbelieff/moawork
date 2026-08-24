"use server";

import { getSession } from "@/lib/auth/session";
import { listOrgMemberOptions } from "@/lib/deal/members";
import { createClient } from "@/lib/supabase/server";
import {
  BOARD_ITEM_FILES_BUCKET,
  encodeNoticeFile,
} from "@/lib/notices/official-file";
import { createRequestBoards } from "@/lib/boards/server";
import { resolveDetailLayout } from "@/lib/boards/detail-layout";
import { loadPermGuard } from "@/lib/perm/guard";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ItemDetailEvent = {
  id: string;
  kind: "memo" | "call" | "field_change";
  body: string;
  actor_id: string | null;
  created_at: string;
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
  files: ItemDetailFile[];
  members: { id: string; name: string | null }[];
  viewerId?: string;
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
    const [eventsResult, linksResult, filesResult, orgMembers] =
      await Promise.all([
        client
          .from("board_item_detail_events")
          .select("id,kind,body,actor_id,created_at")
          .eq("org_id", ctx.org.id)
          .eq("board_id", boardId)
          .eq("item_id", itemId)
          .order("created_at", { ascending: false })
          .limit(100),
        client
          .from("board_item_detail_links")
          .select("id,label,url,created_at")
          .eq("org_id", ctx.org.id)
          .eq("board_id", boardId)
          .eq("item_id", itemId)
          .order("created_at", { ascending: false })
          .limit(50),
        client
          .from("board_item_detail_files")
          .select("id,name,mime_type,size_bytes,storage_path,created_at")
          .eq("org_id", ctx.org.id)
          .eq("board_id", boardId)
          .eq("item_id", itemId)
          .order("created_at", { ascending: false })
          .limit(50),
        ctx.role === "owner" || ctx.role === "admin" || ctx.scope === "all"
          ? listOrgMemberOptions(ctx)
          : Promise.resolve([]),
      ]);
    if (eventsResult.error || linksResult.error || filesResult.error)
      throw new Error("상세 기록을 불러오지 못했습니다.");
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
    const members = orgMembers.filter(
      (member) => member.id === item.assigned_to,
    );
    if (
      item.assigned_to &&
      !members.some((member) => member.id === item.assigned_to)
    ) {
      const assigned = orgMembers.find(
        (member) => member.id === item.assigned_to,
      );
      members.push(assigned ?? { id: item.assigned_to, name: null });
    }
    return {
      ok: true,
      events: (eventsResult.data ?? []) as ItemDetailEvent[],
      links: (linksResult.data ?? []) as ItemDetailLink[],
      files,
      members,
      viewerId: ctx.user.id,
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

export async function addItemDetailEventAction(input: {
  boardId: string;
  itemId: string;
  kind: "memo" | "call";
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
    const { error } = await client.rpc("add_board_item_detail_link", {
      p_org_id: ctx.org.id,
      p_board_id: input.boardId,
      p_item_id: input.itemId,
      p_label: input.label,
      p_url: input.url,
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
  try {
    const { ctx, client } = await context(boardId, itemId);
    await requireItemMutationPermission(ctx.org.id);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0)
      throw new Error("올릴 파일을 선택해 주세요.");
    const stored = await encodeNoticeFile(file, {
      client,
      orgId: ctx.org.id,
      boardId,
      itemId,
    });
    if (!stored.storagePath)
      throw new Error("파일 저장소를 사용할 수 없습니다.");
    uploadedPath = stored.storagePath;
    const { error } = await client.rpc("register_board_item_detail_file", {
      p_org_id: ctx.org.id,
      p_board_id: boardId,
      p_item_id: itemId,
      p_file_id: stored.id,
      p_name: stored.name,
      p_mime_type: stored.mimeType,
      p_size_bytes: stored.size,
      p_storage_path: stored.storagePath,
      p_request_id: stored.id,
    });
    if (error)
      throw new Error(
        error.code === "42501"
          ? "파일을 올릴 권한이 없습니다."
          : "파일 정보를 저장하지 못했습니다.",
      );
    return loadItemDetailAction(boardId, itemId);
  } catch (error) {
    if (uploadedPath) {
      try {
        const client = await createClient();
        await client.storage
          .from(BOARD_ITEM_FILES_BUCKET)
          .remove([uploadedPath]);
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
      const result = await graph.service.setCells(
        ctx,
        input.boardId,
        input.itemId,
        {
          [input.fieldKey]: input.value,
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
      const valid = resolveDetailLayout(
        board.board.detail_layout_jsonb,
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
