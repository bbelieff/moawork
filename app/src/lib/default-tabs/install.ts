/**
 * 기본 탭 보장 — BBE-145 · D76.
 *
 * **«설치» 라는 단계는 없다.** 새 워크스페이스에는 목업의 탭이 처음부터 있어야 한다.
 * 그래서 이 함수의 이름은 `install` 이 아니라 `ensure` 다 — 사용자가 누르는 버튼이 아니라
 * 워크스페이스가 만들어질 때 조용히 보장되는 기본값이다(D76 이 `BBE-102` 를 폐기한 이유).
 *
 * 구조 팩(`installStructurePack`)과 나란히 두지만 서로 부르지 않는다. 저쪽은 먼데이 실측
 * 아카이브를 «설치» 하는 옛 경로고, 이쪽은 제품의 기본값이다(`./types.ts` 대조표 참고).
 *
 * 포트(`BoardsRepo`)만 거친다 — 003 테이블에 직접 SQL 을 쓰지 않는다. Supabase 어댑터가
 * 붙으면 이 코드는 그대로 살아남는다.
 *
 * **되돌릴 수 있어야 한다(D77).** 회사가 기본 탭을 마지막 하나까지 지울 수 있으므로,
 * 이 함수는 «없으면 만든다» 만 하고 «지워졌으면 되살린다» 는 하지 않는다.
 * 그래서 판정 기준이 «보드가 있나» 가 아니라 «이 워크스페이스가 초기화된 적이 있나» 여야 하는데,
 * 그 표식을 둘 자리가 아직 없다(`orgs` 컬럼 추가 = DG-02 소유).
 * 지금은 **워크스페이스 생성 시 1회 호출**로만 쓰고, 지워진 탭을 되살리지 않는다.
 * → 후속: 초기화 표식 컬럼. 그게 없으면 «탭 0개» 상태(D77)가 새로고침마다 되살아난다.
 */

