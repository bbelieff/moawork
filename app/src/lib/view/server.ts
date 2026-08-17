import type { PersonScope } from "./contracts";
import type { SavedBoardView } from "./board-saved";

export async function requireActiveFixedPerson(
  orgId: string,
  scope: { personScope: PersonScope; personScopeUserId: string | null },
  lookup: (orgId: string, userId: string) => Promise<{ active: boolean }>,
): Promise<void> {
  if (scope.personScope !== "fixed") return;
  if (!scope.personScopeUserId) throw new Error("fixed person scope requires a user");
  const member = await lookup(orgId, scope.personScopeUserId);
  if (!member.active) throw new Error("fixed person must be an active member of this organization");
}

export interface SavedPersonRuntime {
  view: Pick<SavedBoardView, "personScope" | "personScopeUserId"> | null;
  memberIds: readonly string[];
}

export async function resolveSavedPersonRuntime(
  orgId: string,
  boardId: string,
  viewId: string | null,
  currentUserId: string,
  lookupView: (orgId: string, boardId: string, viewId: string) => Promise<Pick<SavedBoardView, "personScope" | "personScopeUserId"> | null>,
  listActiveMemberIds: (orgId: string) => Promise<readonly string[]>,
  lookupTeamKey: (orgId: string, userId: string) => Promise<string | null>,
): Promise<SavedPersonRuntime> {
  if (!viewId) return { view: null, memberIds: [] };
  const view = await lookupView(orgId, boardId, viewId);
  if (!view || !view.personScope || view.personScope === "none") return { view, memberIds: [] };

  const activeMemberIds = [...new Set(await listActiveMemberIds(orgId))];
  if (view.personScope === "viewer") {
    return { view, memberIds: activeMemberIds.includes(currentUserId) ? [currentUserId] : [] };
  }
  if (view.personScope === "fixed") {
    return { view, memberIds: view.personScopeUserId && activeMemberIds.includes(view.personScopeUserId) ? [view.personScopeUserId] : [] };
  }

  const currentTeamKey = await lookupTeamKey(orgId, currentUserId);
  if (!currentTeamKey) return { view, memberIds: activeMemberIds.includes(currentUserId) ? [currentUserId] : [] };
  const keyed = await Promise.all(activeMemberIds.map(async (userId) => ({ userId, teamKey: await lookupTeamKey(orgId, userId) })));
  return { view, memberIds: keyed.filter((member) => member.teamKey === currentTeamKey).map((member) => member.userId) };
}
