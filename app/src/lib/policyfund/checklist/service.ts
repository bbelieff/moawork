/**
 * 서류 체크리스트 서비스 (BBE-110) — engine(순수 계산) + store(저장) 결합.
 *
 * `getDealChecklist` 는 절대 null/throw 를 돌려주지 않는다 — 저장된 적 없는 딜은
 * 빈 상태({productId:null, items:[]})로 수렴시킨다. 그래야 상세 패널이 "아직 아무것도
 * 없음"을 별도 분기 없이 그릴 수 있고, 완료율도 completionOf([]) = 0/0 으로 자연스럽게 나온다.
 */

import {
  addItem,
  applyPreset,
  completionOf,
  removeItem,
  toPresetItems,
  toggleItem,
} from "./engine";
import { getDealChecklist as loadDeal, getPreset, savePreset, saveDealChecklist } from "./store";
import type { ChecklistCompletion, DealChecklistState, ProductChecklistPreset } from "./types";

export class NoProductSelectedError extends Error {
  constructor() {
    super("먼저 진행 상품을 선택해야 프리셋으로 저장할 수 있습니다");
  }
}

export class ChecklistService {
  constructor(private readonly orgId: string) {}

  getPresetForProduct(productId: string): ProductChecklistPreset | null {
    return getPreset(this.orgId, productId);
  }

  getDealChecklist(dealId: string): DealChecklistState {
    return loadDeal(this.orgId, dealId) ?? { dealId, productId: null, items: [] };
  }

  /** 완료율의 유일한 진입점 — 표의 셀·상세 패널 모두 이 메서드(→ engine.completionOf)만 부른다. */
  completion(dealId: string): ChecklistCompletion {
    return completionOf(this.getDealChecklist(dealId).items);
  }

  /**
   * 상품 선택 → 그 상품의 프리셋이 있으면 적용(항목 통째 교체), 없으면 productId 만
   * 기록하고 항목은 비운다("사용자가 직접 추가할 수 있다" — 수용 기준 1의 뒷부분).
   */
  applyProduct(dealId: string, productId: string): DealChecklistState {
    const preset = getPreset(this.orgId, productId);
    const next: DealChecklistState = {
      dealId,
      productId,
      items: applyPreset(preset?.items ?? null),
    };
    saveDealChecklist(this.orgId, next);
    return next;
  }

  toggleItem(dealId: string, itemId: string): DealChecklistState {
    const cur = this.getDealChecklist(dealId);
    const next: DealChecklistState = { ...cur, items: toggleItem(cur.items, itemId) };
    saveDealChecklist(this.orgId, next);
    return next;
  }

  addItem(dealId: string, label: string): DealChecklistState {
    const cur = this.getDealChecklist(dealId);
    const next: DealChecklistState = { ...cur, items: addItem(cur.items, label) };
    saveDealChecklist(this.orgId, next);
    return next;
  }

  removeItem(dealId: string, itemId: string): DealChecklistState {
    const cur = this.getDealChecklist(dealId);
    const next: DealChecklistState = { ...cur, items: removeItem(cur.items, itemId) };
    saveDealChecklist(this.orgId, next);
    return next;
  }

  /**
   * 현재 딜의 체크리스트를 그 상품의 회사 공용 기본값으로 저장(덮어씀) — 수용 기준 3.
   * 상품이 선택돼 있지 않으면 "무엇의 프리셋인지" 알 수 없으므로 거부한다(조용한 실패 금지).
   */
  saveAsPreset(dealId: string): ProductChecklistPreset {
    const cur = this.getDealChecklist(dealId);
    if (!cur.productId) throw new NoProductSelectedError();
    const preset: ProductChecklistPreset = {
      productId: cur.productId,
      items: toPresetItems(cur.items),
      updatedAt: new Date().toISOString(),
    };
    savePreset(this.orgId, preset);
    return preset;
  }

  /** 관리자 화면 — 프리셋을 딜과 무관하게 직접 편집·저장(수용 기준 "관리자에서 고칠 수 있다"). */
  setPreset(productId: string, items: { label: string }[]): ProductChecklistPreset {
    const preset: ProductChecklistPreset = {
      productId,
      items: items
        .map((it) => it.label.trim())
        .filter((label) => label !== "")
        .map((label, i) => ({ id: `doc-${i + 1}-${label.replace(/\s+/g, "")}`, label, order: i })),
      updatedAt: new Date().toISOString(),
    };
    savePreset(this.orgId, preset);
    return preset;
  }
}

export function getChecklistService(orgId: string): ChecklistService {
  return new ChecklistService(orgId);
}
