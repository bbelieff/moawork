"use client";

import { useId, useRef, useState } from "react";
import { addItemAction } from "@/app/(app)/boards/actions";
import { planNewItemSubmit } from "@/lib/boards/add-item-validation";

export function AddItemForm({
  boardId,
  groupId,
  inputClassName,
}: {
  boardId: string;
  variant: "inline";
  groupId?: string | null;
  inputClassName?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const errorId = `mw-additem-error-${id}`;
  const hintId = `mw-additem-hint-${id}`;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const plan = planNewItemSubmit(inputRef.current?.value);
    setError(plan.error);
    if (plan.submit) return;
    event.preventDefault();
    if (plan.scrollToField) inputRef.current?.scrollIntoView({ block: "center", inline: "nearest" });
    if (plan.focusField) inputRef.current?.focus();
  }

  return (
    <form action={addItemAction} onSubmit={handleSubmit} noValidate className="flex flex-col gap-1">
      <input type="hidden" name="boardId" value={boardId} />
      <input type="hidden" name="groupId" value={groupId ?? ""} />
      <div className="flex items-center gap-1">
        <span aria-hidden="true" className="text-xs text-mw-sub">＋</span>
        <input
          ref={inputRef}
          name="title"
          aria-required="true"
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? errorId : hintId}
          aria-label="새 항목 이름 (필수)"
          placeholder="새 항목"
          onChange={() => error && setError(null)}
          className={inputClassName}
          style={error ? { borderColor: "var(--mw-error)" } : undefined}
        />
      </div>
      <p id={hintId} className="max-w-64 text-[0.65rem] text-mw-sub">
        이름만 입력하면 등록돼요. 나머지는 나중에 채울 수 있어요.
      </p>
      {error ? <p id={errorId} role="alert" className="max-w-64 text-[0.65rem] text-mw-error">{error}</p> : null}
    </form>
  );
}
