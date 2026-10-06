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

import type { Ctx, FieldOption } from "@/lib/types";
import type { BoardsRepo, NewColumn } from "@/lib/boards/store";
import type { Board, BoardColumn } from "@/lib/boards/types";
import { plainGroupName } from "@/lib/boards/moveRules";
import { createRequestBoardsRepo } from "@/lib/boards/request-repo";
import { CONTACT_TAB } from "./contact";
import { CONTRACT_WORK_TAB } from "./contract-work";
import { NEW_LEAD_TAB } from "./new-lead";
import { NOTICE_TAB } from "./notice";
import { loadDefaultTabAssignees } from "@/lib/boards/default-tab-assignees";
import {
  countLiveRowsByGroup,
  groupLinkedStageColumnKey,
  isGroupLinkedStageColumn,
  linkedStageSyncNeedsLiveRowCounts,
  planLinkedStageSync,
} from "@/lib/boards/stage-link";
import type { DefaultTab, DefaultTabAssignee, DefaultTabColumn } from "./types";

export { countLiveRowsByGroup } from "@/lib/boards/stage-link";

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
function findExistingGroup<TGroup extends { id: string; name: string; sort_order?: number }>(
  tab: DefaultTab,
  definition: DefaultTab["groups"][number],
  groups: readonly TGroup[],
  columns: readonly StageLinkColumn[],
  assignees: readonly DefaultTabAssignee[],
): TGroup | undefined {
  const assignee = definition.assigneeSlot === undefined ? undefined : assignees[definition.assigneeSlot];
  if (assignee) return groups.find((group) => assigneeOwnerFromGroupName(group.name) === assignee.userId);
  return findStageLinkedGroup(tab, definition.name, groups, columns) ?? findEquivalentGroup(definition.name, groups);
}

type StageLinkColumn = Readonly<{
  key: string;
  type: BoardColumn["type"];
  move_rule_jsonb?: Record<string, string> | null;
}>;

/**
 * 2026-10-06(#845 리뷰 P1) — 단계가 연결된 탭에서는 정의 그룹을 «이름» 이 아니라 «연결» 로 찾는다.
 *
 * ★ 왜: «단계 = 보드 그룹» 이라서 회사는 띠 이름을 마음대로 바꾼다(그러면 단계 라벨이 따라 바뀐다).
 *   «🔂 심사 중» → «1차 심사» 처럼 본문까지 바꾸면 이름으로는 같은 그룹을 못 알아본다. 그러면
 *   다음 진입 repair·부트스트랩이 빈 «🔂 심사 중» 을 맨 뒤에 다시 만들고, 동기화가 그 유령에
 *   새 단계(`group:<id>`)와 이동 규칙까지 붙였다. 지워도 다음 repair 가 또 만든다.
 *
 * 연결의 근거: 정의 이동 규칙(`moveTo`)에서 이 정의 그룹을 가리키는 선택지 id(예: «심사 중») 를
 *   저장된 단계 칸 규칙이 «살아 있는» 그룹에 잇고 있으면, 그 그룹이 이 정의 그룹이다.
 *   선택지 id 는 동기화가 절대 바꾸지 않고, 그룹 이름을 바꿔도 규칙은 그대로다.
 *   규칙이 꺼진 칸(비었음)·연결되지 않은 탭·규칙 항목이 없는 경우는 근거가 없으니 이름으로 찾는다.
 */
function findStageLinkedGroup<TGroup extends { id: string }>(
  tab: DefaultTab,
  definitionName: string,
  groups: readonly TGroup[],
  columns: readonly StageLinkColumn[],
): TGroup | undefined {
  const key = groupLinkedStageColumnKey(tab.source);
  if (!key) return undefined;
  const moveTo = tab.columns.find((column) => column.key === key)?.moveTo;
  const stored = columns.find((column) => column.key === key);
  if (!moveTo || !stored || !isGroupLinkedStageColumn(tab.source, stored)) return undefined;
  const rule = stored.move_rule_jsonb ?? {};
  for (const [optionId, groupName] of Object.entries(moveTo)) {
    if (groupName !== definitionName || !Object.hasOwn(rule, optionId)) continue;
    const linked = groups.find((group) => group.id === rule[optionId]);
    if (linked) return linked;
  }
  return undefined;
}

