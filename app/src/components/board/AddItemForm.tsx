"use client";

import { useId, useRef, useState } from "react";
import { addItemAction } from "@/app/(app)/boards/actions";
import { planNewItemSubmit } from "@/lib/boards/add-item-validation";

/**
 * 「새 항목」 이름 입력 (BBE-171).
 *
 * ★ 이 부품은 «모든 보드» 가 쓴다 — 신규리드·컨택·계약업무·공지가 함께 바뀐다.
 *   그래서 컬럼이 22개인 보드에서도 5개인 보드에서도 같은 규칙으로 동작해야 한다.
 *   두 자리에서 쓴다: BoardHeader 의 ＋새 항목 팝오버 · GroupTable 의 마지막 인라인 행.
 *
 * ★ 총괄 실측이 지적한 넷을 여기서 한 번에 처리한다
 *   ⓐ 제출 전에 «무엇이 필수인지» 보인다        → 라벨에 «필수» 표시 + aria-required
 *   ⓑ native 말풍선이 아니라 앱 오류 UI          → noValidate + role="alert"
 *   ⓒ 오류 칸으로 화면이 따라간다                → scrollIntoView + focus
 *   ⓓ 이름 한 칸이면 접수가 끝난다               → 그 사실을 문구로 말한다
 *
 * ★ native `required` 를 뺀 이유
 *   브라우저 기본 검증은 문구를 앱이 정할 수 없고, 무효 칸이 뷰포트 밖이면 말풍선이
 *   보이지 않는다. 22컬럼 보드에서 정확히 그 일이 났다. 대신 `noValidate` 로 끄고
 *   제출 직전에 우리가 판정한다 — 판정 규칙은 서버 `parseNewItem` 과 같은 모듈을 쓴다.
 *
 * ★ 제출이 «서버까지 갔다가» 실패하는 경우는 여기서 다루지 않는다.
 *   그건 BBE-201(#258)이 만든 boardActionFlash 가 이미 보드 배너로 보여준다.
 *   오류 표시 경로를 둘로 만들지 않으려고, 여기서는 «서버에 가기 전» 만 막는다.
 */
export type AddItemFormProps = {
  boardId: string;
  /** 팝오버는 그룹을 고르고, 인라인 행은 자기 그룹에 묶인다. */
  variant: "popover" | "inline";
  groupId?: string | null;
  groups?: readonly { id: string; name: string }[];
  inputClassName?: string;
};

export function AddItemForm({
  boardId,
  variant,
  groupId,
  groups,
  inputClassName,
}: AddItemFormProps) {
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reactId = useId();
  const errorId = `mw-additem-error-${reactId}`;
  const hintId = `mw-additem-hint-${reactId}`;
  const isPopover = variant === "popover";

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    // 판정과 «해야 할 일» 은 순수 모듈이 정한다 — 여기서는 적용만 한다.
    const plan = planNewItemSubmit(inputRef.current?.value);
    setError(plan.error);
    if (plan.submit) return; // 서버 액션으로 그대로 보낸다.
    event.preventDefault();
    // ★ 화면이 오류 칸을 «따라간다». 22컬럼 보드에서는 입력칸이 뷰포트 밖일 수 있다.
    if (plan.scrollToField) inputRef.current?.scrollIntoView({ block: "center", inline: "nearest" });
    if (plan.focusField) inputRef.current?.focus();
  }

  return (
    <form
      action={addItemAction}
      onSubmit={handleSubmit}
      // ★ 브라우저 기본 검증을 끈다 — 문구를 앱이 정하고, 화면 안에서 말하기 위해서다.
      noValidate
      data-testid={`add-item-${variant}`}
      className={
        isPopover
          ? "absolute right-0 top-full z-30 mt-1 flex w-64 flex-col gap-2 rounded-xl border border-mw-line bg-mw-card p-2 shadow-lg"
          : "flex flex-col gap-1"
      }
    >
      <input type="hidden" name="boardId" value={boardId} />
      {isPopover ? null : <input type="hidden" name="groupId" value={groupId ?? ""} />}

      <div className={isPopover ? "flex flex-col gap-1" : "flex items-center gap-1"}>
        {isPopover ? null : (
          <span aria-hidden="true" className="text-xs text-mw-sub">
            ＋
          </span>
        )}
        <input
          ref={inputRef}
          name="title"
          // ★ 제출 전에 «필수» 임을 보조기술에도 알린다. native 검증은 쓰지 않는다.
          aria-required="true"
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? errorId : hintId}
          placeholder={isPopover ? "항목 이름" : "새 항목"}
          aria-label={isPopover ? "항목 이름 (필수)" : "새 항목 이름 (필수)"}
          onChange={() => error && setError(null)}
          className={
            inputClassName ??
            "h-9 rounded-lg border border-mw-line bg-mw-card px-2 text-xs text-mw-fg outline-none focus:border-mw-record"
          }
          style={error ? { borderColor: "var(--mw-error)" } : undefined}
        />
      </div>

      {/* ★ 「이름 한 칸이면 끝」을 «제출 전에» 알린다 — 22컬럼을 가로로 훑지 않아도 된다는 뜻이다. */}
      <p id={hintId} className="text-[0.65rem] text-mw-sub">
        <span aria-hidden="true">*</span> 이름만 입력하면 등록돼요. 나머지는 나중에 채울 수 있어요.
      </p>

      {error ? (
        <p id={errorId} role="alert" data-testid="add-item-error" className="text-[0.65rem] text-mw-error">
          {error}
        </p>
      ) : null}

      {isPopover && groups ? (
        <>
          <select
            name="groupId"
            defaultValue={groups[0]?.id ?? ""}
            aria-label="그룹"
            className="h-9 rounded-lg border border-mw-line bg-mw-card px-2 text-xs text-mw-fg outline-none focus:border-mw-record"
          >
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="h-9 rounded-lg bg-mw-primary text-xs font-semibold text-mw-on-accent"
          >
            추가
          </button>
        </>
      ) : null}
    </form>
  );
}
