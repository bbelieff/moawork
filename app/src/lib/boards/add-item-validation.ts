export const NEW_ITEM_TITLE_MAX = 300;

export function planNewItemSubmit(raw: string | null | undefined) {
  const title = (raw ?? "").trim();
  if (!title) {
    return {
      submit: false,
      error: "이름을 입력해 주세요. 이름만 입력하면 등록되고 나머지는 나중에 채울 수 있어요.",
      scrollToField: true,
      focusField: true,
    } as const;
  }
  if (title.length > NEW_ITEM_TITLE_MAX) {
    return {
      submit: false,
      error: `이름이 너무 길어요. ${NEW_ITEM_TITLE_MAX}자 이하로 줄여 주세요.`,
      scrollToField: true,
      focusField: true,
    } as const;
  }
  return { submit: true, error: null, scrollToField: false, focusField: false } as const;
}