/**
 * 2026-10-06 — 정의 그룹 이름과 «같은 그룹» 을 고른다(앞머리 장식만 다른 이름도 같다고 본다).
 *
 * ★ 왜: 정확한 이름만 보면 회사가 «🔂 심사 중» → «심사 중» 으로 고쳐 쓴 순간 「없다」 가 되고,
 *   owner/admin 이 들어올 때마다 빈 «🔂 심사 중» 이 다시 생겼다(운영 실측: 빈 복제 9개).
 *   본문(`plainGroupName`)이 같으면 같은 그룹이다. 숫자는 지키므로 «1차»·«2차» 는 다르다.
 *
 * 여럿이면 sort_order 가 가장 앞선 것 — 회사가 쓰던 원래 그룹이다(설치기가 만든 복제는 늘 맨 뒤에 붙는다).
 */
function findEquivalentGroup<TGroup extends { id: string; name: string; sort_order?: number }>(
  name: string,
  groups: readonly TGroup[],
): TGroup | undefined {
  const key = plainGroupName(name);
  const matches = groups.filter((group) => group.name === name || plainGroupName(group.name) === key);
  return matches.reduce<TGroup | undefined>((best, group) =>
    best === undefined || (group.sort_order ?? Number.POSITIVE_INFINITY) < (best.sort_order ?? Number.POSITIVE_INFINITY)
      ? group
      : best, undefined);
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
  return readDefaultTabBoardDrift(ctx, tab, board, store, assignees);
}

/**
 * Board-level drift check with the board already resolved — the exact same
 * eyes as readDefaultTabDrift, minus its listBoards. Entry fast paths list
 * boards once for all tabs and check each board here in parallel; anything
 * but a unanimous clean verdict falls through to the lease-guarded repair,
 * which stays authoritative (writes, conflict errors, failure semantics).
 */
