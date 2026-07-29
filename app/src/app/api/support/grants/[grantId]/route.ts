/**
 * /api/support/grants/[grantId] — 감사 이벤트 조회(GET) / 강제 종료(DELETE) /
 * 수임자 행위 기록(POST). T08.
 *
 * 종료: 오너·관리자는 어떤 위임이든, 멤버는 자기 위임만.
 * 기록: 홈택스 테이블 대상은 거부한다(위임 범위에서 항상 제외).
 */

import { requireCtx } from "@/lib/crm/context";
import { getSupportService } from "@/lib/support";
import {
  jsonOk,
  parseEventAction,
  parseEventTarget,
  readJson,
  toSupportErrorResponse,
} from "@/lib/support/http";

type RouteCtx = { params: Promise<{ grantId: string }> };

export async function GET(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { grantId } = await params;
    return jsonOk(getSupportService().listEvents(ctx, grantId));
  } catch (err) {
    return toSupportErrorResponse(err);
  }
}

export async function POST(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { grantId } = await params;
    const raw = await readJson(req);
    const action = parseEventAction(raw);
    const target = parseEventTarget(raw);
    return jsonOk(getSupportService().logEvent(ctx, grantId, action, target), 201);
  } catch (err) {
    return toSupportErrorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { grantId } = await params;
    return jsonOk(getSupportService().revokeGrant(ctx, grantId));
  } catch (err) {
    return toSupportErrorResponse(err);
  }
}
