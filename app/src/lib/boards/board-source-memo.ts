/**
 * Issue 857 — 보드 id → 보드 종류(source) 의 짧지 않은 기억.
 *
 * 탭 화면은 보드 종류에 따라 꼬리 읽기(담당자·조직도·회사 목록)가 다르다. 종류는 메타데이터를 읽어야
 * 알 수 있어서, 꼬리 읽기가 행 읽기보다 한 물결 늦게 출발했다(DB 왕복 1회 ≈ 0.16–0.2초).
 * 보이는 보드의 종류는 바뀌지 않으므로 한 번 본 것을 기억해 다음부터는 판정 직후 행과 같이 출발시킨다.
 * (휴지통으로 보내면 source 가 trash/… 로 바뀌지만 그 보드는 404 이고, 복구하면 원래 값으로 돌아온다.)
 *
 * 기억은 «어느 읽기를 미리 띄울지» 만 정한다. 화면은 언제나 이번에 읽은 메타데이터의 종류로 판단하고,
 * 기억이 틀렸으면 미리 띄운 결과를 버리고 그 자리에서 맞는 읽기를 한다(늦어질 뿐 틀리지 않는다).
 * 권한과 무관하다 — 미리 띄우는 것도 판정(권한·D24)을 통과한 뒤이고, 읽기는 모두 RLS 아래다.
 * 회사별로 나누지 않는 것은 의도다 — 종류는 보드 자체의 값이고, 미리 띄우는 읽기는 보드가 아니라
 * 보는 사람의 회사(ctx)만 받는다. 다른 회사 보드면 그 화면이 404 라 읽은 것은 그려지지 않고 버려진다.
 */
const MAX_ENTRIES = 5000;
const memo = new Map<string, string | null>();

/** uuid 는 대소문자를 가리지 않는다 — 한 보드가 여러 칸을 차지하지 않게 맞춘다. */
function keyOf(boardId: string): string {
  return boardId.toLowerCase();
}

export function recallBoardSource(boardId: string): string | null | undefined {
  return memo.get(keyOf(boardId));
}

export function rememberBoardSource(boardId: string, source: string | null | undefined): void {
  const key = keyOf(boardId);
  if (!memo.has(key) && memo.size >= MAX_ENTRIES) memo.clear();
  memo.set(key, source ?? null);
}

/** 시험 전용. */
export function resetBoardSourceMemo(): void {
  memo.clear();
}
