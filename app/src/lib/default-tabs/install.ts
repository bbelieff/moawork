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

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

/**
 * 「이 그룹 정의가 이미 있는가」 — ensureDefaultTabAdditive 와 드리프트 판정이 **같은 눈**을 쓰게 한다.
 *
 * ★ 왜 함수로 뽑았나 (BBE-214): 판정과 치유가 각자 자기 기준을 가지면
 *   「없다고 판정 → 그런데 치유는 있다고 보고 안 만듦」 같은 어긋남이 생긴다.
 *   그 어긋남은 정상 케이스만 테스트하면 절대 안 보인다. 한 눈을 공유하면 어긋날 수가 없다.
 */
function findExistingGroup<TGroup extends { id: string; name: string }>(
  definition: DefaultTab["groups"][number],
  groups: readonly TGroup[],
  assignees: readonly DefaultTabAssignee[],
): TGroup | undefined {
  const assignee = definition.assigneeSlot === undefined ? undefined : assignees[definition.assigneeSlot];
  return groups.find((group) => assignee
    ? assigneeOwnerFromGroupName(group.name) === assignee.userId
    : group.name === definition.name);
}

/** 「이 컬럼 정의가 이미 있는가」 — 위와 같은 이유로 공유한다. */
function findExistingColumn(
  definition: DefaultTabColumn,
  columns: readonly { key: string }[],
) {
  return columns.find((column) => column.key === definition.key);
}

function nextColumnSortOrder(columns: readonly { sort_order: number }[]): number {
  return columns.reduce((next, column) => Math.max(next, column.sort_order + 1), 0);
}

export type DefaultTabDrift = {
  /** 보드 자체가 없다 — 통째로 만들어야 한다. */
  boardMissing: boolean;
  missingGroupNames: string[];
  missingColumnKeys: string[];
  definitionRevisionBehind: boolean;
  /** 하나라도 만들 것이 있는가. false 면 ensureDefaultTabAdditive 는 «아무것도 쓰지 않는다». */
  hasWork: boolean;
};

/**
 * 읽기만으로 「고칠 것이 있는가」를 판정한다 — BBE-214.
 *
 * ★ 왜 필요한가: `/newcust` 는 owner/admin 이 열 때마다 분산 리스를 잡고
 *   `ensureDefaultTabAdditive` 를 돌렸다. 그런데 실측하니 **고칠 것이 하나도 없어도**
 *   왕복 14회 · 리스 RPC 4회를 치르고 «구조 쓰기는 0» 이었다. 락을 잡고 아무것도 안 하고 놓았다.
 *   owner 만 그 값을 낸다(멤버는 role 검사에서 조기 반환한다).
 *
 * ★ 이것이 치유를 약화시키지 않는 이유:
 *   이 판정은 «건너뛸 때만» 쓴다. 조금이라도 만들 것이 있으면 예전과 똑같이 리스를 잡고,
 *   **쓰기는 여전히 리스 «안에서» 다시 읽고 다시 판정한 뒤에만** 일어난다.
 *   즉 이 함수가 틀려서 hasWork 를 true 로 잘못 말해도 결과는 예전과 같고,
 *   false 로 잘못 말할 수 있는 경우는 «읽은 순간 정말로 빠진 것이 없을 때» 뿐이다.
 *   그래서 이 함수는 «쓰기 경로의 진실» 이 아니라 «건너뛰기의 근거» 다.
 */
