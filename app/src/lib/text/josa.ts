/**
 * 한국어 조사 — 앞말의 «받침» 에 따라 골라 붙인다.
 *
 * ★ 왜 필요한가 — 이름을 문장에 «끼워 넣는» 자리마다 조사가 깨지고 있었다.
 *
 *     roleDescription: `${roleLabel(ctx.role)}로 참여하고 있어요.`
 *
 *   네 역할 중 둘이 받침으로 끝나서 이렇게 보였다:
 *
 *     대표    → 「대표로 참여하고 있어요」      ✅
 *     관리자  → 「관리자로 …」                 ✅
 *     팀장    → 「팀장로 …」                   ❌  받침 ㅇ → 「팀장으로」
 *     구성원  → 「구성원로 …」                 ❌  받침 ㄴ → 「구성원으로」
 *
 *   #699 가 이름표를 「사원」에서 「구성원」으로 바꿨지만 **둘 다 받침이라 계속 깨져 있었다.**
 *   이름을 고치는 것만으로는 안 된다 — 조사가 이름을 «따라와야» 한다.
 *
 * ★ 이름이 사람이 지은 값일 때 특히 중요하다. 컬럼 이름·부서 이름처럼 무엇이 올지 모르는
 *   자리에 조사를 손으로 적으면 «반드시» 절반이 틀린다.
 */

const HANGUL_FIRST = 0xac00;
const HANGUL_LAST = 0xd7a3;
const JONGSEONG_COUNT = 28;
/** 종성 표에서 ㄹ 의 자리. 「으로/로」만 이 값을 «받침 없음» 처럼 다룬다. */
const JONGSEONG_RIEUL = 8;

/**
 * 마지막 글자의 종성 번호. 한글이 아니면 `null`.
 *
 * 0 이면 받침 없음(가·자·표), 1~27 이면 받침 있음.
 */
function lastJongseong(word: string): number | null {
  const trimmed = word.trimEnd();
  if (!trimmed) return null;
  const code = trimmed.codePointAt(trimmed.length - 1);
  if (code === undefined || code < HANGUL_FIRST || code > HANGUL_LAST) return null;
  return (code - HANGUL_FIRST) % JONGSEONG_COUNT;
}

/**
 * 받침이 있으면 `withBatchim`, 없으면 `withoutBatchim`.
 *
 * ★ 한글이 아니면(영문·숫자·이모지) **받침 없음 쪽**을 쓴다.
 *   영문·숫자는 읽는 방식에 따라 갈려서 기계가 정할 수 없다 —
 *   틀릴 바에는 한쪽으로 «일관되게» 틀리는 편이 읽기 낫다. 여기서 추측하지 않는다.
 */
function pick(word: string, withBatchim: string, withoutBatchim: string): string {
  const jong = lastJongseong(word);
  return jong !== null && jong !== 0 ? withBatchim : withoutBatchim;
}

/** 「구성원을 / 대표를」 */
export function eulReul(word: string): string {
  return pick(word, "을", "를");
}

/** 「구성원이 / 대표가」 */
export function iGa(word: string): string {
  return pick(word, "이", "가");
}

/** 「구성원은 / 대표는」 */
export function eunNeun(word: string): string {
  return pick(word, "은", "는");
}

/** 「구성원과 / 대표와」 */
export function gwaWa(word: string): string {
  return pick(word, "과", "와");
}

/**
 * 「구성원으로 / 대표로」
 *
 * ★ 「으로/로」만 규칙이 다르다 — **받침이 ㄹ 이면 「로」** 다(서울로·하늘로).
 *   이걸 빼먹으면 「서울으로」가 된다.
 */
export function euroRo(word: string): string {
  const jong = lastJongseong(word);
  if (jong === null || jong === 0 || jong === JONGSEONG_RIEUL) return "로";
  return "으로";
}
