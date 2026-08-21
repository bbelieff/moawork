"use client";

import { useId, useState } from "react";

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ko").replace(/[^\p{L}\p{N}]/gu, "");
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

export function matchProductLabel(input: string, labels: readonly string[]): string {
  const value = input.trim();
  const key = normalized(value);
  if (!key) return "";
  const exact = labels.find((label) => normalized(label) === key);
  if (exact) return exact;
  const contained = labels.find((label) => normalized(label).includes(key) || key.includes(normalized(label)));
  if (contained) return contained;
  const ranked = labels.map((label) => ({ label, score: distance(key, normalized(label)) })).sort((a, b) => a.score - b.score);
  return ranked[0] && ranked[0].score <= Math.max(2, Math.floor(key.length / 4)) ? ranked[0].label : value;
}

export function ProductCombobox({ labels, value, disabled, onSelect }: { labels: readonly string[]; value?: string; disabled?: boolean; onSelect: (value: string) => void }) {
  const listId = useId();
  const [draft, setDraft] = useState(value ?? "");
  const matched = matchProductLabel(draft, labels);
  const isNew = Boolean(matched) && !labels.includes(matched);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`${listId}-input`} className="text-sm font-medium">진행 상품 <span className="text-xs font-normal text-mw-sub">{labels.length}개</span></label>
      <div className="flex gap-2">
        <input id={`${listId}-input`} list={listId} value={draft} disabled={disabled} onChange={(event) => setDraft(event.target.value)} placeholder="선택하거나 직접 입력" className="h-9 min-w-0 flex-1 rounded-md border border-mw-line bg-mw-card px-2 text-sm" />
        <datalist id={listId}>{labels.map((label) => <option key={label} value={label} />)}</datalist>
        <button type="button" disabled={disabled || !matched} onClick={() => { setDraft(matched); onSelect(matched); }} className="h-9 rounded-md bg-mw-primary px-3 text-sm font-semibold text-white disabled:opacity-40">{isNew ? "새 상품 추가" : "적용"}</button>
      </div>
      {draft.trim() && matched !== draft.trim() ? <p className="text-xs text-mw-sub">“{matched}”으로 매칭됩니다.</p> : null}
    </div>
  );
}