export async function readDefaultTabBoardDrift(
  ctx: Ctx,
  tab: DefaultTab,
  board: Board,
  store: BoardsRepo,
  assignees: readonly DefaultTabAssignee[],
): Promise<DefaultTabDrift> {
  const [groups, columns] = await Promise.all([
    store.listGroups(ctx, board.id),
    store.listColumns(ctx, board.id),
  ]);

  const missingGroupNames = tab.groups
    .filter((definition) => {
      // ensure 가 «건너뛰는» 정의는 여기서도 건너뛴다 — 같은 눈이어야 한다.
      const assignee = definition.assigneeSlot === undefined ? undefined : assignees[definition.assigneeSlot];
      if (definition.assigneeSlot !== undefined && !assignee) return false;
      return !findExistingGroup(tab, definition, groups, columns, assignees);
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
  // #551 — 기록이 없는 옛 보드도 «라벨이 옛 이름 그대로면» 고칠 일이 있다고 본다.
  //   이게 없으면 리스를 안 잡아서 reconcile 이 영원히 안 돈다(hasWork 가 false 로 남는다).
  const legacyLabelNeedsReconcile = !state && tab.previousRevision
    ? Object.entries(tab.previousRevision.columns).some(([key, baseline]) => {
      if (baseline.label === undefined) return false;
      const column = columns.find((candidate) => candidate.key === key);
      const definition = tab.columns.find((candidate) => candidate.key === key);
      return Boolean(column && definition && column.label === baseline.label && column.label !== definition.label);
    })
    : false;
  const definitionRevisionBehind = tab.revision !== undefined
    && (state ? state.revision < tab.revision : legacyPropertyNeedsReconcile || legacyLabelNeedsReconcile);
  // 2026-09-26 — 정의가 나중에 추가한 이동 규칙 항목(예: 대기중 → 준비단계)이
  // 아직 안 메꿔졌으면 고칠 일이 있다. 판정과 치유가 같은 눈을 쓰도록
  // planMoveRuleBackfill 하나로 본다.
  const moveRuleBackfillPending = planMoveRuleBackfill(tab, columns, groups).length > 0;
  const otherWork = missingGroupNames.length > 0 || missingColumnKeys.length > 0 || definitionRevisionBehind || moveRuleBackfillPending;
  // 2026-10-06(#845) — 그룹과 단계가 어긋났으면(이름·순서·새 그룹) 고칠 일이 있다. 진입 repair 와 «같은 눈»:
  //   빈 설치기 복제 후보가 있을 때만 행을 읽어 정확히 가린다. 이미 고칠 일이 있으면 읽지 않는다.
  const linkedStageSyncPending = !otherWork && planLinkedStageSync(
    tab.source,
    columns,
    groups,
    linkedStageSyncNeedsLiveRowCounts(tab.source, columns, groups)
      ? countLiveRowsByGroup(await store.listItems(ctx, board.id))
      : undefined,
  ) !== null;

  return {
    boardMissing: false,
    missingGroupNames,
    missingColumnKeys,
    definitionRevisionBehind,
    hasWork: otherWork || linkedStageSyncPending,
  };
}

/**
 * Bootstrap also reconciles member options, move rules and retired groups;
 * the additive page-repair probe above cannot prove that work unnecessary.
 * Run the actual reconciler against one read-only snapshot instead. Every
 * operation outside the cached reads fails closed as dirty, before reaching
 * the repository. Only an identical definition-state write is a no-op.
 */
export async function readDefaultTabBootstrapDrift(
  ctx: Ctx,
  tab: DefaultTab,
  board: Board,
  store: BoardsRepo,
  assignees: readonly DefaultTabAssignee[],
): Promise<{ hasWork: boolean }> {
  if (board.org_id !== ctx.org.id || board.source !== tab.source) return { hasWork: true };
  const [groups, columns, state] = await Promise.all([
    store.listGroups(ctx, board.id),
    store.listColumns(ctx, board.id),
    (tab.revision !== undefined || tab.previousRevision !== undefined)
      && store.getDefaultDefinitionState && store.setDefaultDefinitionState
      ? store.getDefaultDefinitionState(ctx, board.id)
      : null,
  ]);
  const dirty = new Error("default tab bootstrap repair required");
  const assertBoard = (readCtx: Ctx, boardId: string) => {
    if (readCtx.org.id !== ctx.org.id || readCtx.user.id !== ctx.user.id || boardId !== board.id) throw dirty;
  };
  const reads: Partial<BoardsRepo> = {
    listBoards: async () => [structuredClone(board)],
    listGroups: async (readCtx, boardId) => {
      assertBoard(readCtx, boardId);
      return structuredClone(groups);
    },
    listColumns: async (readCtx, boardId) => {
      assertBoard(readCtx, boardId);
      return structuredClone(columns);
    },
  };
  if (store.getDefaultDefinitionState) reads.getDefaultDefinitionState = async (readCtx, boardId) => {
    assertBoard(readCtx, boardId);
    return structuredClone(state);
  };
  if (store.setDefaultDefinitionState) reads.setDefaultDefinitionState = async (readCtx, boardId, desired) => {
    assertBoard(readCtx, boardId);
    if (!sameJson(state, desired)) throw dirty;
  };
  const readOnlyStore = new Proxy(store, {
    get(target, property, receiver) {
      if (Object.prototype.hasOwnProperty.call(reads, property)) return Reflect.get(reads, property);
      const value = Reflect.get(target, property, receiver);
      // Includes listItems: the reconciler only requests rows when a group
      // needs retirement, so there is no need to read customer rows to prove drift.
      if (typeof value === "function") return async () => { throw dirty; };
      return value;
    },
  });
  try {
    await ensureDefaultTab(ctx, tab, readOnlyStore, assignees);
    return { hasWork: false };
  } catch (error) {
    if (error === dirty) return { hasWork: true };
    throw error;
  }
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

/**
 * #551 — 정의 순서로 열을 되맞춘다.
 *
 * 왜 필요한가 — 실측(2026-08-25 운영): 계약업체 실무 보드의 `sort_order` 가 뒤섞여 있었다.
 *   맨 앞이 «수수료_입금일» 이라 표를 열면 무엇이 무엇인지 읽을 수 없었다.
 *   `types.ts` 가 못박은 대로 **배열 순서가 곧 sort_order 이고 목업 순서와 같아야 한다.**
 *   설치 코드는 이미 정의 순서대로 매긴다 — 뒤섞인 것은 옛 데이터의 잔재다.
 *
 * 무엇을 «안» 하는가 — 회사가 직접 옮긴 순서는 건드리지 않는다.
 *   우리가 마지막으로 기록한 `sort_order`(default_definition_state)와 지금 DB 가 «같을 때만»
 *   옮긴다. 다르면 회사가 손댄 것이므로 그대로 둔다. readOnly·라벨과 같은 판단 방식이다.
 *   기록이 아예 없으면 판단할 근거가 없으므로 **아무것도 하지 않는다** — 추측으로 남의 순서를 뒤집지 않는다.
 *
 * ⚠ 두 번에 나눠 쓴다. `(org_id, board_id, sort_order)` 가 유일 인덱스라
 *   제자리에서 한 번에 옮기면 중간에 값이 겹쳐 23505 로 터진다.
 *   먼저 전부 충돌하지 않는 높은 자리로 밀어 두고, 그다음 최종값을 준다.
 */
async function reorderToDefinition(
  ctx: Ctx,
  tab: DefaultTab,
  store: BoardsRepo,
  boardId: string,
  columns: readonly { id: string; key: string; sort_order: number }[],
  priorState: { columns: Record<string, { sortOrder?: number }> } | null,
): Promise<void> {
  const owned = tab.columns
    .map((definition, index) => {
      const column = columns.find((candidate) => candidate.key === definition.key);
      return column ? { column, desired: index } : null;
    })
    .filter((entry): entry is { column: { id: string; key: string; sort_order: number }; desired: number } => entry !== null);

  // ⚠ 정의 밖의 열이 하나라도 있으면 손대지 않는다.
  //   회사가 직접 만든 열일 수 있고, 0..n-1 자리를 그 열이 쓰고 있으면 재배치가 충돌한다.
  //   «구조를 줄이지 않는다»(D73)와 같은 뜻이다 — 남의 것을 밀어내지 않는다.
  if (owned.length !== columns.length) return;

  // 회사가 손댄 열이 하나라도 있으면 이 보드의 순서는 회사 것이다 — 통째로 손대지 않는다.
  //
  // ★ 기록이 «아예 없는» 보드는 판단 근거가 없다. 그때는 정의를 따른다. 근거:
  //   · `types.ts` 가 못박았다 — 「배열 순서가 곧 sort_order 이고 목업 순서와 같아야 한다」
  //   · `boards.source = core.default-tab/*` 인 보드는 «우리가» 만든 것이다. 회사가 만들 수 없다
  //   · 실제로 운영이 읽을 수 없는 상태였다(맨 앞이 «수수료_입금일»). 확실한 손해 대 가능한 손해다
  //   대가: 기록 기제가 생기기 «전» 에 회사가 순서를 옮겨 뒀다면 그 한 번은 되돌아간다.
  //   위험은 딱 한 번뿐이다 — 이 실행이 끝나면 상태가 기록되고, 그 뒤 회사가 옮긴 것은
  //   위 `untouched` 가 영원히 지켜 준다.
  //
  // ★ 기록에 «없는» 열은 판단에서 뺀다 — 방금 이 실행이 추가한 열이다.
  //   `ensureDefaultTabAdditive` 는 새 열을 맨 뒤에 붙이므로 기록과 어긋나는 게 당연한데,
  //   그걸 «회사가 손댔다» 로 읽으면 새 열이 영원히 맨 뒤에 남는다(재배치가 통째로 건너뛴다).
  //   실제로 이 구멍 때문에 «승인일» 을 추가했을 때 정의 자리로 못 갈 뻔했다.
  const untouched = !priorState
    || owned.every((entry) => {
      const recorded = priorState.columns[entry.column.key]?.sortOrder;
      return recorded === undefined || recorded === entry.column.sort_order;
    });
  if (!untouched) return;
  if (owned.every((entry) => entry.column.sort_order === entry.desired)) return;

  const parked = Math.max(...columns.map((column) => column.sort_order)) + 1;
  for (const [offset, entry] of owned.entries()) {
    await store.updateColumn(ctx, entry.column.id, { sort_order: parked + offset });
  }
  for (const entry of owned) {
    await store.updateColumn(ctx, entry.column.id, { sort_order: entry.desired });
  }
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
      // #551 — 라벨도 «안 건드린 것만» 옮긴다. 회사가 이름을 바꿨으면 그대로 둔다.
      //   기록된 상태가 있으면 그것과, 없으면 previousRevision 에 적어 둔 옛 이름과 견준다.
      const baselineLabel = priorState?.columns[definition.key]?.label ?? baseline.label;
      if (baselineLabel !== undefined && column.label === baselineLabel && column.label !== definition.label) {
        patch.label = definition.label;
      }
      if (Object.keys(patch).length > 0) await store.updateColumn(ctx, column.id, patch);
    }
    columns = await store.listColumns(ctx, boardId);
    await reorderToDefinition(ctx, tab, store, boardId, columns, priorState);
    columns = await store.listColumns(ctx, boardId);
  }
  await store.setDefaultDefinitionState(ctx, boardId, desiredDefinitionState(tab, columns));
}

/**
 * 2026-09-26 — 정의 이동 규칙(`moveTo`)의 «빠진 쪽지만» 채운다.
 *
 * 왜 필요한가 — 계약업체 실무의 `progress_status` 이동 규칙에 «대기중 → 준비단계» 가
 * 없었다. 정의를 고치는 것만으로는 이미 깔린 보드가 안 고쳐진다: 드리프트 판정은
 * 빠진 그룹·컬럼·리비전만 보고, `ensure*` 는 담당자 이동(`assigneeMove`) 규칙만
 * 맞추기 때문이다. 그래서 대기중으로 되돌린 카드가 진행중 그룹에 그대로 남았다.
 *
 * 무엇을 «안» 하는가 — 아래 셋은 손대지 않는다. 어느 하나라도 어긋나면 그 항목은 건너뛴다.
 *   · 이미 있는 규칙 항목은 덮어쓰지 않는다(회사가 목적지를 바꿨으면 그게 정답이다).
 *   · 규칙이 통째로 비었으면 손대지 않는다(끄기로 읽는다 — «없음» 도 의도일 수 있다).
 *   · 선택지에 없는 값·이름이 바뀌거나 지워진 그룹은 건너뛴다(추측으로 만들지 않는다).
 * 즉 이 함수는 «우리가 나중에 추가한 정의 항목» 만, 그것도 «받아줄 자리가 그대로 있을 때»
 * 메꾼다. 그룹·선택지·ID 를 새로 만들거나 지우지 않는다.
 */
export type MoveRuleBackfill = Readonly<{
  columnId: string;
  columnKey: string;
  moveRule: Record<string, string>;
}>;

type MoveRuleBackfillColumn = Readonly<{
  id: string;
  key: string;
  options_jsonb?: { options?: readonly FieldOption[] } | null;
  move_rule_jsonb?: Record<string, string> | null;
}>;

type BackfillGroup = Readonly<{ id: string; name: string; sort_order?: number }>;

/**
 * 이름이 같은(앞머리 장식만 다른) 후보가 여럿일 때 «진짜» 를 고른다 — 2026-10-06.
 *
 * 운영 실측: 회사가 «⏹️ 준비단계» 를 «준비단계» 로 고친 뒤 설치기가 빈 «⏹️ 준비단계» 를
 * 다시 만들었다. 옛 코드는 «정확한 이름 먼저» 라서 새 규칙 항목이 그 빈 복제를 가리킬 뻔했다.
 * 그래서 정확한 이름보다 아래 순서를 먼저 본다.
 *   1. 같은 컬럼의 기존 규칙이 이미 가리키는 그룹 — 회사가 실제로 쓰는 그룹이다.
 *   2. 살아 있는 행이 있는 그룹(행 수를 읽었을 때만).
 *   3. sort_order 가 앞선 그룹 — 설치기가 만든 복제는 늘 맨 뒤에 붙는다.
 *   4. 정확한 이름이 같은 그룹.
 */
function pickBackfillTarget(
  groupName: string,
  groups: readonly BackfillGroup[],
  ruleTargets: ReadonlySet<string>,
  liveRowCountByGroup: ReadonlyMap<string, number> | undefined,
): BackfillGroup | undefined {
  const key = plainGroupName(groupName);
  const candidates = groups.filter((group) => group.name === groupName || plainGroupName(group.name) === key);
  const rank = (group: BackfillGroup) => [
    ruleTargets.has(group.id) ? 0 : 1,
    (liveRowCountByGroup?.get(group.id) ?? 0) > 0 ? 0 : 1,
    group.sort_order ?? Number.POSITIVE_INFINITY,
    group.name === groupName ? 0 : 1,
  ];
  return [...candidates].sort((left, right) => {
    const a = rank(left);
    const b = rank(right);
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
    }
    return left.id.localeCompare(right.id);
  })[0];
}