import type { Ctx } from "@/lib/types";
import type { BoardsRepo, NewColumn } from "@/lib/boards/store";
import { getBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { CONTACT_TAB } from "./contact";
import { CONTRACT_WORK_TAB } from "./contract-work";
import { NEW_LEAD_TAB } from "./new-lead";
import { NOTICE_TAB } from "./notice";
import { loadDefaultTabAssignees } from "@/lib/boards/default-tab-assignees";
import type { DefaultTab, DefaultTabAssignee, DefaultTabColumn } from "./types";

/** 제품이 새 워크스페이스에 주는 기본 탭. 지금은 신규리드 하나 — 나머지 5탭은 복제 작업이다. */
export const DEFAULT_TABS: DefaultTab[] = [NEW_LEAD_TAB, CONTACT_TAB, CONTRACT_WORK_TAB, NOTICE_TAB];

export interface EnsuredTab {
  tabKey: string;
  boardId: string;
  /** 이번 호출이 실제로 만들었는가. 이미 있었으면 false — 두 벌 생기지 않는다. */
  created: boolean;
  /** 그룹 이름 → group id. */
  groupIds: Record<string, string>;
  /** 만들어진 컬럼 key — 정의 순서와 1:1. */
  columnKeys: string[];
}

/**
 * 탭 하나를 보장한다. 같은 이름의 보드가 이미 있으면 아무것도 만들지 않는다(멱등).
 *
 * ⚠ 멱등 판정을 «이름» 으로 한다. 회사가 탭 이름을 바꾸면(D76 이 허용한다) 같은 탭을 다시
 *   만들 수 있다. 안정적인 식별자(`boards.source` 같은 칸)에 tabKey 를 심는 것이 옳지만
 *   그 컬럼은 003 에 있고 채우는 경로가 `NewBoard` 계약에 없다 — 포트 확장은 DG 소유라
 *   여기서 바꾸지 않는다. 생성 시 1회 호출이라 실사용에서는 부딪히지 않는다. 후속 과제로 남긴다.
 */
export async function ensureDefaultTab(
  ctx: Ctx,
  tab: DefaultTab,
  repo?: BoardsRepo,
): Promise<EnsuredTab> {
  const store = repo ?? await getBoardsRepo();
  const needsAssignees = tab.groups.some((group) => group.assigneeSlot !== undefined)
    || tab.columns.some((column) => column.assigneeMove !== undefined);
  const assignees = needsAssignees ? await loadDefaultTabAssignees(ctx) : [];
  const existing = (await store.listBoards(ctx)).find((board) => board.source === tab.source);
  if (existing) {
    const groupIds = await reconcileAssigneeGroups(ctx, store, existing.id, tab, assignees);
    const columns = await store.listColumns(ctx, existing.id);
    for (const definition of tab.columns.filter((column) => column.assigneeMove)) {
      const column = columns.find((candidate) => candidate.key === definition.key);
      if (!column) continue;
      await store.updateColumn(ctx, column.id, {
        options: assigneeOptions(definition, assignees),
        moveRule: resolveMoveRule(definition, groupIds, tab, assignees),
      });
    }
    return {
      tabKey: tab.key,
      boardId: existing.id,
      created: false,
      groupIds,
      columnKeys: columns.map((column) => column.key),
    };
  }

  const board = await store.createBoard(ctx, {
    name: tab.name,
    description: tab.description,
    icon: tab.icon,
    source: tab.source,
  });

  // 그룹 먼저 — 이동 규칙이 group id 를 가리켜야 하기 때문이다.
  const groupIds: Record<string, string> = {};
  for (const group of tab.groups) {
    const assignee = group.assigneeSlot === undefined ? undefined : assignees[group.assigneeSlot];
    if (group.assigneeSlot !== undefined && !assignee) continue;
    const name = assignee ? assigneeGroupName(group.name, assignee) : group.name;
    groupIds[group.name] = (await store.createGroup(ctx, board.id, {
      name,
      color: group.color,
    })).id;
  }

  const columnKeys: string[] = [];
  for (const column of tab.columns) {
    const input: NewColumn = {
      key: column.key,
      label: column.label,
      type: column.type,
      source: column.source,
      options: assigneeOptions(column, assignees),
      width: column.width ?? null,
      rightPinned: column.rightPinned ?? false,
      readOnly: column.readOnly ?? false,
      moveRule: resolveMoveRule(column, groupIds, tab, assignees),
    };
    columnKeys.push((await store.createColumn(ctx, board.id, input)).key);
  }

  return { tabKey: tab.key, boardId: board.id, created: true, groupIds, columnKeys };
}

/**
 * 이동 규칙의 «그룹 이름» 을 실제 group id 로 바꾼다.
 *
 * 이름이 안 맞으면 조용히 넘기지 않고 **터뜨린다.** 규칙이 죽은 채로 설치되면 사용자는
 * 값을 바꿔도 카드가 안 움직이는 것을 보고, 그 원인은 화면 어디에도 안 나온다.
 * 시드 단계에서 죽는 편이 훨씬 싸다.
 */
function resolveMoveRule(
  column: DefaultTabColumn,
  groupIds: Record<string, string>,
  tab: DefaultTab,
  assignees: readonly DefaultTabAssignee[],
): Record<string, string> | null {
  const moveTo = column.moveTo;
  const assigneeMove = column.assigneeMove;
  if (!moveTo && !assigneeMove) return null;
  const rule: Record<string, string> = {};
  for (const [optionId, groupName] of Object.entries(moveTo ?? {})) {
    const groupId = groupIds[groupName];
    if (!groupId) {
      throw new Error(
        `기본 탭 «${tab.name}» 의 컬럼 «${column.label}» 이동 규칙이 없는 그룹을 가리킵니다: ${groupName}`,
      );
    }
    rule[optionId] = groupId;
  }
  if (assigneeMove) {
    const unassignedGroupId = groupIds[assigneeMove.unassignedGroup];
    if (!unassignedGroupId) throw new Error(`기본 탭 «${tab.name}» 담당자 미배정 그룹이 없습니다`);
    rule[assigneeMove.unassignedValue] = unassignedGroupId;
    for (const assignment of assigneeMove.assignments) {
      const assignee = assignees[assignment.assigneeSlot];
      if (!assignee) continue;
      const target = tab.groups.find((group) => group.assigneeSlot === assignment.groupAssigneeSlot);
      const targetId = target ? groupIds[target.name] : undefined;
      if (!targetId) throw new Error(`기본 탭 «${tab.name}» 담당자 그룹 슬롯이 없습니다: ${assignment.groupAssigneeSlot}`);
      rule[assignee.userId] = targetId;
    }
  }
  return rule;
}

const ASSIGNEE_OWNER_MARKER = "\u2063";
const ASSIGNEE_OWNER_ZERO = "\u200b";
const ASSIGNEE_OWNER_ONE = "\u200c";

function withAssigneeOwner(name: string, userId: string): string {
  const bits = Array.from(new TextEncoder().encode(userId), (byte) =>
    byte.toString(2).padStart(8, "0").replaceAll("0", ASSIGNEE_OWNER_ZERO).replaceAll("1", ASSIGNEE_OWNER_ONE),
  ).join("");
  return `${name}${ASSIGNEE_OWNER_MARKER}${bits}`;
}

function assigneeOwnerFromGroupName(name: string): string | null {
  const markerIndex = name.lastIndexOf(ASSIGNEE_OWNER_MARKER);
  if (markerIndex < 0) return null;
  const encoded = name.slice(markerIndex + ASSIGNEE_OWNER_MARKER.length);
  if (!encoded || encoded.length % 8 !== 0) return null;
  const bits = encoded.replaceAll(ASSIGNEE_OWNER_ZERO, "0").replaceAll(ASSIGNEE_OWNER_ONE, "1");
  if (!/^[01]+$/.test(bits)) return null;
  try {
    return new TextDecoder(undefined, { fatal: true }).decode(
      new Uint8Array(bits.match(/.{8}/g)!.map((byte) => Number.parseInt(byte, 2))),
    );
  } catch {
    return null;
  }
}

function assigneeGroupName(baseName: string, assignee: DefaultTabAssignee): string {
  const visible = `${baseName.replace(/\s*\d+$/, "")} ${assignee.displayName}`;
  return withAssigneeOwner(visible, assignee.userId);
}

function assigneeOptions(
  column: DefaultTabColumn,
  assignees: readonly DefaultTabAssignee[],
) {
  if (!column.assigneeMove) return column.options ?? null;
  return assignees.map((assignee, order) => ({
    id: assignee.userId,
    label: assignee.displayName,
    order,
  }));
}

async function reconcileAssigneeGroups(
  ctx: Ctx,
  store: BoardsRepo,
  boardId: string,
  tab: DefaultTab,
  assignees: readonly DefaultTabAssignee[],
): Promise<Record<string, string>> {
  const groups = await store.listGroups(ctx, boardId);
  const slotDefinitions = tab.groups.filter(
    (group): group is typeof group & { assigneeSlot: number } => group.assigneeSlot !== undefined,
  );
  const groupIds: Record<string, string> = {};
  for (const definition of tab.groups.filter((group) => group.assigneeSlot === undefined)) {
    const existing = groups.find((group) => group.name === definition.name);
    if (existing) groupIds[definition.name] = existing.id;
  }

  const assigneeDefinition = tab.columns.find((column) => column.assigneeMove);
  const unassigned = assigneeDefinition?.assigneeMove?.unassignedGroup;
  const existingAssigneeColumn = assigneeDefinition
    ? (await store.listColumns(ctx, boardId)).find((column) => column.key === assigneeDefinition.key)
    : undefined;
  const priorUnassignedId = assigneeDefinition?.assigneeMove
    ? existingAssigneeColumn?.move_rule_jsonb?.[assigneeDefinition.assigneeMove.unassignedValue]
    : undefined;
  if (unassigned && priorUnassignedId && groups.some((group) => group.id === priorUnassignedId)) {
    groupIds[unassigned] = priorUnassignedId;
  }
  const fallbackId = unassigned ? groupIds[unassigned] : undefined;
  if (!fallbackId && slotDefinitions.length > 0) {
    throw new Error(`기본 탭 '${tab.name}'의 미배정 그룹을 찾을 수 없습니다.`);
  }

  const slotCandidates = groups.filter((group) =>
    slotDefinitions.some((definition) => {
      const prefix = definition.name.replace(/\s*\d+$/, "");
      return assigneeOwnerFromGroupName(group.name) !== null
        || (group.color?.toLowerCase() === definition.color.toLowerCase() && group.name.startsWith(prefix));
    }),
  );
  const claimed = new Set<string>();
  const moveItems = async (fromGroupId: string) => {
    for (const item of await store.listItems(ctx, boardId)) {
      if (item.group_id === fromGroupId) await store.updateItem(ctx, item.id, { group_id: fallbackId! });
    }
  };

  for (const definition of slotDefinitions) {
    const assignee = assignees[definition.assigneeSlot];
    let current = slotCandidates.find(
      (group) => !claimed.has(group.id) && assigneeOwnerFromGroupName(group.name) === assignee?.userId,
    );
    current ??= slotCandidates.find(
      (group) =>
        !claimed.has(group.id)
        && group.color?.toLowerCase() === definition.color.toLowerCase()
        && group.name.startsWith(definition.name.replace(/\s*\d+$/, "")),
    );
    if (current) claimed.add(current.id);

    if (!assignee) {
      if (current) {
        await moveItems(current.id);
        await store.deleteGroup(ctx, current.id);
      }
      continue;
    }

    const expectedName = assigneeGroupName(definition.name, assignee);
    if (!current || current.name !== expectedName) {
      const replacement = await store.createGroup(ctx, boardId, {
        name: expectedName,
        color: definition.color,
      });
      if (current) {
        await moveItems(current.id);
        await store.deleteGroup(ctx, current.id);
      }
      current = replacement;
    }
    groupIds[definition.name] = current.id;
  }

  for (const obsolete of slotCandidates.filter((group) => !claimed.has(group.id))) {
    if ((await store.listGroups(ctx, boardId)).some((group) => group.id === obsolete.id)) {
      await moveItems(obsolete.id);
      await store.deleteGroup(ctx, obsolete.id);
    }
  }
  return groupIds;
}

/** 워크스페이스 생성 시 1회 호출. 이미 있는 탭은 건너뛴다. */
export async function ensureDefaultTabs(
  ctx: Ctx,
  repo?: BoardsRepo,
): Promise<EnsuredTab[]> {
  const store = repo ?? await getBoardsRepo();
  return Promise.all(DEFAULT_TABS.map((tab) => ensureDefaultTab(ctx, tab, store)));
}
