"use client";

/**
 * 담당자 재배정 (BBE-16). 서버 함수 `reassign_deal_with_activity`(171)가 타임라인에 한 줄 남기고,
 * 보드 행이 있으면 담당 계보 경로로 바꿔 보드 행 담당과 알림도 함께 처리한다.
 * (064 의 배정 알림 트리거는 운영에 없고 되살리지 않았다 — #881)
 */

import { useState, useTransition } from "react";
import type { OrgMemberOption } from "@/lib/deal/members";
import { reassignDealAction } from "@/app/(app)/deals/[dealId]/actions";

export interface DealAssigneeProps {
  dealId: string;
  currentAssigneeId: string | null;
  members: OrgMemberOption[];
  disabled?: boolean;
}

export function DealAssignee({
  dealId,
  currentAssigneeId,
  members,
  disabled = false,
}: DealAssigneeProps) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(currentAssigneeId ?? "");
  const [error, setError] = useState<string | null>(null);

  function onChange(nextValue: string) {
    const previous = value;
    setValue(nextValue);
    setError(null);
    startTransition(async () => {
      try {
        await reassignDealAction(dealId, nextValue === "" ? null : nextValue);
      } catch (e) {
        setValue(previous);
        setError(e instanceof Error ? e.message : "담당자를 변경하지 못했습니다.");
      }
    });
  }

  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-zinc-500">담당자</span>
      <div className="flex flex-col gap-1">
        <select
          value={value}
          disabled={disabled || pending}
          onChange={(e) => onChange(e.target.value)}
          className="w-full max-w-xs rounded-md border border-zinc-300 px-3 py-1.5 text-sm disabled:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800"
        >
          <option value="">미배정</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name ?? "이름 없음"}
            </option>
          ))}
        </select>
        {error ? (
          <span role="alert" className="text-xs text-red-600">
            {error}
          </span>
        ) : null}
      </div>
    </label>
  );
}
