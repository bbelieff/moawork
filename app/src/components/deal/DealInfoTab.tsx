"use client";

/**
 * 정보 탭 (T02) — 딜 기본정보 편집 + 계약상황(커스텀필드).
 *
 * 계약상황 위젯은 T04 가 만든 `ContractStatusField` 를 그대로 쓴다(중복 저작 없음).
 * 선택지는 하드코딩이 아니라 001 의 `field_defs` 프리셋에서 온다.
 */

import { useTransition } from "react";
import type { Company, Deal, FieldDef, Stage } from "@/lib/types";
import { ContractStatusField } from "./ContractStatusField";
import { setContractStatusAction, updateDealAction } from "@/app/(app)/deals/[dealId]/actions";

export interface DealInfoTabProps {
  deal: Deal;
  company: Company | undefined;
  stage: Stage | undefined;
  /** field_defs 의 '계약상황' 정의. 없으면 위젯이 안내만 표시한다. */
  contractStatusDef: FieldDef | undefined;
  /** 편집 권한 — 담당범위 밖이면 읽기 전용. */
  canEdit: boolean;
}

export function DealInfoTab({
  deal,
  company,
  stage,
  contractStatusDef,
  canEdit,
}: DealInfoTabProps) {
  const [, startTransition] = useTransition();

  const statusKey = contractStatusDef?.key;
  const statusValue = statusKey
    ? ((deal.custom?.[statusKey] as string | null | undefined) ?? null)
    : null;

  return (
    <div className="flex flex-col gap-8">
      <form action={updateDealAction} className="flex flex-col gap-4">
        <input type="hidden" name="dealId" value={deal.id} />

        <Field label="제목">
          <input
            name="title"
            defaultValue={deal.title}
            disabled={!canEdit}
            className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm disabled:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="금액">
            <input
              name="amount"
              inputMode="numeric"
              defaultValue={deal.amount ?? ""}
              disabled={!canEdit}
              className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm tabular-nums disabled:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800"
            />
          </Field>

          <Field label="고객사">
            <p className="py-1.5 text-sm">{company?.name ?? "—"}</p>
          </Field>
        </div>

        <Field label="현재 단계">
          <p className="py-1.5 text-sm">
            {stage?.name ?? "미배정"}
            <span className="ml-2 text-xs text-zinc-400">
              단계 변경은 상단 이동 버튼을 사용하세요
            </span>
          </p>
        </Field>

        <Field label="상태 메모">
          <textarea
            name="status_note"
            rows={3}
            defaultValue={deal.status_note ?? ""}
            disabled={!canEdit}
            className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm disabled:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800"
          />
        </Field>

        {canEdit && (
          <div>
            <button
              type="submit"
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              저장
            </button>
          </div>
        )}
      </form>

      <div className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <ContractStatusField
          fieldDef={contractStatusDef}
          value={statusValue}
          disabled={!canEdit}
          onChange={(next) => {
            if (!statusKey) return;
            startTransition(() => {
              void setContractStatusAction(deal.id, statusKey, next);
            });
          }}
        />
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-zinc-500">{label}</span>
      {children}
    </label>
  );
}
