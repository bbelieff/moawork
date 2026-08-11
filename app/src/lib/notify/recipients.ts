export type NotificationSource =
  | "assignment"
  | "hierarchy"
  | "watching_department"
  | "team"
  | "card_person"
  | "card_department"
  | "personal";

export interface RecipientCandidate {
  userId: string;
  source: NotificationSource;
  /** 0=담당자, 1=직속 상사, 2 이상=상위 계통. */
  distance?: number;
  path?: readonly string[];
}
export interface NotificationRecipient extends RecipientCandidate {
  locked: boolean;
  sources: NotificationSource[];
}

export interface ResolveRecipientsInput {
  actorId?: string;
  assigneeId?: string | null;
  assigneeHierarchy?: readonly RecipientCandidate[];
  teamMembers: readonly string[];
  watchingDepartmentMembers?: readonly string[];
  cardPeople?: readonly string[];
  cardDepartmentMembers?: readonly string[];
  personalSubscriptions?: readonly string[];
  personalUnsubscriptions?: ReadonlySet<string>;
  canReceive?: (userId: string) => boolean;
}

export interface NotificationRoutingPort {
  load(targetIds: readonly string[]): Promise<ReadonlyMap<string, Omit<ResolveRecipientsInput, "actorId">>>;
}

const PRIORITY: Record<NotificationSource, number> = {
  assignment: 1,
  hierarchy: 1,
  watching_department: 2,
  team: 3,
  card_person: 3,
  card_department: 3,
  personal: 4,
};

/** D19의 기본 규칙과 카드/개인 예외를 합친 뒤 사용자별로 한 번만 반환한다. */
export function resolveNotificationRecipients(
  input: ResolveRecipientsInput,
): NotificationRecipient[] {
  const candidates: RecipientCandidate[] = input.assigneeId
    ? [
        { userId: input.assigneeId, source: "assignment", distance: 0 },
        ...(input.assigneeHierarchy ?? []).map((candidate) => ({
          ...candidate,
          source: "hierarchy" as const,
        })),
      ]
    : input.teamMembers.map((userId) => ({ userId, source: "team" as const }));

  candidates.push(
    ...(input.watchingDepartmentMembers ?? []).map((userId) => ({
      userId,
      source: "watching_department" as const,
    })),
    ...(input.cardPeople ?? []).map((userId) => ({ userId, source: "card_person" as const })),
    ...(input.cardDepartmentMembers ?? []).map((userId) => ({
      userId,
      source: "card_department" as const,
    })),
    ...(input.personalSubscriptions ?? []).map((userId) => ({
      userId,
      source: "personal" as const,
    })),
  );

  const byUser = new Map<string, NotificationRecipient>();
  for (const candidate of candidates) {
    if (candidate.userId === input.actorId || input.canReceive?.(candidate.userId) === false) continue;
    const locked = candidate.source === "assignment" || candidate.source === "hierarchy";
    if (input.personalUnsubscriptions?.has(candidate.userId) && !locked) continue;

    const current = byUser.get(candidate.userId);
    if (!current) {
      byUser.set(candidate.userId, { ...candidate, locked, sources: [candidate.source] });
      continue;
    }
    if (!current.sources.includes(candidate.source)) current.sources.push(candidate.source);
    current.locked ||= locked;
    if (PRIORITY[candidate.source] < PRIORITY[current.source]) {
      current.source = candidate.source;
      current.distance = candidate.distance;
      current.path = candidate.path;
    }
  }

  return [...byUser.values()].sort(
    (a, b) => PRIORITY[a.source] - PRIORITY[b.source] || a.userId.localeCompare(b.userId),
  );
}

export function routeNotificationFeed<T extends { id: string; actor: string | null; target_id: string | null }>(
  feed: readonly T[],
  currentUserId: string,
  routes: ReadonlyMap<string, Omit<ResolveRecipientsInput, "actorId">>,
  preserveAll = false,
): Array<{ feed: T; recipient: NotificationRecipient }> {
  return feed.flatMap((item) => {
    const route = (item.target_id ? routes.get(item.target_id) : undefined) ?? routes.get("*");
    const recipient = resolveNotificationRecipients({
      actorId: item.actor ?? undefined,
      assigneeId: route?.assigneeId,
      teamMembers: route?.teamMembers ?? [],
      ...route,
    }).find((candidate) => candidate.userId === currentUserId);
    if (!recipient && preserveAll) {
      return [{ feed: item, recipient: { userId: currentUserId, source: "team" as const, locked: false, sources: ["team" as const] } }];
    }
    return recipient ? [{ feed: item, recipient }] : [];
  });
}
