import { describe, expect, it } from "vitest";
import { LocalBoardsRepo, toAsyncBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { ensureDefaultTabAdditive } from "./install";
import type { DefaultTab } from "./types";
import type { Ctx } from "@/lib/types";

/**
 * #551 — «이미 만들어진 보드» 의 옛 라벨과 뒤섞인 순서를 되맞춘다.
 *
 * 실측(2026-08-25 운영): 계약업체 실무 보드의 맨 앞 열이 «수수료_입금일» 이었고
 * 라벨이 «진행상항»(오탈자)·«자금명»·«진행 상품» 인 채로 남아 있었다.
 * 설치 코드는 정의 순서대로 매기므로 이건 옛 데이터의 잔재다.
 *
 * ★ 이 테스트가 지키는 경계는 «되맞추는 것» 보다 «안 건드리는 것» 이다 —
 *   회사가 직접 바꾼 이름·순서를 제품이 되돌려 놓으면 그건 고장이지 복구가 아니다.
 */

const ctx = { user: { id: "u1" }, org: { id: "org-1" }, role: "owner", scope: "all" } as Ctx;
const assignees = [{ userId: "u1", displayName: "담당" }];

function tab(revision: number, labels: Record<string, string>): DefaultTab {
  return {
    revision,
    previousRevision: { revision: 1, columns: { alpha: { label: "옛 알파" } } },
    key: "work",
    source: "test/reconcile",
    name: "테스트 탭",
    icon: "🔁",
    description: "설명",
    groups: [{ name: "그룹" }],
    columns: [
      { key: "alpha", label: labels.alpha, type: "text", source: "in" },
      { key: "beta", label: "베타", type: "text", source: "in" },
      { key: "gamma", label: "감마", type: "text", source: "in" },
    ],
    transitions: [],
  } as unknown as DefaultTab;
}

async function install(repo: LocalBoardsRepo, definition: DefaultTab) {
  return ensureDefaultTabAdditive(ctx, definition, toAsyncBoardsRepo(repo), assignees);
}

const orderOf = (repo: LocalBoardsRepo, boardId: string) =>
  repo.listColumns(ctx, boardId).sort((a, b) => a.sort_order - b.sort_order).map((c) => c.key);
const labelOf = (repo: LocalBoardsRepo, boardId: string, key: string) =>
  repo.listColumns(ctx, boardId).find((c) => c.key === key)?.label;

describe("#551 라벨·순서 되맞춤", () => {
  it("설치 직후에는 정의 순서 그대로다", async () => {
    const repo = new LocalBoardsRepo();
    const { boardId } = await install(repo, tab(1, { alpha: "옛 알파" }));
    expect(orderOf(repo, boardId)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("우리가 심은 옛 이름은 새 이름으로 옮긴다", async () => {
    const repo = new LocalBoardsRepo();
    const { boardId } = await install(repo, tab(1, { alpha: "옛 알파" }));
    expect(labelOf(repo, boardId, "alpha")).toBe("옛 알파");

    await install(repo, tab(2, { alpha: "새 알파" }));
    expect(labelOf(repo, boardId, "alpha")).toBe("새 알파");
  });

  it("★ 회사가 바꾼 이름은 되돌리지 않는다", async () => {
    const repo = new LocalBoardsRepo();
    const { boardId } = await install(repo, tab(1, { alpha: "옛 알파" }));
    const column = repo.listColumns(ctx, boardId).find((c) => c.key === "alpha")!;
    repo.updateColumn(ctx, column.id, { label: "우리 회사 이름" });

    await install(repo, tab(2, { alpha: "새 알파" }));
    expect(labelOf(repo, boardId, "alpha"), "회사가 지은 이름을 제품이 덮어썼다").toBe("우리 회사 이름");
  });

  it("뒤섞인 순서를 정의 순서로 되맞춘다", async () => {
    const repo = new LocalBoardsRepo();
    const { boardId } = await install(repo, tab(1, { alpha: "옛 알파" }));
    // 운영에서 실제로 이런 상태였다 — 정의와 무관한 순서.
    const columns = repo.listColumns(ctx, boardId);
    const scrambled = ["gamma", "alpha", "beta"];
    for (const [index, key] of scrambled.entries()) {
      repo.updateColumn(ctx, columns.find((c) => c.key === key)!.id, { sort_order: 100 + index });
    }
    // 그 상태를 «우리가 기록한 것» 으로 만든다(= 회사가 손댄 것이 아니다).
    await install(repo, tab(1, { alpha: "옛 알파" }));
    expect(orderOf(repo, boardId)).toEqual(scrambled);

    await install(repo, tab(2, { alpha: "새 알파" }));
    expect(orderOf(repo, boardId)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("★ 회사가 옮긴 순서는 되돌리지 않는다", async () => {
    const repo = new LocalBoardsRepo();
    const { boardId } = await install(repo, tab(1, { alpha: "옛 알파" }));
    // 기록을 남긴 «뒤» 회사가 옮긴다 — 기록과 DB 가 어긋난 상태가 «회사가 손댄» 표시다.
    // ★ 정의 순서와 «다른» 결과가 되도록 맨 앞을 맨 뒤로 보낸다.
    //   그래야 「안 건드렸다」와 「되돌렸다」가 구분된다(둘 다 같은 결과가 되면 허수 테스트다).
    const columns = repo.listColumns(ctx, boardId);
    repo.updateColumn(ctx, columns.find((c) => c.key === "alpha")!.id, { sort_order: 100 });
    expect(orderOf(repo, boardId)).toEqual(["beta", "gamma", "alpha"]);

    await install(repo, tab(2, { alpha: "새 알파" }));
    expect(orderOf(repo, boardId), "회사가 옮긴 순서를 제품이 되돌렸다").toEqual(["beta", "gamma", "alpha"]);
  });
});