export function planMoveRuleBackfill(
  tab: DefaultTab,
  columns: readonly MoveRuleBackfillColumn[],
  groups: readonly BackfillGroup[],
  liveRowCountByGroup?: ReadonlyMap<string, number>,
): MoveRuleBackfill[] {
  const patches: MoveRuleBackfill[] = [];
  for (const definition of tab.columns) {
    if (!definition.moveTo) continue;
    const stored = columns.find((column) => column.key === definition.key);
    if (!stored) continue;
    const rule = stored.move_rule_jsonb;
    // 통째로 비었으면 «끄기» 로 읽는다 — 켜는 것은 회사의 몫이다.
    if (!rule || Object.keys(rule).length === 0) continue;
    const storedOptionIds = new Set(
      (stored.options_jsonb?.options ?? []).map((option) => option.id),
    );
    // 선택지 기록이 없으면 «어느 값이 살아 있는지» 를 판단할 근거가 없다 — 손대지 않는다.
    if (storedOptionIds.size === 0) continue;
    const ruleTargets = new Set(Object.values(rule));
    const additions: Record<string, string> = {};
    for (const [optionId, groupName] of Object.entries(definition.moveTo)) {
      if (Object.hasOwn(rule, optionId)) continue;
      if (!storedOptionIds.has(optionId)) continue;
      // «⏹️준비단계» → «준비단계» 같은 표시 다듬기는 같은 그룹으로 읽는다.
      // 앞머리 장식(prefix)만 벗기고, 본문이 다르면 다른 그룹이다.
      const target = pickBackfillTarget(groupName, groups, ruleTargets, liveRowCountByGroup);
      if (!target) continue;
      additions[optionId] = target.id;
    }
    if (Object.keys(additions).length > 0) {
      patches.push({ columnId: stored.id, columnKey: stored.key, moveRule: { ...rule, ...additions } });
    }
  }
  return patches;
}

