import { matchesText } from "@/lib/companies/search";

/**
 * 초성 검색 (BBE-125).
 *
 * 목업 `docs/design/UI목업_워크스페이스_최종_v6.html`의 `chosung()`/`hit()`를 그대로 옮겼다
 * (검증: `node docs/design/qa-mockup.mjs` 75/75, 그중 초성 관련 항목은 이 로직의 원본 동작이다).
 */

const CHOSUNG_TABLE =
  "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";

const HANGUL_BASE = 0xac00;
const HANGUL_END = 0xd7a3;
const CHOSUNG_COUNT = 588;

/** 완성형 한글 음절을 초성으로 축약한다. 한글이 아닌 문자는 그대로 통과시킨다. */
export function chosung(text: string): string {
  return [...text]
    .map((ch) => {
      const code = ch.charCodeAt(0) - HANGUL_BASE;
      if (code >= 0 && code <= HANGUL_END - HANGUL_BASE) {
        return CHOSUNG_TABLE[Math.floor(code / CHOSUNG_COUNT)];
      }
      return ch;
    })
    .join("");
}

/**
 * `name`이 검색어 `query`에 걸리는지 판정한다.
 * 빈 검색어는 항상 통과(전체 목록 표시).
 *
 * ★ 판정을 «한 벌» 로 합쳤다 (#588 ⑤).
 *   전에는 여기와 lib/companies/search.ts 에 각각 있었고, 둘 다 같은 결함을 갖고 있었다 —
 *   질의까지 초성으로 낮춰서 「대성」이 「다스산업」·「동서물류」를 잡았다.
 *   한쪽만 고치면 화면마다 검색 결과가 «다르게» 나온다.
 *   이 파일이 쓰이는 곳: 리드컨택 → 업체 연결(ContactPipelineAction) · 신규리드 지역 검색.
 */
export function matchesQuery(name: string, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  return matchesText(name, q);
}
