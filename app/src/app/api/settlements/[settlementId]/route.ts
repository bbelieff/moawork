/**
 * /api/settlements/[settlementId] — 상세(GET) / 수정(PATCH) / 삭제(DELETE).
 *
 * 파생값(fee_amount·total_revenue·d180·d365)은 읽기 전용이라 PATCH 본문에 오면 400.
 * 미가시(담당범위 밖) 리소스는 존재를 흘리지 않고 404 로 수렴한다.
 */

import { requireCtx, jsonOk, toErrorResponse, readJson, NotFoundError } from "@/lib/crm";
import {
  getSettlementsService,
  parseUpdateSettlement,
} from "@/lib/policyfund/settlements";

type RouteCtx = { params: Promise<{ settlementId: string }> };

export async function GET(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { settlementId } = await params;
    const found = getSettlementsService().get(ctx, settlementId);
    if (!found) throw new NotFoundError("정산을 찾을 수 없습니다");
    return jsonOk(found);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { settlementId } = await params;
    const patch = parseUpdateSettlement(await readJson(req));
    const updated = getSettlementsService().update(ctx, settlementId, patch);
    if (!updated) throw new NotFoundError("정산을 찾을 수 없습니다");
    return jsonOk(updated);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { settlementId } = await params;
    if (!getSettlementsService().remove(ctx, settlementId))
      throw new NotFoundError("정산을 찾을 수 없습니다");
    return jsonOk({ deleted: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
