/**
 * /api/notices/[noticeId] — 상세(GET) / 수정(PATCH) / 삭제(DELETE).
 * PATCH 는 전달된 키만 반영한다(미전달 셀 보존).
 */

import { requireCtx } from "@/lib/crm/context";
import { getNoticesService } from "@/lib/notices";
import {
  jsonOk,
  parseNoticePatch,
  readJson,
  toNoticeErrorResponse,
} from "@/lib/notices/http";

type RouteCtx = { params: Promise<{ noticeId: string }> };

export async function GET(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { noticeId } = await params;
    return jsonOk(getNoticesService().get(ctx, noticeId));
  } catch (err) {
    return toNoticeErrorResponse(err);
  }
}

export async function PATCH(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { noticeId } = await params;
    const patch = parseNoticePatch(await readJson(req));
    return jsonOk(getNoticesService().update(ctx, noticeId, patch));
  } catch (err) {
    return toNoticeErrorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { noticeId } = await params;
    getNoticesService().remove(ctx, noticeId);
    return jsonOk({ deleted: true });
  } catch (err) {
    return toNoticeErrorResponse(err);
  }
}