export async function readDefaultTabDrift(
  ctx: Ctx,
  tab: DefaultTab,
  store: BoardsRepo,
  assignees: readonly DefaultTabAssignee[],
): Promise<DefaultTabDrift> {
  const matches = (await store.listBoards(ctx)).filter((board) => board.source === tab.source);
  if (matches.length > 1) throw new Error("default tab source conflict");
  const board = matches[0];
  if (!board) {
    return {
      boardMissing: true,
      missingGroupNames: tab.groups.map((group) => group.name),
      missingColumnKeys: tab.columns.map((column) => column.key),
      definitionRevisionBehind: false,
      hasWork: true,
    };
  }

  const [groups, columns] = await Promise.all([
    store.listGroups(ctx, board.id),
    store.listColumns(ctx, board.id),
  ]);

  const missingGroupNames = tab.groups
    .filter((definition) => {
      // ensure 가 «건너뛰는» 정의는 여기서도 건너뛴다 — 같은 눈이어야 한다.
      const assignee = definition.assigneeSlot === undefined ? undefined : assignees[definition.assigneeSlot];
      if (definition.assigneeSlot !== undefined && !assignee) return false;
      return !findExistingGroup(definition, groups, assignees);
    })
    .map((definition) => definition.name);

  const missingColumnKeys = tab.columns
    .filter((definition) => !findExistingColumn(definition, columns))
    .map((definition) => definition.key);
  const state = tab.revision !== undefined && store.getDefaultDefinitionState
    ? await store.getDefaultDefinitionState(ctx, board.id)
    : null;
  const legacyPropertyNeedsReconcile = !state && tab.previousRevision
    ? Object.entries(tab.previousRevision.columns).some(([key, baseline]) => {
      const column = columns.find((candidate) => candidate.key === key);
      const definition = tab.columns.find((candidate) => candidate.key === key);
      if (!column || !definition) return false;
      return (baseline.readOnly !== undefined
          && Boolean(column.is_readonly) === baseline.readOnly
          && baseline.readOnly !== Boolean(definition.readOnly))
        || (baseline.rightPinned !== undefined
          && column.rightPinned === baseline.rightPinned
          && baseline.rightPinned !== Boolean(definition.rightPinned));
    })
    : false;
  const definitionRevisionBehind = tab.revision !== undefined
    && (state ? state.revision < tab.revision : legacyPropertyNeedsReconcile);

  return {
    boardMissing: false,
    missingGroupNames,
    missingColumnKeys,
    definitionRevisionBehind,
    hasWork: missingGroupNames.length > 0 || missingColumnKeys.length > 0 || definitionRevisionBehind,
  };
}

function desiredDefinitionState(tab: DefaultTab, columns: readonly { key: string; label: string; is_readonly?: boolean; rightPinned: boolean; sort_order: number }[]) {
  return {
    revision: tab.revision ?? 1,
    columns: Object.fromEntries(columns.map((column) => [column.key, {
      label: column.label,
      readOnly: Boolean(column.is_readonly),
      rightPinned: column.rightPinned,
      sortOrder: column.sort_order,
    }])),
  };
}

async function reconcileDefaultDefinition(
  ctx: Ctx,
  tab: DefaultTab,
  store: BoardsRepo,
  boardId: string,
): Promise<void> {
  if (tab.revision === undefined && tab.previousRevision === undefined) return;
  if (!store.getDefaultDefinitionState || !store.setDefaultDefinitionState) return;
  const targetRevision = tab.revision ?? 1;
  const priorState = await store.getDefaultDefinitionState(ctx, boardId);
  const priorRevision = priorState?.revision ?? tab.previousRevision?.revision ?? targetRevision;
  let columns = await store.listColumns(ctx, boardId);
  if (priorRevision < targetRevision) {
    for (const definition of tab.columns) {
      const column = columns.find((candidate) => candidate.key === definition.key);
      if (!column) continue;
      const baseline = priorState?.columns[definition.key] ?? tab.previousRevision?.columns[definition.key];
      if (!baseline) continue;
      const patch: Parameters<BoardsRepo["updateColumn"]>[2] = {};
      const desiredReadOnly = definition.readOnly ?? false;
      if (baseline.readOnly !== undefined
        && Boolean(column.is_readonly) === baseline.readOnly
        && baseline.readOnly !== desiredReadOnly) patch.readOnly = desiredReadOnly;
      if (baseline.rightPinned !== undefined
        && column.rightPinned === baseline.rightPinned
        && baseline.rightPinned !== Boolean(definition.rightPinned)) patch.rightPinned = Boolean(definition.rightPinned);
      if (Object.keys(patch).length > 0) await store.updateColumn(ctx, column.id, patch);
    }
    columns = await store.listColumns(ctx, boardId);
  }
  await store.setDefaultDefinitionState(ctx, boardId, desiredDefinitionState(tab, columns));
}

