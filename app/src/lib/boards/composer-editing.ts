/**
 * 메모 입력창의 «계산» 부분 (#660).
 *
 * 높이 계산과 마크다운 편집 규칙을 화면 밖에 둔다. 이게 컴포넌트 안에 있으면
 * 검사할 자리가 없어진다 — #638 이 이름 붙인 「판정→화면 배선 무검사」가 정확히 그 병이다.
 * 여기는 DOM 을 모른다. 문자열과 커서 위치만 받고 돌려준다.
 */

/** 두 줄이 보이는 최소 높이(px). 이보다 작아지면 «적는 칸» 으로 안 보인다. */
export const COMPOSER_MIN_HEIGHT = 44;

/** 화면의 40% 까지만 늘어난다 — 총괄 지시. 더 커지면 히스토리가 안 보인다. */
export const COMPOSER_MAX_VIEWPORT_RATIO = 0.4;

export function composerMaxHeight(viewportHeight: number): number {
  return Math.max(COMPOSER_MIN_HEIGHT, Math.round(viewportHeight * COMPOSER_MAX_VIEWPORT_RATIO));
}

export function clampComposerHeight(next: number, viewportHeight: number): number {
  if (!Number.isFinite(next)) return COMPOSER_MIN_HEIGHT;
  return Math.min(Math.max(Math.round(next), COMPOSER_MIN_HEIGHT), composerMaxHeight(viewportHeight));
}

export interface EditState {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

const INDENT = "  ";

/** 커서/선택이 걸친 줄들의 [시작 offset, 끝 offset] 목록. */
function lineBounds(value: string, from: number, to: number): Array<{ start: number; end: number }> {
  const first = value.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
  const lastBreak = value.indexOf("\n", to);
  const last = lastBreak === -1 ? value.length : lastBreak;
  const bounds: Array<{ start: number; end: number }> = [];
  let cursor = first;
  while (cursor <= last) {
    const nextBreak = value.indexOf("\n", cursor);
    const end = nextBreak === -1 || nextBreak > last ? last : nextBreak;
    bounds.push({ start: cursor, end });
    if (end >= last) break;
    cursor = end + 1;
  }
  return bounds;
}

/** 탭 — 걸친 줄 전부를 두 칸 들여쓴다. */
export function indentLines(state: EditState): EditState {
  const lines = lineBounds(state.value, state.selectionStart, state.selectionEnd);
  let value = state.value;
  // 뒤에서부터 넣어야 앞 줄의 offset 이 안 밀린다.
  for (const { start } of [...lines].reverse()) {
    value = `${value.slice(0, start)}${INDENT}${value.slice(start)}`;
  }
  return {
    value,
    selectionStart: state.selectionStart + INDENT.length,
    selectionEnd: state.selectionEnd + INDENT.length * lines.length,
  };
}

/** 시프트+탭 — 걸친 줄 전부에서 앞의 공백을 최대 두 칸까지 뺀다. */
export function outdentLines(state: EditState): EditState {
  const lines = lineBounds(state.value, state.selectionStart, state.selectionEnd);
  let value = state.value;
  let removedBeforeStart = 0;
  let removedTotal = 0;
  for (const { start } of [...lines].reverse()) {
    const head = value.slice(start, start + INDENT.length);
    const drop = head.startsWith(INDENT) ? INDENT.length : head.startsWith(" ") ? 1 : 0;
    if (drop === 0) continue;
    value = `${value.slice(0, start)}${value.slice(start + drop)}`;
    removedTotal += drop;
    if (start < state.selectionStart) removedBeforeStart += drop;
  }
  return {
    value,
    selectionStart: Math.max(0, state.selectionStart - removedBeforeStart),
    selectionEnd: Math.max(0, state.selectionEnd - removedTotal),
  };
}

/** `- ` · `* ` · `1. ` · `> ` — 줄머리의 목록 표식. */
const MARKER = /^(\s*)([-*+]|\d+\.|>)(\s+)(.*)$/u;

/**
 * 엔터 — 목록을 «이어 준다».
 *
 * 표식만 있고 내용이 빈 줄에서 엔터를 치면 표식을 지운다(목록에서 빠져나오기).
 * 목록이 아니면 null 을 돌려주고, 그때는 브라우저 기본 동작을 그대로 둔다 —
 * 여기서 흉내 내면 실행 취소 기록이 끊긴다.
 */
export function continueList(state: EditState): EditState | null {
  if (state.selectionStart !== state.selectionEnd) return null;
  const cursor = state.selectionStart;
  const lineStart = state.value.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
  const lineEnd = state.value.indexOf("\n", cursor) === -1 ? state.value.length : state.value.indexOf("\n", cursor);
  const line = state.value.slice(lineStart, lineEnd);
  const match = MARKER.exec(line);
  if (!match) return null;

  const [, indent, bullet, gap, body] = match;
  if (body.trim() === "") {
    // 빈 항목에서 엔터 — 표식을 지우고 그 줄을 비운다. 새 줄을 만들지 않는다.
    const value = `${state.value.slice(0, lineStart)}${state.value.slice(lineEnd)}`;
    return { value, selectionStart: lineStart, selectionEnd: lineStart };
  }

  // 번호 목록은 다음 번호로 이어 준다. 그 외는 같은 표식.
  const nextBullet = /^\d+\.$/u.test(bullet) ? `${Number.parseInt(bullet, 10) + 1}.` : bullet;
  const insert = `\n${indent}${nextBullet}${gap}`;
  const value = `${state.value.slice(0, cursor)}${insert}${state.value.slice(cursor)}`;
  const next = cursor + insert.length;
  return { value, selectionStart: next, selectionEnd: next };
}

/**
 * 「- 」처럼 줄머리에서 표식을 «막 완성한» 상태인가.
 * 화면이 「목록으로 바뀌었다」를 알려 줄 때 쓴다 — 값을 바꾸지는 않는다.
 */
export function isListLine(value: string, cursor: number): boolean {
  const lineStart = value.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
  return MARKER.test(value.slice(lineStart, cursor));
}
