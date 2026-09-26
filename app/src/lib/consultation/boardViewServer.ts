/**
 * 상담 단계 보기 서버 로더 — 보드 화면(서버)에서만 쓴다.
 *
 * 클라이언트 컴포넌트가 이 모듈을 import 하지 않는다 — boundary 검사가
 * 서버 그래프의 직접 호출을 막으므로, 화면에는 props 로만 전달한다.
 * F7: 후보 ID bounded chunk 로 나눠 읽는다(무제한 전체 조회 금지).
 * 실패하면 던지지 않고 `{ ok: false }` 로 돌려준다 — 화면이 전체 보기로
 * 조용히 넓어지지 않게 호출자가 안내 문구를 함께 그린다.
 */

import {
  readConsultationBoardView,
  readConsultationBoardViewInChunks,
  type ConsultationBoardMap,
  type ConsultationBoardRpcClient,
} from "./boardView";

export type ConsultationBoardLoadResult =
  | { ok: true; entries: ConsultationBoardMap }
  | { ok: false; message: string };

/**
 * 단계 보기 일괄 적재 — 권한 밖 행은 RPC 가 이미 빼고 준다. 여기서 한 번 더
 * 호출자의 허용 목록(visibleItemIds)과 교집합해 fail-closed 로 좁힌다.
 * F7: candidateItemIds(보드 행, bounded)가 있으면 chunk 로 읽고, 없으면
 * 기존처럼 보드 범위 조회 후 교집합한다. 빈 후보는 RPC 없이 빈 맵이다.
 */
export async function loadConsultationBoardView(
  client: ConsultationBoardRpcClient,
  input: Readonly<{
    orgId: string;
    boardId: string;
    visibleItemIds: ReadonlySet<string>;
    candidateItemIds?: readonly string[];
  }>,
): Promise<ConsultationBoardLoadResult> {
  try {
    if (input.candidateItemIds !== undefined) {
      if (input.candidateItemIds.length === 0) return { ok: true, entries: {} };
      // 후보를 visible 과 먼저 좁혀 SQL 에 보내는 ID 를 bounded·authorized 로 둔다.
      const scoped = input.candidateItemIds.filter((id) => input.visibleItemIds.has(id));
      if (scoped.length === 0) return { ok: true, entries: {} };
      const entries = await readConsultationBoardViewInChunks(client, {
        orgId: input.orgId,
        boardId: input.boardId,
        itemIds: scoped,
      });
      const narrowed: Record<string, ConsultationBoardMap[string]> = {};
      for (const [itemId, entry] of Object.entries(entries)) {
        if (input.visibleItemIds.has(itemId)) narrowed[itemId] = entry;
      }
      return { ok: true, entries: narrowed };
    }
    const entries = await readConsultationBoardView(client, {
      orgId: input.orgId,
      boardId: input.boardId,
    });
    const narrowed: Record<string, ConsultationBoardMap[string]> = {};
    for (const [itemId, entry] of Object.entries(entries)) {
      if (input.visibleItemIds.has(itemId)) narrowed[itemId] = entry;
    }
    return { ok: true, entries: narrowed };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "상담 단계 보기를 읽지 못했습니다.",
    };
  }
}
