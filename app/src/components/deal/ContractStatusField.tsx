"use client";

// T04 · core.files — 계약상황 필드(딜 상세).
//
// 기획 v0.2 §3 core.files 완료 기준: "계약상황이 딜에서 표시·변경됨".
// 선택지는 **하드코딩 금지** — 001 의 field_defs('계약상황', type=select) 프리셋(002 seed)에서 온다.
// contracts 테이블은 없다(Phase 2). 값은 deals.custom[field_defs.key] 에 저장된다.
//
// 사용처: T02 의 딜 상세 화면(흐름 C '정보' 탭). 저장은 상위가 onChange 로 처리한다.

import { useState, useTransition } from "react";
import type { FieldDef } from "@/lib/types";

export interface ContractStatusFieldProps {
  /** field_defs 의 '계약상황' 정의(entity='deal', type='select'). 없으면 안내만 표시. */
  fieldDef: FieldDef | undefined;
  /** 현재 값 — 옵션 id 또는 라벨. */
  value: string | null;
  /** 변경 저장 핸들러. 실패 시 throw 하면 에러 메시지를 표시한다. */
  onChange: (next: string | null) => void | Promise<void>;
  disabled?: boolean;
}

export function ContractStatusField({
  fieldDef,
  value,
  onChange,
  disabled = false,
}: ContractStatusFieldProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // 필드 정의가 없으면(프리셋 미로드) 조작 불가 안내.
  if (!fieldDef?.options_jsonb) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs text-zinc-500">계약상황</span>
        <p className="text-sm text-zinc-400">
          — 계약상황 필드가 아직 없습니다{" "}
          <span className="text-zinc-300 dark:text-zinc-600">
            (002 프리셋 로드 후 표시)
          </span>
        </p>
      </div>
    );
  }

  const options = fieldDef.options_jsonb.options
    .filter((o) => !o.archived)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  // 저장된 값이 id 가 아니라 라벨일 수 있어 둘 다 허용(폴백).
  const selected =
    options.find((o) => o.id === value)?.id ??
    options.find((o) => o.label === value)?.id ??
    "";

  function handle(next: string) {
    setError(null);
    startTransition(async () => {
      try {
        await onChange(next === "" ? null : next);
      } catch (e) {
        setError(e instanceof Error ? e.message : "저장하지 못했습니다.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor="contract-status"
        className="text-xs text-zinc-500"
      >
        {fieldDef.label}
      </label>
      <select
        id="contract-status"
        value={selected}
        disabled={disabled || pending}
        onChange={(e) => handle(e.target.value)}
        className="rounded border border-zinc-200 bg-white px-2 py-1.5 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
      >
        <option value="">— 미지정 —</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      {pending ? <span className="text-xs text-zinc-400">저장 중…</span> : null}
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}
