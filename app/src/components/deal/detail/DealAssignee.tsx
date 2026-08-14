"use client";

/**
 * 담당자 재배정 (BBE-16). 변경 시 서비스가 타임라인에 자동 기록하고
 * (`AsyncCrmService.reassignDeal`), DB 트리거가 새 담당자에게 알림을 보낸다
 * (`064_deal_collab_notify.sql: trg_notify_deal_assigned`).
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
