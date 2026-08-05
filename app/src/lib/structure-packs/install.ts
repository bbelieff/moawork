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
import { SEOUL_STRUCTURE_PACK } from "./seoul-pack";
import type { DeferredColumn, PackBoard, StructurePack } from "./types";

export interface InstalledBoard {
  slug: string;
  boardId: string;
  /** 만들어진 그룹 id — 팩의 `sections` 순서와 1:1. */
  groupIds: string[];
  /** 만들어진 컬럼 key — 팩의 `columns` 순서와 1:1. */
  columnKeys: string[];
  viewIds: string[];
}

export interface InstallResult {
  packKey: string;
  boards: InstalledBoard[];
  /** 구조만 기록하고 만들지 않은 컬럼(PLAN-003). 보드 slug 를 앞에 붙여 돌려준다. */
  deferred: Array<DeferredColumn & { boardSlug: string }>;
  /** 이미 있어서 건너뛴 보드 slug. 재실행해도 중복 생성되지 않는다. */
  skipped: string[];
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
  options: { repo?: BoardsRepo; pack?: StructurePack } = {},
): InstallResult {
  const repo = options.repo ?? getBoardsRepo();
  const pack = options.pack ?? SEOUL_STRUCTURE_PACK;

  const existingNames = new Set(repo.listBoards(ctx).map((b) => b.name));
  const boards: InstalledBoard[] = [];
  const skipped: string[] = [];
  const deferred: Array<DeferredColumn & { boardSlug: string }> = [];

  for (const packBoard of pack.boards) {
    deferred.push(
      ...packBoard.deferredColumns.map((column) => ({ ...column, boardSlug: packBoard.slug })),
    );
    if (existingNames.has(packBoard.name)) {
      skipped.push(packBoard.slug);
      continue;
    }
    boards.push(installBoard(ctx, repo, packBoard));
  }

  return { packKey: pack.key, boards, deferred, skipped };
}

function installBoard(ctx: Ctx, repo: BoardsRepo, packBoard: PackBoard): InstalledBoard {
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
      options: column.options ?? null,
      width: column.width ?? null,
    });
    return created.key;
  });

  const groupIds = packBoard.sections.map(
    (section) => repo.createGroup(ctx, board.id, { name: section.groupName, color: section.color }).id,
  );

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

  return { slug: packBoard.slug, boardId: board.id, groupIds, columnKeys, viewIds };
}
