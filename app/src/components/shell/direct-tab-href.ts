/**
 * Issue 857 — 기본 탭 메뉴를 경유지(`/newcust` 등) 대신 그 보드로 바로 보낸다.
 *
 * 경유지는 점검(약 1초) 뒤 `/boards/<id>` 로 다시 보내는 화면이라, 메뉴를 누를 때마다 서버를
 * 두 번 들렀다. 사이드바는 이미 보드 id → 메뉴 키 지도(boardNavKeys)를 갖고 있으므로, 그 메뉴의
 * 보드가 «딱 하나» 일 때만 바로 보낸다. 없거나 둘 이상이면 경유지가 안내·복구를 맡도록 그대로 둔다.
 */
const DIRECT_BOARD_TARGET: Readonly<Record<string, { navKey: string; query?: string }>> = {
  new: { navKey: "new" },
  contact: { navKey: "contact" },
  "consult-remote": { navKey: "contact", query: "consultation=remote" },
  "consult-inperson": { navKey: "contact", query: "consultation=inperson" },
  work: { navKey: "work" },
  notice: { navKey: "notice" },
};

export function directBoardHref(itemKey: string, boardNavKeys?: Readonly<Record<string, string>>): string | null {
  const target = DIRECT_BOARD_TARGET[itemKey];
  if (!target || !boardNavKeys) return null;
  const boardIds = Object.entries(boardNavKeys).filter(([, key]) => key === target.navKey).map(([boardId]) => boardId);
  if (boardIds.length !== 1) return null;
  return `/boards/${encodeURIComponent(boardIds[0])}${target.query ? `?${target.query}` : ""}`;
}
