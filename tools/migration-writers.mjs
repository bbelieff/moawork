/**
 * 「지금 누가 DB 를 바꾸고 있나」의 정답지 (AGENTS.md §5 동시 migration writer 방어).
 *
 * ★ 제목으로 추측하지 않는다. 그 PR 이 supabase/migrations/ 를 건드리는가로 판정한다.
 *   제목 정규식은 실제로 마이그레이션을 쓴 이슈 15건 중 «0건» 을 잡았다 —
 *   DB 를 바꾸는 사람은 제목에 DB 이야기를 안 쓴다.
 *
 * ★ 이 파일이 따로 있는 이유 — 서버를 띄우지 않고도 «행동» 을 잴 수 있게 한다.
 *   전에는 이 판정이 서버 안에 인라인이라, 항상 false 를 돌려주게 만들어도
 *   39개 검사가 전부 초록이었다. 판정에는 그 판정을 재는 검사가 붙어 있어야 한다.
 */

export const MIGRATION_PATH_PREFIX = "supabase/migrations/";

/**
 * 이 PR 이 마이그레이션을 담고 있는가.
 *
 * @returns true · false · **null**
 *
 * ★ null 은 «모른다» 다. «아니다» 가 아니다.
 *   `gh pr list --json files` 는 파일 100개에서 «조용히» 자른다 — 오류도 없고
 *   페이지네이션도 없다. 게다가 목록이 경로 알파벳 순이라 `supabase/` 는
 *   `app/`·`docs/`·`scripts/` 뒤라서 «잘림의 첫 희생자» 다.
 *   그래서 잘린 낌새(changedFiles > 받은 수)가 있으면 false 로 단정하지 않는다.
 *   조용히 false 로 두면 「있는데 없다」가 되고, 그게 이 카드가 앓던 병이다.
 */
export function touchesMigrations(pr) {
  const files = Array.isArray(pr?.files) ? pr.files : [];
  const changed = Number.isFinite(pr?.changedFiles) ? pr.changedFiles : null;
  if (files.some((file) => String(file?.path || "").startsWith(MIGRATION_PATH_PREFIX))) return true;
  if (changed !== null && changed > files.length) return null;
  return false;
}

/**
 * 열린 PR 목록 → 번호별 판정.
 * 조회 자체가 실패했으면 이 함수를 부르지 않는다 — 빈 Map 과 «못 읽음» 은 다르다.
 */
export function migrationWriterMap(openPrs) {
  const map = new Map();
  for (const pr of openPrs || []) {
    if (!Number.isFinite(pr?.number)) continue;
    map.set(pr.number, touchesMigrations(pr));
  }
  return map;
}
