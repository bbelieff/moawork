import type { PersonScope } from "./contracts";

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
