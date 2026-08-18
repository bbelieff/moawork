// BBE-171 — 「새 항목」 이름 칸의 판정. 화면과 서버가 «같은 규칙» 을 쓴다.
//
// ★ 왜 순수 모듈로 떼어냈나
//   총괄 실측: 제출하면 브라우저 기본 말풍선 «이 입력란을 작성하세요» 가 뜨는데,
//   어느 칸인지 가로 스크롤 밖이라 보이지 않는다. 그건 native `required` 의 기본 동작이고
//   ⓐ 앱이 문구를 정할 수 없고 ⓑ 브라우저·언어마다 다르고 ⓒ 화면 밖이면 안 보인다.
//
//   그래서 native 검증을 끄고 앱이 판정한다. 판정을 여기 순수 함수로 두면
//   «클릭 없이» 실패 경로까지 테스트할 수 있다(이 저장소에는 jsdom 이 없다).
//
// ★ 서버 규칙과 어긋나지 않게 맞춘다
//   lib/boards/validation.ts:115  reqString(body.title, "title", 300)
//   → 필수 · 최대 300자. 화면이 더 느슨하면 서버에서 튕기고, 더 빡빡하면 넣을 수 있는 걸 막는다.

/** 서버 `parseNewItem` 의 title 상한과 같은 값이어야 한다. */
export const NEW_ITEM_TITLE_MAX = 300;

export type NewItemTitleCheck =
  | { ok: true; title: string }
  | { ok: false; reason: "empty" | "too_long"; message: string };

/**
 * 이름 한 칸의 판정.
 *
 * ★ 문구는 «무엇을 어떻게 채우는지» 를 말한다 — 카드 수용 기준.
 *   그리고 «이름만 넣으면 접수가 끝난다» 는 사실을 여기서 알려준다. 그걸 모르면
 *   사용자는 22개 컬럼을 가로로 훑어야 하는 줄 안다(Monday 정본은 «이름 먼저, 나머지는 나중»).
 */
export function checkNewItemTitle(raw: string | null | undefined): NewItemTitleCheck {
  const title = (raw ?? "").trim();
  if (title.length === 0) {
    return {
      ok: false,
      reason: "empty",
      message: "이름을 입력해 주세요. 업체명이나 담당자 이름이면 충분해요 — 나머지 항목은 나중에 채울 수 있어요.",
    };
  }
  if (title.length > NEW_ITEM_TITLE_MAX) {
    return {
      ok: false,
      reason: "too_long",
      message: `이름이 너무 길어요. ${NEW_ITEM_TITLE_MAX}자 이하로 줄여 주세요 (지금 ${title.length}자).`,
    };
  }
  return { ok: true, title };
}

/**
 * 제출 순간에 «무엇을 할지» 를 정한다 — 효과는 부르는 쪽이 적용한다.
 *
 * ★ 왜 이렇게 나눴나
 *   카드는 「오류 칸으로 자동 스크롤 + 포커스 + 하이라이트」를 요구한다. 그런데 이 저장소에는
 *   jsdom 이 없어 «클릭해서 포커스가 갔는지» 를 잴 수 없다. 판정과 «해야 할 일» 을 순수 값으로
 *   내보내면 그 요구사항이 실제로 살아 있는지 클릭 없이 잴 수 있다.
 *   (AGENTS 가 이 저장소에 권하는 「순수 함수로 떼어내고 효과를 주입」 그대로다.)
 *
 *   ★ 한계도 적어 둔다: 이 계획을 컴포넌트가 «실제로 적용하는지» 는 이 함수로 증명되지 않는다.
 *     그건 렌더 테스트와 사람 눈(⑦)이 본다.
 */
export type NewItemSubmitPlan = {
  /** 서버 액션으로 보낼지. false 면 preventDefault 해야 한다. */
  submit: boolean;
  /** 화면에 띄울 사유. null 이면 오류 표시를 지운다. */
  error: string | null;
  /** 그 칸으로 화면을 옮길지 — 22컬럼 보드에서는 입력칸이 뷰포트 밖일 수 있다. */
  scrollToField: boolean;
  /** 그 칸에 포커스를 줄지. */
  focusField: boolean;
};

export function planNewItemSubmit(raw: string | null | undefined): NewItemSubmitPlan {
  const verdict = checkNewItemTitle(raw);
  if (verdict.ok) {
    return { submit: true, error: null, scrollToField: false, focusField: false };
  }
  return { submit: false, error: verdict.message, scrollToField: true, focusField: true };
}
