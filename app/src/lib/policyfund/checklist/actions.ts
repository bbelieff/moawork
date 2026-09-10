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
import { LocalChecklistStore, SupabaseChecklistStore } from "./store";
import { createClient } from "@/lib/supabase/server";
import { loadPermGuard } from "@/lib/perm/guard";
import type { DealChecklistState, ProductChecklistPreset } from "./types";
import { canUseLocalSeedFallback } from "@/lib/supabase/local-fallback";

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

function requestId(fd: FormData): string {
  const value = str(fd, "requestId");
  if (!value) throw new Error("requestId가 필요합니다.");
  return value;
}

function productId(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length < 1 || value.length > 200) {
    throw new Error("case checklist schema invalid");
  }
  return value;
}

export async function mutateChecklistAction(formData: FormData): Promise<DealChecklistState> {
  const dealId = str(formData, "dealId");
  const expectedVersion = Number(str(formData, "expectedVersion"));
  if (!dealId || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    throw new Error("체크리스트 버전을 확인하지 못했습니다.");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(str(formData, "state")); } catch { throw new Error("체크리스트 입력이 올바르지 않습니다."); }
  if (!parsed || typeof parsed !== "object") throw new Error("체크리스트 입력이 올바르지 않습니다.");
  const value = parsed as Partial<DealChecklistState>;
  if (!Array.isArray(value.items)) throw new Error("체크리스트 항목이 올바르지 않습니다.");
  return await (await service()).saveExact({
    caseId: dealId,
    dealId,
    productId: productId(value.productId),
    items: value.items,
    version: expectedVersion,
  }, { requestId: requestId(formData), expectedVersion });
}

async function service(): Promise<ChecklistService> {
  const ctx = await getSession();
  const store = canUseLocalSeedFallback()
    ? new LocalChecklistStore(ctx)
    : new SupabaseChecklistStore(await createClient());
  return new ChecklistService(ctx.org.id, store);
}

export async function applyProductAction(formData: FormData): Promise<DealChecklistState> {
  const svc = await service();
  const expectedVersion = Number(str(formData, "expectedVersion"));
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new Error("체크리스트 버전을 확인하지 못했습니다.");
  return await svc.applyProduct(str(formData, "dealId"), str(formData, "productId"), requestId(formData), expectedVersion);
}

export async function toggleChecklistItemAction(formData: FormData): Promise<DealChecklistState> {
  const svc = await service();
  return await svc.toggleItem(str(formData, "dealId"), str(formData, "itemId"), requestId(formData));
}

export async function addChecklistItemAction(formData: FormData): Promise<DealChecklistState> {
  const svc = await service();
  return await svc.addItem(str(formData, "dealId"), str(formData, "label"), requestId(formData));
}

export async function removeChecklistItemAction(formData: FormData): Promise<DealChecklistState> {
  const svc = await service();
  return await svc.removeItem(str(formData, "dealId"), str(formData, "itemId"), requestId(formData));
}

export async function saveChecklistAsPresetAction(
  formData: FormData,
): Promise<ProductChecklistPreset> {
  const ctx = await getSession();
  const permission = await loadPermGuard(ctx.org.id, "structure.preset_edit");
  if (permission.kind !== "allowed") throw new Error("서류 프리셋을 바꿀 권한이 없어요.");
  const svc = await service();
  const dealId = str(formData, "dealId");
  let parsed: unknown;
  try { parsed = JSON.parse(str(formData, "state")); } catch { throw new Error("체크리스트 프리셋 입력이 올바르지 않습니다."); }
  if (!parsed || typeof parsed !== "object") throw new Error("체크리스트 프리셋 입력이 올바르지 않습니다.");
  const value = parsed as Partial<DealChecklistState>;
  if (!dealId || !Array.isArray(value.items) || !Number.isSafeInteger(value.version)) {
    throw new Error("체크리스트 프리셋 입력이 올바르지 않습니다.");
  }
  return await svc.saveAsPresetExact({
    caseId: dealId,
    dealId,
    productId: productId(value.productId),
    items: value.items,
    version: value.version,
  });
}

/** 관리자 화면 — 상품 하나의 회사 공용 기본 체크리스트를 통째로 재설정. */
export async function setProductPresetAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  const permission = await loadPermGuard(ctx.org.id, "structure.preset_edit");
  if (permission.kind !== "allowed") throw new Error("서류 프리셋을 바꿀 권한이 없어요.");
  const svc = new ChecklistService(ctx.org.id, new SupabaseChecklistStore(await createClient()));
  const productId = str(formData, "productId");
  const labels = formData
    .getAll("label")
    .filter((v): v is string => typeof v === "string");
  await svc.setPreset(
    productId,
    labels.map((label) => ({ label })),
  );
}