async function applyMoveRuleBackfill(
  ctx: Ctx,
  tab: DefaultTab,
  store: BoardsRepo,
  boardId: string,
): Promise<void> {
  const [columns, groups] = await Promise.all([
    store.listColumns(ctx, boardId),
    store.listGroups(ctx, boardId),
  ]);
  // 메꿀 것이 없으면 행을 읽지 않는다 — 판정(드리프트)과 부트스트랩 읽기 전용 검사는 행을 안 본다.
  if (planMoveRuleBackfill(tab, columns, groups).length === 0) return;
  // 메꿀 것이 있을 때만 한 번 읽어 «행이 있는 그룹» 을 우선한다(빈 복제 그룹을 가리키지 않게).
  const liveRowCountByGroup = countLiveRowsByGroup(await store.listItems(ctx, boardId));
  for (const patch of planMoveRuleBackfill(tab, columns, groups, liveRowCountByGroup)) {
    await store.updateColumn(ctx, patch.columnId, { moveRule: patch.moveRule });
  }
}

/**
 * 그룹 ↔ 진행현황 단계 연결(#845)을 맞춘다 — 단계 라벨 = 그룹 이름, 단계 순서 = 그룹 순서,
 * 그룹마다 단계 하나(없으면 새 선택지). 바뀔 것이 없으면 아무것도 쓰지 않는다.
 *
 * `rowCounts`:
 *   · "exact" — 빈 설치기 복제 후보가 있을 때만 행을 읽어 정확히 가린다(진입 repair).
 *   · "evidence" — 행을 읽지 않고 «규칙이 가리키는가» 로만 가린다(부트스트랩 보장).
 *     부트스트랩의 읽기 전용 드리프트 검사는 행 읽기를 «고칠 것 있음» 으로 보므로 행을 읽지 않아야
 *     깨끗한 보드에서 리스를 잡지 않는다. evidence 는 새 선택지를 만들거나 규칙을 옮기는 쪽으로
 *     틀리지 않는다(exact 결과 위에서 돌면 아무것도 안 바꾼다) — 두 경로가 서로 되돌리지 않는다.
 */
