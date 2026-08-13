/**
 * /api/notices — 목록(GET) / 작성(POST).
 * 저장은 003 보드 엔진(공지 보드) 위. 전용 테이블 없음(ADR-0002).
 */

import { requireCtx } from "@/lib/crm/context";
import { getNoticesService } from "@/lib/notices";
import {
  jsonOk,
  parseNewNotice,
  readJson,
  toNoticeErrorResponse,
} from "@/lib/notices/http";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const raw = new URL(req.url).searchParams.get("limit");
    const parsed = raw === null ? undefined : Number(raw);
    const limit =
      parsed === undefined || !Number.isFinite(parsed) ? undefined : Math.trunc(parsed);
    return jsonOk(await getNoticesService().list(ctx, { limit }));
  } catch (err) {
    return toNoticeErrorResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const input = parseNewNotice(await readJson(req));
    return jsonOk(await getNoticesService().create(ctx, input), 201);
  } catch (err) {
    return toNoticeErrorResponse(err);
  }
}
