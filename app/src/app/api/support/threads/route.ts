/**
 * /api/support/threads — 문의 목록(GET) / 문의 작성(POST). T08.
 * 자체 인앱 스레드다(외부 상담 벤더 미사용).
 */

import { requireCtx } from "@/lib/crm/context";
import { getSupportService } from "@/lib/support";
import {
  jsonOk,
  parseNewThread,
  readJson,
  toSupportErrorResponse,
} from "@/lib/support/http";

export async function GET(): Promise<Response> {
  try {
    const ctx = await requireCtx();
    return jsonOk(getSupportService().listThreads(ctx));
  } catch (err) {
    return toSupportErrorResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const input = parseNewThread(await readJson(req));
    return jsonOk(getSupportService().createThread(ctx, input), 201);
  } catch (err) {
    return toSupportErrorResponse(err);
  }
}
