import { BoardsService } from "./service";
import { createRequestBoardsContext } from "./request-repo";

/**
 * Build the board graph from the authenticated client bound to this request.
 *
 * ★ BBE-209 — `/boards/[id]` 의 마지막 관문이었다. 이 한 줄의 `createClient()` 가
 *   Supabase 없이 던져 보드 상세가 통째로 500 이었다(권한 두 관문은 BBE-204·BBE-207 이 이미 열었다).
 *
 * ★ `client` 가 «null 일 수 있다» 는 것이 이 계약의 핵심이다.
 *   로컬 시드에는 Supabase 클라이언트가 없다. `repo`·`service` 는 로컬로 대체되지만
 *   **원본 클라이언트를 직접 쓰는 쪽(알림 발송·원자적 전환 등)은 대체물이 없다.**
 *   그래서 타입으로 «없을 수 있음» 을 드러내 호출부가 반드시 마주보게 한다 —
 *   조용히 넘기면 「눌렀는데 아무 일도 안 일어남」이 된다.
 *
 * ★ 조건은 인라인이다. 함수로 감싸면 경계 검사기(isInsideExplicitDevGuard)가 못 읽어
 *   `getBoardsRepo` 가 운영 위반으로 세어진다.
 */
export async function createRequestBoards() {
  const { client, repo } = await createRequestBoardsContext();
  return { client, repo, service: new BoardsService(repo) };
}

/**
 * 원본 Supabase 클라이언트가 «반드시» 있어야 하는 자리에서 쓴다.
 * 로컬 시드에는 대체물이 없으므로 조용히 넘기지 않고 사유를 남기고 멈춘다.
 */
export function requireRequestClient(
  client: Awaited<ReturnType<typeof createRequestBoards>>["client"],
  operation: string,
): NonNullable<Awaited<ReturnType<typeof createRequestBoards>>["client"]> {
  if (!client) {
    throw new Error(`${operation}: 이 동작은 연결된 워크스페이스가 필요합니다(로컬 시드에서는 실행할 수 없습니다).`);
  }
  return client;
}