async function applyLinkedStageSync(
  ctx: Ctx,
  tab: DefaultTab,
  store: BoardsRepo,
  boardId: string,
  rowCounts: "exact" | "evidence",
): Promise<void> {
  const [columns, groups] = await Promise.all([
    store.listColumns(ctx, boardId),
    store.listGroups(ctx, boardId),
  ]);
  const liveRowCounts = rowCounts === "exact" && linkedStageSyncNeedsLiveRowCounts(tab.source, columns, groups)
    ? countLiveRowsByGroup(await store.listItems(ctx, boardId))
    : undefined;
  const patch = planLinkedStageSync(tab.source, columns, groups, liveRowCounts);
  if (patch) await store.updateColumn(ctx, patch.columnId, { options: patch.options, moveRule: patch.moveRule });
}

export type InstallerDuplicateGroup = Readonly<{
  groupId: string;
  name: string;
  /** 이 복제가 «대신하려던» 원래 그룹 — 같은 본문 이름 중 sort_order 가 가장 앞선 것. */
  keeperGroupId: string;
}>;

/**
 * 설치기가 «이름 바뀐 기본 그룹» 을 못 알아보고 다시 만든 **빈 복제 그룹** 을 찾는다 — 2026-10-06.
 *
 * ⚠ 읽기 전용 판정이다. **아무것도 지우지 않는다.** 자동으로 도는 경로(진입 repair·부트스트랩)
 *   에서 부르지 않는다. 지우는 것은 소유자 승인을 받은 1회성 정리 단계의 몫이다.
 *
 * 복제로 보는 조건(전부 만족해야 한다 — 하나라도 어긋나면 회사 것일 수 있으니 남긴다):
 *   · 이름이 정의 그룹 이름과 «정확히» 같다(설치기는 정의 이름 그대로만 만든다).
 *   · 같은 본문 이름(`plainGroupName`)의 다른 그룹이 있고, 그쪽 sort_order 가 «더 앞선다».
 *   · 살아 있는 행이 0개다.
 *   · 어떤 이동 규칙도 이 그룹을 가리키지 않는다(지우면 규칙이 «없는 그룹» 을 가리킨다).
 */
