"use client";

/**
 * 상품별 기본 체크리스트 관리자 편집기 (BBE-110 수용 기준 "관리자에서 고칠 수 있다").
 *
 * 한 번에 **상품 하나**의 프리셋만 다룬다. "지금 어느 상품을 고르고 있나"는 URL 등
 * 페이지 상태라 이 카드 리스 밖이라 호스트 페이지가 관리하고, 상품이 바뀌면
 * `productId`(+ `key`) 를 바꿔 이 컴포넌트를 다시 마운트해 주면 된다(아래 JSDoc 예시).
 * 그래서 이 컴포넌트는 "지금 편집 중인 목록"만 로컬 draft state 로 들고, 저장 버튼을
 * 누르기 전까지는 서버를 건드리지 않는다 — 여러 항목을 고치는 도중 항목마다 서버 왕복이
 * 일어나면(체크리스트 패널과 달리) 편집 흐름이 끊긴다.
 *
 * @example
 * ```tsx
 * // 호스트 서버 컴포넌트
 * const preset = getChecklistService(ctx.org.id).getPresetForProduct(productId);
 * <ProductChecklistAdmin
 *   key={productId}
 *   productId={productId}
 *   productLabel={product.label}
 *   initialItems={preset?.items.map(i => i.label) ?? []}
 * />
 * ```
 */

import { useState } from "react";
import { setProductPresetAction } from "@/lib/policyfund/checklist/actions";

export interface ProductChecklistAdminProps {
  productId: string;
  productLabel: string;
  /** 이 상품의 현재 프리셋 항목 라벨(순서대로). 프리셋이 없으면 빈 배열. */
  initialItems: string[];
}

export function ProductChecklistAdmin({
  productId,
  productLabel,
  initialItems,
}: ProductChecklistAdminProps) {
  const [items, setItems] = useState(initialItems);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(true);

  const addDraft = () => {
    const label = draft.trim();
    if (label === "") return;
    setItems((prev) => [...prev, label]);
    setDraft("");
    setSaved(false);
  };

  const removeAt = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
    setSaved(false);
  };

  const save = async () => {
    const fd = new FormData();
    fd.set("productId", productId);
    for (const label of items) fd.append("label", label);
    await setProductPresetAction(fd);
    setSaved(true);
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-mw-line bg-mw-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-mw-fg">{productLabel} — 기본 서류</h3>
        <span className="text-xs text-mw-sub">{items.length}종</span>
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-mw-line px-3 py-3 text-xs text-mw-sub">
          이 상품엔 아직 기본 서류가 없습니다. 아래에서 추가하세요.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((label, i) => (
            <li key={`${label}-${i}`} className="group flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-mw-bg">
              <span className="flex-1 text-sm text-mw-fg">{label}</span>
              <button
                type="button"
                onClick={() => removeAt(i)}
                aria-label={`${label} 삭제`}
                className="px-1 text-xs text-mw-sub opacity-0 hover:text-mw-error group-hover:opacity-100"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 border-t border-mw-line pt-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addDraft();
            }
          }}
          placeholder="서류 이름"
          aria-label="서류 이름"
          className="h-8 flex-1 rounded-lg border border-mw-line bg-mw-card px-2 text-xs text-mw-fg outline-none focus:border-mw-record"
        />
        <button
          type="button"
          onClick={addDraft}
          className="h-8 rounded-lg border border-mw-line px-2.5 text-xs text-mw-body hover:bg-mw-bg"
        >
          추가
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saved}
          className="h-8 rounded-lg bg-mw-primary px-2.5 text-xs font-semibold text-mw-on-accent disabled:opacity-40"
        >
          {saved ? "저장됨" : "저장"}
        </button>
      </div>
    </div>
  );
}
