"use client";

/**
 * 서류 체크리스트 — 딜 상세용 패널 (BBE-110).
 *
 * 완료율은 이 컴포넌트가 직접 계산하지 않는다. `@/lib/policyfund/checklist` 의
 * `completionOf(items)` **하나만** 부른다 — `ChecklistCompletionCell`(표의 셀)도 같은 함수를
 * 부르므로, 두 화면이 각자 계산식을 베끼다 갈라지는 사고(2중 구현)가 애초에 나지 않는다.
 *
 * 상태는 `useOptimistic` 이 아니라 **로컬 state**로 든다. 이유: 호스트 페이지(딜 상세)가
 * 아직 없어서(이번 카드 리스 밖) 서버 액션 뒤에 `revalidatePath` 가 불릴지, 이 컴포넌트가
 * 받는 `initialState` prop 이 언제 새로고침될지 이 컴포넌트 입장에서는 알 수 없다.
 * `useOptimistic` 은 base prop 이 안 바뀌면 다음 무관한 리렌더에서 낙관적 값을 잃고
 * 원래(구식) prop 으로 되돌아간다 — 그래서 대신 로컬 state 를 진실로 삼고, 체크·추가·삭제는
 * **서버가 쓰는 것과 같은 순수 함수**(engine.ts)로 그 자리에서 정확히 계산한 뒤, 서버 액션이
 * 돌려주는 값으로 다시 동기화한다(드리프트가 나도 서버가 최종 진실).
 * 상품 선택만은 로컬에 프리셋 항목이 없어 예외 — 서버 응답을 기다린 뒤에만 항목을 바꾼다
 * (없는 값을 지어내 "일단 비웠다가 채워지는" 깜빡임을 만들지 않는다).
 *
 * 딜 상세 페이지(app/(app)/deals/[dealId]) 연결은 이번 카드 리스 밖이다(BBE-47 이 /newcust
 * 연결을 WO-7 로 미룬 것과 같은 패턴) — 이 컴포넌트는 `dealId` + 초기 상태 + 상품 카테고리를
 * props 로 받으면 그 자리에서 바로 동작하는 완결형이고, 호스트 페이지가 정해지면 그 트랙이
 * import 해서 얹으면 된다.
 */

import { useRef, useState } from "react";
import type { OptionCategory } from "@/lib/policyfund";
import {
  addItem,
  applyPreset,
  completionOf,
  removeItem,
  toggleItem,
  type DealChecklistState,
  type ProductChecklistPreset,
} from "@/lib/policyfund/checklist";
import {
  mutateChecklistAction,
  saveChecklistAsPresetAction,
} from "@/lib/policyfund/checklist/actions";
import {
  beginChecklistMutation,
  failChecklistMutation,
  isTerminalChecklistError,
  settleChecklistMutation,
  type ChecklistMutationIntent,
} from "@/lib/policyfund/checklist/mutation-intent";
import { ProductCombobox } from "./ProductCombobox";

export interface ChecklistPanelProps {
  dealId: string;
  /** 서버에서 읽어 내려준 현재 상태. 저장된 적 없으면 {dealId, productId:null, items:[]}. */
  initialState: DealChecklistState;
  /**
   * 상품 선택지. `@/lib/policyfund/checklist`의 `CHECKLIST_PRODUCT_CATEGORY`(v6 목업
   * "진행 상품" 7종, dump-mockup.mjs 실측)를 그대로 넘기면 된다. 없으면 상품 선택 UI를 감춘다.
   */
  productCategory?: OptionCategory;
  productPresets?: ProductChecklistPreset[];
  /**
   * 조달일·재신청 안내일 등 서류 준비 시점 안내(260810 목업 개정 — "체크리스트에서 그 날짜가
   * 보이면 좋다"). 이 컴포넌트는 딜 레코드를 직접 읽지 않으므로(리스 밖) 호스트가 이미 계산해
   * 둔 문구를 그대로 받아 표시만 한다. 예: "재신청 안내일 2027-08-20까지 준비".
   */
  dueDateHint?: string;
  readOnly?: boolean;
  canManagePresets?: boolean;
}