/**
 * Repairs one product tab without rewriting customer-owned structure.
 *
 * Unlike the workspace bootstrap reconciler, this path is intentionally additive:
 * existing boards, groups, columns, items and values are never updated or deleted.
 * The caller must serialize it with the database repair lease.
 */
export async function ensureDefaultTabAdditive(
  ctx: Ctx,
  tab: DefaultTab,
  store: BoardsRepo,
  assignees: readonly DefaultTabAssignee[],
): Promise<EnsuredTab> {
  const matches = (await store.listBoards(ctx)).filter((board) => board.source === tab.source);
  if (matches.length > 1) throw new Error("default tab source conflict");
  const created = matches.length === 0;
  const board = matches[0] ?? await store.createBoard(ctx, {
    name: tab.name,
    description: tab.description,
    icon: tab.icon,
    source: tab.source,
  });

  const groups = await store.listGroups(ctx, board.id);
  let nextGroupOrder = groups.length === 0 ? 0 : Math.max(...groups.map((group) => group.sort_order)) + 1;
  const groupIds: Record<string, string> = {};
  for (const definition of tab.groups) {
    const assignee = definition.assigneeSlot === undefined
      ? undefined
      : assignees[definition.assigneeSlot];
    if (definition.assigneeSlot !== undefined && !assignee) continue;
    const expectedName = assignee ? assigneeGroupName(definition.name, assignee) : definition.name;
    // 판정(readDefaultTabDrift)과 «같은 눈» 을 쓴다 — 어긋나면 「없다고 보고 안 만드는」 구멍이 생긴다.
    const existing = findExistingGroup(definition, groups, assignees);
    const group = existing ?? await store.createGroup(ctx, board.id, {
      name: expectedName,
      color: definition.color,
      sortOrder: nextGroupOrder,
    });
    groupIds[definition.name] = group.id;
    if (!existing) { groups.push(group); nextGroupOrder += 1; }
  }

  const columns = await store.listColumns(ctx, board.id);
  let nextSortOrder = nextColumnSortOrder(columns);
  for (const definition of tab.columns) {
    // 위와 같은 이유로 판정과 같은 눈을 쓴다.
    if (findExistingColumn(definition, columns)) continue;
    const column = await store.createColumn(ctx, board.id, {
      key: definition.key,
      label: definition.label,
      type: definition.type,
      source: definition.source,
      options: assigneeOptions(definition, assignees),
      width: definition.width ?? null,
      rightPinned: definition.rightPinned ?? false,
      readOnly: definition.readOnly ?? false,
      moveRule: resolveMoveRule(definition, groupIds, tab, assignees),
      sortOrder: nextSortOrder,
    });
    columns.push(column);
    nextSortOrder += 1;
  }

  await reconcileDefaultDefinition(ctx, tab, store, board.id);

  return {
    tabKey: tab.key,
    boardId: board.id,
    created,
    groupIds,
    columnKeys: columns.map((column) => column.key),
  };
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
  assigneesOverride?: readonly DefaultTabAssignee[],
): Promise<EnsuredTab> {
  const store = repo ?? await getBoardsRepo();
  const needsAssignees = tab.groups.some((group) => group.assigneeSlot !== undefined)
    || tab.columns.some((column) => column.assigneeMove !== undefined);
  const assignees = needsAssignees
    ? assigneesOverride ?? await loadDefaultTabAssignees(ctx)
    : [];
  const existing = (await store.listBoards(ctx)).find((board) => board.source === tab.source);
  if (existing) {
    const currentGroups = await store.listGroups(ctx, existing.id);
    let nextGroupOrder = currentGroups.length === 0 ? 0 : Math.max(...currentGroups.map((group) => group.sort_order)) + 1;
    for (const definition of tab.groups.filter((group) => group.assigneeSlot === undefined)) {
      if (!currentGroups.some((group) => group.name === definition.name)) {
        await store.createGroup(ctx, existing.id, { name: definition.name, color: definition.color, sortOrder: nextGroupOrder });
        nextGroupOrder += 1;
      }
    }
    const groupIds = await reconcileAssigneeGroups(ctx, store, existing.id, tab, assignees);
    const columns = await store.listColumns(ctx, existing.id);
    let nextSortOrder = nextColumnSortOrder(columns);
    for (const definition of tab.columns) {
      const column = columns.find((candidate) => candidate.key === definition.key);
      if (!column) {
        await store.createColumn(ctx, existing.id, {
          key: definition.key,
          label: definition.label,
          type: definition.type,
          source: definition.source,
          options: assigneeOptions(definition, assignees),
          width: definition.width ?? null,
          rightPinned: definition.rightPinned ?? false,
          readOnly: definition.readOnly ?? false,
          moveRule: resolveMoveRule(definition, groupIds, tab, assignees),
          sortOrder: nextSortOrder,
        });
        nextSortOrder += 1;
      } else if (definition.assigneeMove) {
        const options = assigneeOptions(definition, assignees);
        const moveRule = resolveMoveRule(definition, groupIds, tab, assignees);
        if (!sameJson(column.options_jsonb?.options ?? null, options)
          || !sameJson(column.move_rule_jsonb ?? null, moveRule)) {
          await store.updateColumn(ctx, column.id, { options, moveRule });
        }
      }
    }
    const reconciledColumns = await store.listColumns(ctx, existing.id);
    await reconcileDefaultDefinition(ctx, tab, store, existing.id);
    return {
      tabKey: tab.key,
      boardId: existing.id,
      created: false,
      groupIds,
      columnKeys: reconciledColumns.map((column) => column.key),
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
  let nextGroupOrder = 0;
  for (const group of tab.groups) {
    const assignee = group.assigneeSlot === undefined ? undefined : assignees[group.assigneeSlot];
    if (group.assigneeSlot !== undefined && !assignee) continue;
    const name = assignee ? assigneeGroupName(group.name, assignee) : group.name;
    groupIds[group.name] = (await store.createGroup(ctx, board.id, {
      name,
      color: group.color,
      sortOrder: nextGroupOrder,
    })).id;
    nextGroupOrder += 1;
  }

  const columnKeys: string[] = [];
  let nextSortOrder = 0;
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
      sortOrder: nextSortOrder,
    };
    columnKeys.push((await store.createColumn(ctx, board.id, input)).key);
    nextSortOrder += 1;
  }

  await reconcileDefaultDefinition(ctx, tab, store, board.id);

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
    const markerOwner = current ? assigneeOwnerFromGroupName(current.name) : null;
    // Marker ownership proves identity. A different visible prefix is a user rename, not drift.
    if (!current || (markerOwner === null && current.name !== expectedName)) {
      const currentGroups = await store.listGroups(ctx, boardId);
      const inheritedOrder = current?.sort_order
        ?? (currentGroups.length === 0 ? 0 : Math.max(...currentGroups.map((group) => group.sort_order)) + 1);
      const replacement = await store.createGroup(ctx, boardId, {
        name: expectedName,
        color: definition.color,
        sortOrder: inheritedOrder,
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
  assigneesOverride?: readonly DefaultTabAssignee[],
): Promise<EnsuredTab[]> {
  const store = repo ?? await getBoardsRepo();
  const ensured: EnsuredTab[] = [];
  for (const tab of DEFAULT_TABS) {
    ensured.push(await ensureDefaultTab(ctx, tab, store, assigneesOverride));
  }
  return ensured;
}
