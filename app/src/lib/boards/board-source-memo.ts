/**
 * Issue 857 — 보드 id → 보드 종류(source) 의 짧지 않은 기억.
 *
 * 탭 화면은 보드 종류에 따라 꼬리 읽기(담당자·조직도·회사 목록)가 다르다. 종류는 메타데이터를 읽어야
 * 알 수 있어서, 꼬리 읽기가 행 읽기보다 한 물결 늦게 출발했다(DB 왕복 1회 ≈ 0.16–0.2초).
 * 한 보드의 종류는 바뀌지 않으므로 한 번 본 것을 기억해 다음부터는 판정 직후 행과 같이 출발시킨다.
 *
 * 기억은 «어느 읽기를 미리 띄울지» 만 정한다. 화면은 언제나 이번에 읽은 메타데이터의 종류로 판단하고,
 * 기억이 틀렸으면 미리 띄운 결과를 버리고 그 자리에서 맞는 읽기를 한다(늦어질 뿐 틀리지 않는다).
 * 권한과 무관하다 — 미리 띄우는 것도 판정(권한·D24)을 통과한 뒤이고, 읽기는 모두 RLS 아래다.
 */
const MAX_ENTRIES = 5000;
const memo = new Map<string, string | null>();

export function recallBoardSource(boardId: string): string | null | undefined {
  return memo.get(boardId);
}

export function rememberBoardSource(boardId: string, source: string | null | undefined): void {
  if (!memo.has(boardId) && memo.size >= MAX_ENTRIES) memo.clear();
  memo.set(boardId, source ?? null);
}

/** 시험 전용. */
export function resetBoardSourceMemo(): void {
  memo.clear();
}
