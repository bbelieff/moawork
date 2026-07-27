/**
 * `deals.custom` (jsonb) 부분수정 병합 — **모든 Repo 구현체가 공유하는 단일 규약**.
 *
 * ── 왜 통째 교체가 아니라 병합인가 (BUG-0003) ──
 * `custom` 은 여러 트랙이 **한 칸을 나눠 쓰는** jsonb 다.
 *   - T05 커스텀필드 값 : custom[field_defs.key]
 *   - T09 정책자금 값   : custom.exec_amount · fee_pct · fee_paid_at …
 *   - T04 첨부          : custom.files[]
 * 통째 교체(Object.assign)면 한 트랙이 자기 키만 담아 보낸 순간 나머지 트랙의 값이
 * **에러 없이 조용히** 사라진다. 호출부의 read-modify-write 규율에 의존하는 대신
 * 포트에서 병합을 보장한다.
 *
 * ── 병합 깊이: 딱 한 겹 ──
 * 최상위 키 단위로만 병합하고, 키의 **값은 통째 대체**한다(재귀 병합 안 함).
 * 재귀 병합은 배열에서 틀린다 — `custom.files[]` 에서 첨부를 지운 짧은 배열을
 * 기존 배열과 원소 단위로 섞으면 **삭제한 파일이 되살아난다**.
 *
 * ── 삭제 규약 ──
 * 값이 `null` 이면 그 키를 **제거**한다(`Repo.setFieldValue` 의 "null = 셀 삭제"와 동일).
 * 값 자리에 null 을 남겨두면 "미입력"과 "빈 값"이 갈라져 집계가 어긋난다.
 */
export function mergeCustom(
  base: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else out[key] = value;
  }
  return out;
}
