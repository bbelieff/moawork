/**
 * /api/support/threads/[threadId] — 스레드 조회(GET) / 답변·추가문의(POST) / 종료(DELETE). T08.
 */

import { requireCtx } from "@/lib/crm/context";
import { getSupportService } from "@/lib/support";
import {
  jsonOk,
  parseReply,
  readJson,
  toSupportErrorResponse,
} from "@/lib/support/http";

type RouteCtx = { params: Promise<{ threadId: string }> };

export async function GET(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { threadId } = await params;
    return jsonOk(getSupportService().getThread(ctx, threadId));
  } catch (err) {
    return toSupportErrorResponse(err);
  }
}

export async function POST(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { threadId } = await params;
    const body = parseReply(await readJson(req));
    return jsonOk(getSupportService().reply(ctx, threadId, body), 201);
  } catch (err) {
    return toSupportErrorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { threadId } = await params;
    return jsonOk(getSupportService().closeThread(ctx, threadId));
  } catch (err) {
    return toSupportErrorResponse(err);
  }
}