export function findEmptyInstallerDuplicateGroups(
  tab: DefaultTab,
  groups: readonly { id: string; name: string; sort_order: number }[],
  liveRowCountByGroup: ReadonlyMap<string, number>,
  columns: readonly { move_rule_jsonb?: Record<string, string> | null }[] = [],
): InstallerDuplicateGroup[] {
  const definitionNames = new Set(
    tab.groups.filter((group) => group.assigneeSlot === undefined).map((group) => group.name),
  );
  const ruleTargets = new Set(columns.flatMap((column) => Object.values(column.move_rule_jsonb ?? {})));
  const duplicates: InstallerDuplicateGroup[] = [];
  for (const group of groups) {
    if (!definitionNames.has(group.name)) continue;
    if ((liveRowCountByGroup.get(group.id) ?? 0) > 0) continue;
    if (ruleTargets.has(group.id)) continue;
    const key = plainGroupName(group.name);
    const keeper = groups
      .filter((candidate) => candidate.id !== group.id && plainGroupName(candidate.name) === key)
      .sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id))[0];
    if (!keeper || keeper.sort_order >= group.sort_order) continue;
    duplicates.push({ groupId: group.id, name: group.name, keeperGroupId: keeper.id });
  }
  return duplicates;
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

  // 컬럼을 그룹보다 먼저 읽는다 — 단계가 연결된 탭은 저장된 단계 규칙으로 정의 그룹을 찾는다(findExistingGroup).
  //   아래 그룹 쓰기는 컬럼을 바꾸지 않으므로 이 목록은 컬럼 보장 단계까지 그대로 유효하다.
  const [groups, columns] = await Promise.all([
    store.listGroups(ctx, board.id),
    store.listColumns(ctx, board.id),
  ]);
  let nextGroupOrder = groups.length === 0 ? 0 : Math.max(...groups.map((group) => group.sort_order)) + 1;
  const groupIds: Record<string, string> = {};
  for (const definition of tab.groups) {
    const assignee = definition.assigneeSlot === undefined
      ? undefined
      : assignees[definition.assigneeSlot];
    if (definition.assigneeSlot !== undefined && !assignee) continue;
    const expectedName = assignee ? assigneeGroupName(definition.name, assignee) : definition.name;
    // 판정(readDefaultTabDrift)과 «같은 눈» 을 쓴다 — 어긋나면 「없다고 보고 안 만드는」 구멍이 생긴다.
    const existing = findExistingGroup(tab, definition, groups, columns, assignees);
    const group = existing ?? await store.createGroup(ctx, board.id, {
      name: expectedName,
      color: definition.color,
      sortOrder: nextGroupOrder,
    });
    groupIds[definition.name] = group.id;
    if (!existing) { groups.push(group); nextGroupOrder += 1; }
  }

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
  // 2026-09-26 — 정의가 나중에 추가한 이동 규칙 항목을 빠진 쪽만 메꾼다
  // (planMoveRuleBackfill — 사용자 손댄 항목·그룹·선택지는 그대로).
  await applyMoveRuleBackfill(ctx, tab, store, board.id);
  // 2026-10-06(#845) — 단계 목록을 그룹 이름·순서에 맞춘다(선택지 id 는 그대로).
  await applyLinkedStageSync(ctx, tab, store, board.id, "exact");

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
  const store = repo ?? await createRequestBoardsRepo();
  const needsAssignees = tab.groups.some((group) => group.assigneeSlot !== undefined)
    || tab.columns.some((column) => column.assigneeMove !== undefined);
  const assignees = needsAssignees
    ? assigneesOverride ?? await loadDefaultTabAssignees(ctx)
    : [];
  const existing = (await store.listBoards(ctx)).find((board) => board.source === tab.source);
  if (existing) {
    // 컬럼을 그룹 보장보다 먼저 읽는다 — 단계가 연결된 탭은 저장된 단계 규칙으로 정의 그룹을 찾는다.
    //   그룹 보장·담당자 그룹 정리는 컬럼을 바꾸지 않으므로 이 목록을 컬럼 보장에도 그대로 쓴다.
    const [currentGroups, columns] = await Promise.all([
      store.listGroups(ctx, existing.id),
      store.listColumns(ctx, existing.id),
    ]);
    let nextGroupOrder = currentGroups.length === 0 ? 0 : Math.max(...currentGroups.map((group) => group.sort_order)) + 1;
    for (const definition of tab.groups.filter((group) => group.assigneeSlot === undefined)) {
      // 2026-10-06 — 판정과 «같은 눈» (앞머리 장식만 다른 이름은 같은 그룹, 단계가 연결된 탭은 연결로도 찾는다).
      //   정확한 이름만 보면 회사가 «🔂 심사 중» → «심사 중»·«1차 심사» 로 고친 보드에 빈 «🔂 심사 중» 을 또 만든다.
      if (!findExistingGroup(tab, definition, currentGroups, columns, assignees)) {
        await store.createGroup(ctx, existing.id, { name: definition.name, color: definition.color, sortOrder: nextGroupOrder });
        nextGroupOrder += 1;
      }
    }
    const groupIds = await reconcileAssigneeGroups(ctx, store, existing.id, tab, assignees, columns);
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
    await applyMoveRuleBackfill(ctx, tab, store, existing.id);
    await applyLinkedStageSync(ctx, tab, store, existing.id, "evidence");
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
  // 새 보드도 단계 라벨·순서를 그룹에 맞춰 둔다 — 이후 진입마다 «고칠 것 있음» 이 되지 않게.
  await applyLinkedStageSync(ctx, tab, store, board.id, "evidence");

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
  columns: readonly StageLinkColumn[],
): Promise<Record<string, string>> {
  const groups = await store.listGroups(ctx, boardId);
  const slotDefinitions = tab.groups.filter(
    (group): group is typeof group & { assigneeSlot: number } => group.assigneeSlot !== undefined,
  );
  const groupIds: Record<string, string> = {};
  for (const definition of tab.groups.filter((group) => group.assigneeSlot === undefined)) {
    // 그룹 보장과 «같은 눈» — 이름이 바뀐 연결 그룹도 같은 정의 그룹으로 매핑한다.
    const existing = findExistingGroup(tab, definition, groups, columns, assignees);
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
      if (item.group_id !== fromGroupId) continue;
      await store.reconcileDefinitionItemGroup(ctx,boardId,item.id,fromGroupId,fallbackId!);
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
  const store = repo ?? await createRequestBoardsRepo();
  const ensured: EnsuredTab[] = [];
  for (const tab of DEFAULT_TABS) {
    ensured.push(await ensureDefaultTab(ctx, tab, store, assigneesOverride));
  }
  return ensured;
}
