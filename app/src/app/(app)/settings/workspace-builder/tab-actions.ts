"use server";

/**
 * #849 탭 관리 › 휴지통 서버 액션 — 복구 · 지금 완전 삭제 · 기본 탭 다시 설치.
 *
 * 결과는 `?section=tabs&…` 로 돌려보낸다. URL 에는 탭 id·오류 코드만 싣고 문장은 화면이 고른다
 * (TabTrashSurface 의 TAB_TRASH_ERRORS). 실패해도 전면 오류 화면으로 새지 않는다.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { loadPermGuard } from "@/lib/perm/guard";
import { recordRiskyAction } from "@/lib/perm/server";
import { NotFoundError } from "@/lib/boards";
import { createRequestBoards } from "@/lib/boards/server";
import { BoardTrashError, DefaultTabAlreadyInstalledError } from "@/lib/boards/trash-errors";
import { DEFAULT_TABS, ensureDefaultTab } from "@/lib/default-tabs/install";
import type { TabTrashErrorCode } from "@/components/workspace-builder/TabTrashSurface";

const TABS_PATH = "/settings/workspace-builder";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function tabsUrl(result: Record<string, string>): string {
  return `${TABS_PATH}?${new URLSearchParams({ section: "tabs", ...result })}`;
}

/** 권한(+위험 작업 기록)을 확인한다. 막히면 화면에 띄울 오류 코드를 돌려준다. */
async function blockedBy(
  orgId: string,
  scopeKey: "danger.bulk_edit_delete" | "structure.tab_manage",
  audit?: Record<string, unknown>,
): Promise<TabTrashErrorCode | null> {
  const permission = await loadPermGuard(orgId, scopeKey);
  if (permission.kind !== "allowed") return permission.reason === "permission" ? "permission" : "unavailable";
  if (audit && !(await recordRiskyAction(orgId, "danger.bulk_edit_delete", audit)).ok) return "audit";
  return null;
}

/** 휴지통 탭(복구·완전 삭제) 실패 → 오류 코드. */
function trashFailureCode(error: unknown, fallback: TabTrashErrorCode): TabTrashErrorCode {
  if (error instanceof DefaultTabAlreadyInstalledError) return "already-installed";
  if (error instanceof NotFoundError) return "not-in-trash";
  if (error instanceof BoardTrashError) {
    if (error.code === "permission_denied") return "permission";
    if (error.code === "board_not_in_trash" || error.code === "board_unavailable") return "not-in-trash";
  }
  return fallback;
}

function refreshTabs(boardId?: string): void {
  revalidatePath(TABS_PATH);
  revalidatePath("/boards");
  if (boardId) revalidatePath(`/boards/${boardId}`);
}

export async function restoreBoardAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  const boardId = text(formData, "boardId");
  let target: string;
  try {
    const blocked = await blockedBy(ctx.org.id, "danger.bulk_edit_delete", { operation: "board_trash.restore", boardId });
    if (blocked) {
      target = tabsUrl({ error: blocked });
    } else {
      const { service } = await createRequestBoards();
      const board = await service.restoreBoard(ctx, boardId);
      refreshTabs(board.id);
      target = tabsUrl({ restored: board.id });
    }
  } catch (error) {
    console.error("[tab trash] restore", boardId, error);
    target = tabsUrl({ error: trashFailureCode(error, "restore-failed") });
  }
  redirect(target);
}

export async function purgeBoardAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  const boardId = text(formData, "boardId");
  let target: string;
  try {
    const blocked = await blockedBy(ctx.org.id, "danger.bulk_edit_delete", { operation: "board_trash.purge", boardId });
    if (blocked) {
      target = tabsUrl({ error: blocked });
    } else {
      const { service } = await createRequestBoards();
      // 저장소 파일은 큐에 쌓인다 — 탭 관리 화면을 다시 그릴 때 비운다.
      await service.purgeBoard(ctx, boardId);
      refreshTabs();
      target = tabsUrl({ purged: "1" });
    }
  } catch (error) {
    console.error("[tab trash] purge", boardId, error);
    target = tabsUrl({ error: trashFailureCode(error, "purge-failed") });
  }
  redirect(target);
}

/** 지운 기본 탭 기록을 지우고, 기본 탭 설치 경로로 빈 탭을 새로 만든다. */
export async function reinstallDefaultTabAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  const tab = DEFAULT_TABS.find((candidate) => candidate.source === text(formData, "source"));
  let target: string;
  try {
    const blocked = tab ? await blockedBy(ctx.org.id, "structure.tab_manage") : "unknown-default-tab";
    if (blocked || !tab) {
      target = tabsUrl({ error: blocked ?? "unknown-default-tab" });
    } else {
      const { service, repo } = await createRequestBoards();
      await service.clearDefaultTabDismissal(ctx, tab.source);
      const ensured = await ensureDefaultTab(ctx, tab, repo);
      refreshTabs(ensured.boardId);
      target = tabsUrl({ reinstalled: tab.source });
    }
  } catch (error) {
    console.error("[tab trash] reinstall", tab?.source, error);
    target = tabsUrl({
      error: error instanceof BoardTrashError && error.code === "permission_denied" ? "permission" : "reinstall-failed",
    });
  }
  redirect(target);
}
