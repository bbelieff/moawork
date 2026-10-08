/**
 * Issue 857 — 프록시가 «이 사람의 회사 목록» 을 짧게 기억한다.
 *
 * 프록시는 /w/<회사>/… 요청마다 org_members 를 읽어 그 회사의 회원인지 보고 내부 경로로 넘긴다.
 * 바로 뒤에서 화면·액션의 getSession 이 같은 사람의 멤버십을 «다시» 읽어 확정한다(권한의 정본).
 * 서버(쿠알라룸푸르)↔DB(서울) 왕복이 0.16초라, 같은 사람이 탭을 옮길 때마다 프록시 왕복이 그대로 쌓였다.
 *
 * 규칙:
 *   · 기억은 «들어갈 수 있다» 판정에만 쓴다. 기억으로 거부·없음이 나오면 지금 다시 읽는다
 *     (방금 가입·초대 수락한 회사가 막히지 않게).
 *   · 기억은 권한이 아니다. 탈퇴·정지·회사 닫힘은 getSession 이 매 요청 새로 읽어 막는다
 *     (세션은 쿠키 회사의 활성 멤버십만 고른다). DB 는 RLS 로 다시 막는다.
 *     그래서 기억이 낡아도 늦어지는 것은 «어느 회사 주소로 넘길지» 뿐이다.
 *   · 한 서버 프로세스 안의 기억이다. 짧게(1분), 개수 상한을 둔다.
 */
const TTL_MS = 60 * 1000;
const MAX_ENTRIES = 2000;

const memo = new Map<string, { rows: unknown; at: number }>();

export function recallMembershipRows(userId: string, now = Date.now()): unknown | undefined {
  const entry = memo.get(userId);
  if (!entry) return undefined;
  if (now - entry.at >= TTL_MS) {
    memo.delete(userId);
    return undefined;
  }
  return entry.rows;
}

export function rememberMembershipRows(userId: string, rows: unknown, now = Date.now()): void {
  if (!memo.has(userId) && memo.size >= MAX_ENTRIES) memo.clear();
  memo.set(userId, { rows, at: now });
}

export function forgetMembershipRows(userId: string): void {
  memo.delete(userId);
}

/** 시험 전용 — 시험끼리 기억이 새지 않게 비운다. */
export function resetMembershipMemo(): void {
  memo.clear();
}
