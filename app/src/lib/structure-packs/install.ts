/**
 * 구조 팩 설치 — PLAN-002/WO-1.
 *
 * 조직 1개에 팩의 보드·그룹·컬럼·저장 뷰를 만든다. 아이템(행) 데이터는 만들지 않는다:
 * 이 팩은 **구조만 복제**하고 먼데이 실데이터 8,413건은 목표가 아니다(PLAN-002 §1).
 *
 * 포트(`BoardsRepo`)만 거치므로 로컬 인메모리든 Supabase 어댑터든 같은 코드로 돈다.
 */

import type { Ctx } from "@/lib/types";
import type { BoardsRepo } from "@/lib/boards/store";
import { getBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { getRepo } from "@/lib/repo";
import type { DeferredColumn, PackBoard, PackColumn, SectionPreset, StructurePack } from "./types";

/** 담당자별 그룹(`assigneeSlot`)을 채우는 데 필요한 최소 정보. */
export interface AssigneeMember {
  userId: string;
  /** 그룹 이름에 붙일 표시 이름. */
  displayName: string;
}

export interface InstalledBoard {
  slug: string;
  boardId: string;
  /**
   * Name(제목) 칸의 이름 — 시드 확정 ①(업체명).
   * 003 엔진에서 Name 은 `items.title` 이라 컬럼 행이 없다. 계약으로만 돌려준다.
   */
  nameLabel: string;
  /** 만들어진 그룹 id — 팩의 `sections` 순서와 1:1. */
  groupIds: string[];
  /** 만들어진 컬럼 key — 팩의 `columns` 순서와 1:1. */
  columnKeys: string[];
  viewIds: string[];
}

/** 담당자 멤버와 실제 그룹을 잇는 안정적인 연결점 — 표시명이 아니라 userId 로 식별한다. */
export interface AssigneeGroupBinding {
  boardSlug: string;
  boardId: string;
  groupId: string;
  slot: number;
  userId: string;
}

const ASSIGNEE_OWNER_MARKER = "\u2063";
const ASSIGNEE_OWNER_ZERO = "\u200b";
const ASSIGNEE_OWNER_ONE = "\u200c";

function withAssigneeOwner(name: string, userId: string): string {
  const bytes = new TextEncoder().encode(userId);
  const bits = Array.from(bytes, (byte) =>
    byte
      .toString(2)
      .padStart(8, "0")
      .replaceAll("0", ASSIGNEE_OWNER_ZERO)
      .replaceAll("1", ASSIGNEE_OWNER_ONE),
  ).join("");
  return `${name}${ASSIGNEE_OWNER_MARKER}${bits}`;
}

function assigneeOwnerFromGroupName(name: string): string | null {
  const markerIndex = name.lastIndexOf(ASSIGNEE_OWNER_MARKER);
  if (markerIndex < 0) return null;
  const encoded = name.slice(markerIndex + ASSIGNEE_OWNER_MARKER.length);
  if (!encoded || encoded.length % 8 !== 0) return null;
  const bits = encoded
    .replaceAll(ASSIGNEE_OWNER_ZERO, "0")
    .replaceAll(ASSIGNEE_OWNER_ONE, "1");
  if (!/^[01]+$/.test(bits)) return null;
  const bytes = new Uint8Array(bits.match(/.{8}/g)!.map((byte) => Number.parseInt(byte, 2)));
  try {
    return new TextDecoder(undefined, { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** 사용자 화면에는 내부 소유자 표식을 노출하지 않고 원래 그룹명만 돌려준다. */
export function assigneeGroupDisplayName(name: string): string {
  const markerIndex = name.lastIndexOf(ASSIGNEE_OWNER_MARKER);
  return markerIndex < 0 ? name : name.slice(0, markerIndex);
}

/** 담당자 자동 이동 소비자가 표시명 없이 userId 로 대상 그룹을 찾는다. */
export function assigneeGroupIdForUser(
  bindings: readonly AssigneeGroupBinding[],
  boardSlug: string,
  userId: string,
): string | null {
  return bindings.find((binding) => binding.boardSlug === boardSlug && binding.userId === userId)?.groupId ?? null;
}

export interface InstallResult {
  packKey: string;
  boards: InstalledBoard[];
  /** 구조만 기록하고 만들지 않은 컬럼(PLAN-003). 보드 slug 를 앞에 붙여 돌려준다. */
  deferred: Array<DeferredColumn & { boardSlug: string }>;
  /** 이미 있어서 건너뛴 보드 slug. 재실행해도 중복 생성되지 않는다. */
  skipped: string[];
  /** 멤버 초대/내보내기 reconcile 및 담당자 자동 이동이 재사용할 ID 기반 연결 정보. */
  assigneeGroups: AssigneeGroupBinding[];
}

/**
 * 설치를 요청한 조직의 담당자별 그룹 슬롯을 채울 멤버 목록.
 *
 * 가입순(= `created_at` 오름차순)으로 정렬해 `members[assigneeSlot]` 이 있으면
 * 그 슬롯의 그룹을 만든다 — 결정대장 D73(BBE-130). 새 조직은 만든 사람 1명뿐이라
 * 슬롯 0만 채워지고, 멤버를 초대할 때마다 다음 슬롯이 채워진다.
 */
function resolveAssignees(ctx: Ctx): AssigneeMember[] {
  return getRepo()
    .listMembers(ctx.org.id)
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((member) => ({
      userId: member.user_id,
      displayName: member.user?.name?.trim() || member.user?.email?.trim() || "미배정",
    }));
}

/**
 * 팩을 조직에 설치한다.
 *
 * 같은 이름의 보드가 이미 있으면 그 보드는 건너뛴다 — 설치를 두 번 눌러도
 * 보드가 두 벌 생기지 않아야 한다. 부분 설치(1개만 있는 상태)에서도
 * 나머지만 채워진다.
 */
export function installStructurePack(
  ctx: Ctx,
  options: {
    repo?: BoardsRepo;
    pack: StructurePack;
    assignees?: AssigneeMember[];
  },
): InstallResult {
  const repo = options.repo ?? getBoardsRepo();
  const pack = options.pack;
  const assignees = options.assignees ?? resolveAssignees(ctx);

  const boards: InstalledBoard[] = [];
  const skipped: string[] = [];
  const deferred: Array<DeferredColumn & { boardSlug: string }> = [];
  const assigneeGroups: AssigneeGroupBinding[] = [];

  for (const packBoard of pack.boards) {
    deferred.push(
      ...packBoard.deferredColumns.map((column) => ({ ...column, boardSlug: packBoard.slug })),
    );
    const existingBoard = repo.listBoards(ctx).find((board) => board.name === packBoard.name);
    if (existingBoard) {
      skipped.push(packBoard.slug);
      assigneeGroups.push(
        ...reconcileAssigneeGroups(ctx, repo, existingBoard.id, packBoard, assignees),
      );
      continue;
    }
    const installed = installBoard(ctx, repo, packBoard, pack, assignees);
    boards.push(installed.board);
    assigneeGroups.push(...installed.assigneeGroups);
  }

  return { packKey: pack.key, boards, deferred, skipped, assigneeGroups };
}

/**
 * 컬럼에 심을 선택지. `optionRef` 는 팩의 공용 세트(시드 확정 ② 지역 등)를 가리킨다.
 *
 * 참조를 풀지 않고 넘기면 선택지 없는 드롭다운이 조용히 만들어진다 —
 * 없는 것을 있는 것처럼 보이게 하는 쪽이 더 나쁘므로 여기서 끊는다.
 */
function resolveOptions(column: PackColumn, pack: StructurePack) {
  if (column.options) return column.options;
  if (!column.optionRef) return null;
  const set = pack.optionSets[column.optionRef];
  if (!set) throw new Error(`구조 팩 선택지 세트 없음: ${column.optionRef} (${column.key})`);
  return set;
}

/**
 * 그룹의 실제 이름을 정한다.
 *
 * `assigneeSlot` 이 없으면 팩에 적힌 이름 그대로(업무 상태 그룹). 있으면 그 슬롯 번호의
 * 멤버를 붙인다 — 슬롯만큼 멤버가 없으면 `null`(그 그룹은 만들지 않는다, D73).
 */
function resolveSectionName(section: SectionPreset, assignees: AssigneeMember[]): string | null {
  if (section.assigneeSlot === undefined) return section.groupName;
  const assignee = assignees[section.assigneeSlot];
  return assignee ? `${section.groupName}${assignee.displayName}` : null;
}

/**
 * 이미 설치된 보드의 담당자별 그룹을 현재 멤버 슬롯과 맞춘다.
 * 바인딩은 userId 를 정본으로 삼으므로 표시명 변경·동명이인이 그룹 동일성을 바꾸지 않는다.
 */
export function reconcileAssigneeGroups(
  ctx: Ctx,
  repo: BoardsRepo,
  boardId: string,
  packBoard: PackBoard,
  assignees: readonly AssigneeMember[],
): AssigneeGroupBinding[] {
  const slotSections = packBoard.sections.filter(
    (section): section is SectionPreset & { assigneeSlot: number } => section.assigneeSlot !== undefined,
  );
  const existingGroups = repo.listGroups(ctx, boardId);
  const claimedGroupIds = new Set<string>();
  const slotGroups = existingGroups.filter((group) =>
    slotSections.some(
      (section) =>
        group.color?.toLowerCase() === section.color.toLowerCase() &&
        group.name.startsWith(section.groupName),
    ),
  );
  const groupForSection = (section: SectionPreset) =>
    slotGroups.find(
      (group) =>
        !claimedGroupIds.has(group.id) &&
        assigneeOwnerFromGroupName(group.name) === null &&
        group.color?.toLowerCase() === section.color.toLowerCase() &&
        group.name.startsWith(section.groupName),
    );
  const fallback = existingGroups.find(
    (group) =>
      !slotSections.some(
        (section) =>
          group.color?.toLowerCase() === section.color.toLowerCase() &&
          group.name.startsWith(section.groupName),
      ),
  );
  const next: AssigneeGroupBinding[] = [];

  const moveItems = (fromGroupId: string, toGroupId: string) => {
    for (const item of repo.listItems(ctx, boardId)) {
      if (item.group_id === fromGroupId) repo.updateItem(ctx, item.id, { group_id: toGroupId });
    }
  };

  for (const section of slotSections) {
    const slot = section.assigneeSlot;
    const assignee = assignees[slot];
    const existing =
      slotGroups.find(
        (group) =>
          !claimedGroupIds.has(group.id) &&
          assigneeOwnerFromGroupName(group.name) === assignee?.userId,
      ) ?? groupForSection(section);
    if (existing) claimedGroupIds.add(existing.id);

    if (!assignee) {
      if (existing) {
        if (!fallback) throw new Error(`담당자 그룹 아이템을 옮길 일반 그룹이 없습니다: ${packBoard.slug}`);
        moveItems(existing.id, fallback.id);
        repo.deleteGroup(ctx, existing.id);
      }
      continue;
    }

    const expectedName = withAssigneeOwner(`${section.groupName}${assignee.displayName}`, assignee.userId);
    let group = existing;
    if (!group || group.name !== expectedName) {
      const replacement = repo.createGroup(ctx, boardId, { name: expectedName, color: section.color });
      if (group) {
        moveItems(group.id, replacement.id);
        repo.deleteGroup(ctx, group.id);
      }
      group = replacement;
    }

    next.push({ boardSlug: packBoard.slug, boardId, groupId: group.id, slot, userId: assignee.userId });
  }

  for (const obsolete of slotGroups.filter((group) => !claimedGroupIds.has(group.id))) {
    if (!fallback) throw new Error(`담당자 그룹 아이템을 옮길 일반 그룹이 없습니다: ${packBoard.slug}`);
    moveItems(obsolete.id, fallback.id);
    repo.deleteGroup(ctx, obsolete.id);
  }

  return next;
}

function installBoard(
  ctx: Ctx,
  repo: BoardsRepo,
  packBoard: PackBoard,
  pack: StructurePack,
  assignees: AssigneeMember[],
): { board: InstalledBoard; assigneeGroups: AssigneeGroupBinding[] } {
  const board = repo.createBoard(ctx, {
    name: packBoard.name,
    description: packBoard.description,
    icon: packBoard.icon,
  });

  // 배열 순서가 곧 sort_order 다 — 포트가 추가 순서대로 번호를 매긴다.
  const columnKeys = packBoard.columns.map((column) => {
    const created = repo.createColumn(ctx, board.id, {
      key: column.key,
      label: column.label,
      type: column.type,
      options: resolveOptions(column, pack),
      width: column.width ?? null,
    });
    return created.key;
  });

  const groupIds: string[] = [];
  const assigneeGroups: AssigneeGroupBinding[] = [];
  for (const section of packBoard.sections) {
    const name = resolveSectionName(section, assignees);
    if (name === null) continue; // 담당자별 슬롯인데 채울 멤버가 아직 없음(D73)
    const assignee =
      section.assigneeSlot === undefined ? undefined : assignees[section.assigneeSlot];
    const group = repo.createGroup(ctx, board.id, {
      name: assignee ? withAssigneeOwner(name, assignee.userId) : name,
      color: section.color,
    });
    groupIds.push(group.id);
    if (section.assigneeSlot !== undefined) {
      const assignee = assignees[section.assigneeSlot];
      if (assignee) {
        assigneeGroups.push({
          boardSlug: packBoard.slug,
          boardId: board.id,
          groupId: group.id,
          slot: section.assigneeSlot,
          userId: assignee.userId,
        });
      }
    }
  }

  const viewIds = packBoard.views.map(
    (view) =>
      repo.createView(ctx, board.id, {
        name: view.name,
        kind: view.kind,
        // 다중값 필터의 실제 적용은 WO-3 소유다. 여기서는 실측 조건을 담아만 둔다.
        filters: view.filters ?? {},
        shared: view.shared,
      }).id,
  );

  return {
    board: {
      slug: packBoard.slug,
      boardId: board.id,
      nameLabel: packBoard.nameColumn.label,
      groupIds,
      columnKeys,
      viewIds,
    },
    assigneeGroups,
  };
}
