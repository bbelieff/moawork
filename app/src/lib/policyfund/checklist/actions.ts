"use server";

/**
 * 서류 체크리스트 서버 액션 (BBE-110).
 *
 * lib/ 아래 있지만 "use server" 라 클라이언트 번들엔 호출 스텁만 남는다(boards/actions.ts 와
 * 동일 관례). 이 파일을 어느 페이지가 최종적으로 붙일지는 아직 정해지지 않았다(딜 상세
 * 페이지는 이번 카드 리스 밖) — 그래서 `revalidatePath` 를 여기서 부르지 않는다. 호스트 페이지
 * 경로를 모르는 채로 revalidate 하면 엉뚱한 경로를 잘못 대상으로 삼거나, 아무 효과 없는
 * no-op 로 남는 두 실패 모드뿐이다.
 *
 * 대신 **각 액션이 갱신된 `DealChecklistState` 를 그대로 반환한다.** 호스트 페이지의
 * revalidate 여부와 무관하게 호출부(ChecklistPanel)가 반환값으로 자기 state 를 동기화하면
 * 되므로, "서버는 갱신됐는데 화면엔 반영 안 됨" 류 사고가 이 경계에서부터 나지 않는다.
 */

import { getSession } from "@/lib/auth/session";
import { ChecklistService } from "./service";
import { SupabaseChecklistStore } from "./store";
import { createClient } from "@/lib/supabase/server";
import type { DealChecklistState, ProductChecklistPreset } from "./types";

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

async function service(): Promise<ChecklistService> {
  const ctx = await getSession();
  return new ChecklistService(ctx.org.id, new SupabaseChecklistStore(await createClient()));
}

export async function applyProductAction(formData: FormData): Promise<DealChecklistState> {
  const svc = await service();
  return await svc.applyProduct(str(formData, "dealId"), str(formData, "productId"));
}

export async function toggleChecklistItemAction(formData: FormData): Promise<DealChecklistState> {
  const svc = await service();
  return await svc.toggleItem(str(formData, "dealId"), str(formData, "itemId"));
}

export async function addChecklistItemAction(formData: FormData): Promise<DealChecklistState> {
  const svc = await service();
  return await svc.addItem(str(formData, "dealId"), str(formData, "label"));
}

export async function removeChecklistItemAction(formData: FormData): Promise<DealChecklistState> {
  const svc = await service();
  return await svc.removeItem(str(formData, "dealId"), str(formData, "itemId"));
}

export async function saveChecklistAsPresetAction(
  formData: FormData,
): Promise<ProductChecklistPreset> {
  const svc = await service();
  return await svc.saveAsPreset(str(formData, "dealId"));
}

/** 관리자 화면 — 상품 하나의 회사 공용 기본 체크리스트를 통째로 재설정. */
export async function setProductPresetAction(formData: FormData): Promise<void> {
  const svc = await service();
  const productId = str(formData, "productId");
  const labels = formData
    .getAll("label")
    .filter((v): v is string => typeof v === "string");
  await svc.setPreset(
    productId,
    labels.map((label) => ({ label })),
  );
}