export function ChecklistPanel({
  dealId,
  initialState,
  productCategory,
  productPresets = [],
  dueDateHint,
  readOnly = false,
  canManagePresets = false,
}: ChecklistPanelProps) {
  const [state, setState] = useState(initialState);
  const [mutationPending, setMutationPending] = useState(false);
  const mutationPendingRef = useRef(false);
  const [newLabel, setNewLabel] = useState("");
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [canRetryMutation, setCanRetryMutation] = useState(false);
  const retryIntent = useRef<ChecklistMutationIntent | null>(null);
  const [savingPreset, setSavingPreset] = useState(false);
  const [canRetryPreset, setCanRetryPreset] = useState(false);
  const presetRetrySnapshot = useRef<DealChecklistState | null>(null);

  const completion = completionOf(state.items);
  const mutationBlocked = mutationPending || savingPreset || canRetryMutation || canRetryPreset;
  const barColor = completion.percent === 100 ? "var(--mw-success)" : "var(--mw-record)";

  const fd = (extra: Record<string, string>) => {
    const form = new FormData();
    form.set("dealId", dealId);
    for (const [k, v] of Object.entries(extra)) form.set(k, v);
    return form;
  };

  const persist = async (key: string, next: DealChecklistState) => {
    const prior = retryIntent.current;
    const candidate = {
      key,
      requestId: crypto.randomUUID(),
      expectedVersion: state.version ?? 0,
      previous: state,
      next,
    };
    const intent = beginChecklistMutation(prior, mutationPendingRef.current, candidate);
    if (!intent) return;
    retryIntent.current = intent;
    mutationPendingRef.current = true;
    setMutationPending(true);
    setMutationError(null);
    setCanRetryMutation(false);
    setState(intent.next);
    try {
      const server = await mutateChecklistAction(fd({
        requestId: intent.requestId,
        expectedVersion: String(intent.expectedVersion),
        state: JSON.stringify(intent.next),
      }));
      const settled = settleChecklistMutation(retryIntent.current, intent.requestId);
      retryIntent.current = settled.next;
      if (settled.applies) {
        setState(server);
      }
      setCanRetryMutation(false);
      mutationPendingRef.current = false;
      setMutationPending(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "저장하지 못했습니다.";
      const terminal = isTerminalChecklistError(message);
      const matches = retryIntent.current?.requestId === intent.requestId;
      retryIntent.current = failChecklistMutation(
        retryIntent.current,
        intent.requestId,
        terminal ? "terminal" : "retryable",
      );
      if (terminal && matches) setState(intent.previous);
      setCanRetryMutation(!terminal);
      mutationPendingRef.current = false;
      setMutationPending(false);
      setMutationError(message);
    }
  };

  const selectProduct = (productId: string) => {
    if (!productId || mutationBlocked) return;
    const preset = productPresets.find((candidate) => candidate.productId === productId);
    void persist(`product:${productId}`, { ...state, productId, items: applyPreset(preset?.items ?? null) });
  };

  const toggle = (itemId: string) => {
    if (mutationBlocked) return;
    const next = { ...state, items: toggleItem(state.items, itemId) };
    void persist(`toggle:${itemId}`, next);
  };

  const add = () => {
    if (mutationBlocked) return;
    const label = newLabel;
    setNewLabel("");
    if (label.trim() === "") return;
    const next = { ...state, items: addItem(state.items, label) };
    void persist(`add:${crypto.randomUUID()}`, next);
  };

  const remove = (itemId: string) => {
    if (mutationBlocked) return;
    const next = { ...state, items: removeItem(state.items, itemId) };
    void persist(`remove:${itemId}`, next);
  };

  const saveAsPreset = async () => {
    if (mutationPendingRef.current || mutationPending || canRetryMutation) return;
    const snapshot = presetRetrySnapshot.current ?? structuredClone(state);
    mutationPendingRef.current = true;
    setSavingPreset(true);
    setMutationError(null);
    setCanRetryPreset(false);
    try {
      await saveChecklistAsPresetAction(fd({ state: JSON.stringify(snapshot) }));
      presetRetrySnapshot.current = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "프리셋을 저장하지 못했습니다.";
      const terminal = isTerminalChecklistError(message);
      presetRetrySnapshot.current = terminal ? null : snapshot;
      setCanRetryPreset(!terminal);
      setMutationError(message);
    } finally {
      mutationPendingRef.current = false;
      setSavingPreset(false);
    }
  };

  return (
    <div aria-busy={mutationPending || savingPreset} className="flex flex-col gap-3 rounded-xl border border-mw-line bg-mw-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-mw-fg">서류 체크리스트</h3>
        <span className="text-xs text-mw-sub" data-testid="checklist-completion">
          {completion.checked}/{completion.total} · {completion.percent}%
        </span>
      </div>

      {dueDateHint && (
        <p className="rounded-lg bg-mw-tint-blue px-2.5 py-1.5 text-xs text-mw-record">
          {dueDateHint}
        </p>
      )}

      {/* 완료율 막대 — 표의 셀(ChecklistCompletionCell)과 같은 completion 값을 그린다. */}
      <div
        role="progressbar"
        aria-valuenow={completion.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 overflow-hidden rounded-full bg-mw-bg"
      >
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${completion.percent}%`, backgroundColor: barColor }}
        />
      </div>

      {mutationError && (
        <div role="alert" className="flex items-center justify-between gap-2 text-xs text-mw-error">
          <span>{mutationError}</span>
          {canRetryMutation && <button type="button" onClick={() => {
            const intent = retryIntent.current;
            if (!intent) return;
            void persist(intent.key, intent.next);
          }} className="rounded border border-current px-2 py-1">같은 요청 다시 시도</button>}
          {canRetryPreset && <button type="button" onClick={() => void saveAsPreset()} className="rounded border border-current px-2 py-1">같은 프리셋 다시 시도</button>}
        </div>
      )}

      {productCategory && !readOnly && (
        <div className={`flex items-end gap-2 ${mutationBlocked ? "opacity-60" : ""}`}>
          <div className="flex-1">
            <ProductCombobox
              labels={productCategory.options.map((option) => option.label)}
              value={state.productId ?? undefined}
              onSelect={selectProduct}
              disabled={mutationBlocked}
            />
          </div>
          {mutationPending && <span className="pb-2 text-xs text-mw-sub">저장 중…</span>}
        </div>
      )}

      {state.items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-mw-line px-3 py-3 text-xs text-mw-sub">
          {productCategory
            ? "상품을 고르면 기본 서류가 채워집니다. 직접 추가할 수도 있습니다."
            : "아직 항목이 없습니다."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {state.items.map((item) => (
            <li key={item.id} className="group flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-mw-bg">
              <input
                type="checkbox"
                checked={item.checked}
                disabled={readOnly || mutationBlocked}
                onChange={() => toggle(item.id)}
                className="h-4 w-4"
                aria-label={item.label}
              />
              <span
                className={`flex-1 text-sm ${item.checked ? "text-mw-sub line-through" : "text-mw-fg"}`}
              >
                {item.label}
              </span>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => remove(item.id)}
                  disabled={mutationBlocked}
                  aria-label={`${item.label} 삭제`}
                  className="px-1 text-xs text-mw-sub opacity-0 hover:text-mw-error group-hover:opacity-100"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <div className="flex items-center gap-2 border-t border-mw-line pt-2">
          <input
            value={newLabel}
            disabled={mutationBlocked}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="서류 추가"
            aria-label="서류 이름"
            className="h-8 flex-1 rounded-lg border border-mw-line bg-mw-card px-2 text-xs text-mw-fg outline-none focus:border-mw-record"
          />
          <button
            type="button"
            onClick={add}
            disabled={mutationBlocked}
            className="h-8 rounded-lg border border-mw-line px-2.5 text-xs text-mw-body hover:bg-mw-bg"
          >
            추가
          </button>

          {canManagePresets && state.productId && state.items.length > 0 && (
            <button
              type="button"
              onClick={() => void saveAsPreset()}
              disabled={mutationBlocked}
              title="이 딜의 체크리스트를 이 상품의 회사 공용 기본값으로 저장합니다"
              className="h-8 rounded-lg bg-mw-primary px-2.5 text-xs font-semibold text-mw-on-accent disabled:opacity-40"
            >
              {savingPreset ? "저장 중…" : "프리셋으로 저장"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
