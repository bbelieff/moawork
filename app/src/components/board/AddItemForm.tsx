"use client";

import { useEffect, useId, useRef, useState, type MutableRefObject, type RefObject } from "react";
import { useFormStatus } from "react-dom";
import { addItemAction } from "@/app/(app)/boards/actions";
import type { CellValue } from "@/lib/boards/types";
import { planNewItemSubmit } from "@/lib/boards/add-item-validation";

export function AddItemForm({
  boardId,
  groupId,
  inputClassName,
  prefill = null,
  focusRequest = 0,
}: {
  boardId: string;
  variant: "inline";
  groupId?: string | null;
  inputClassName?: string;
  /**
   * #845 7단계 — 나눠 보기 묶음에서 만들면 그 묶음의 값을 같이 보낸다. 서버(addItemAction)가 칸·값·구성원을
   * 다시 확인하고 만들 때 넣는다.
   */
  prefill?: { columnKey: string; value: CellValue } | null;
  /** 0 보다 크고 바뀔 때마다 이름 칸으로 초점을 옮긴다(묶음 띠의 ＋). */
  focusRequest?: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Issue 857 — 저장 중에 Enter 를 또 누르면 같은 행이 두 번 생겼다. 폼 상태는 폼 안에서만 읽히므로
  //   안쪽 부품이 여기에 적어 두고, 제출 처리기가 읽는다.
  const pendingRef = useRef(false);
  const id = useId();
  const errorId = `mw-additem-error-${id}`;
  const hintId = `mw-additem-hint-${id}`;

  useEffect(() => {
    if (focusRequest <= 0) return;
    inputRef.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    inputRef.current?.focus();
  }, [focusRequest]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (pendingRef.current) {
      event.preventDefault();
      return;
    }
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
      {prefill ? (
        <>
          <input type="hidden" name="prefillKey" value={prefill.columnKey} />
          <input type="hidden" name="prefillValue" value={JSON.stringify(prefill.value)} />
        </>
      ) : null}
      <AddItemFields
        error={error}
        errorId={errorId}
        hintId={hintId}
        inputRef={inputRef}
        pendingRef={pendingRef}
        inputClassName={inputClassName}
        onEdit={() => error && setError(null)}
      />
    </form>
  );
}

function AddItemFields({
  error,
  errorId,
  hintId,
  inputRef,
  pendingRef,
  inputClassName,
  onEdit,
}: {
  error: string | null;
  errorId: string;
  hintId: string;
  inputRef: RefObject<HTMLInputElement | null>;
  pendingRef: MutableRefObject<boolean>;
  inputClassName?: string;
  onEdit: () => void;
}) {
  const { pending } = useFormStatus();
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending, pendingRef]);
  return (
    <>
      <div className="flex items-center gap-1">
        <span aria-hidden="true" className="text-xs text-mw-sub">＋</span>
        <input
          ref={inputRef}
          name="title"
          aria-required="true"
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? errorId : hintId}
          aria-label="새 항목 이름 (필수)"
          aria-busy={pending || undefined}
          placeholder="새 항목"
          onChange={onEdit}
          className={inputClassName}
          style={error ? { borderColor: "var(--mw-error)" } : undefined}
        />
      </div>
      <p id={hintId} role={pending ? "status" : undefined} className="max-w-64 text-[0.65rem] text-mw-sub">
        {pending ? "추가하는 중…" : "이름만 입력하면 등록돼요. 나머지는 나중에 채울 수 있어요."}
      </p>
      {error ? <p id={errorId} role="alert" className="max-w-64 text-[0.65rem] text-mw-error">{error}</p> : null}
    </>
  );
}
