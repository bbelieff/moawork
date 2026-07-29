/**
 * /api/support/grants — 위임 목록·활성 위임(GET) / 위임 개시(POST). T08.
 *
 * 개시는 **오너 승인 없이 즉시 발효**한다(belie 확정). 대신 서비스가
 * 멤버 읽기전용 고정 · 활성 1건 · 오너 알림 · 감사로그를 강제한다.
 */

import { requireCtx } from "@/lib/crm/context";
import { getSupportService } from "@/lib/support";
import {
  jsonOk,
  parseNewGrant,
  readJson,
  toSupportErrorResponse,
} from "@/lib/support/http";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const service = getSupportService();

    // 운영자 콘솔은 ?org= 로 대상 조직의 위임 상태만 확인한다(조회 전용).
    const orgId = new URL(req.url).searchParams.get("org");
    if (orgId !== null && orgId !== ctx.org.id) {
      return jsonOk({ active: service.activeGrantForOrg(ctx, orgId), history: [] });
    }

    return jsonOk({
      active: service.activeGrant(ctx),
      history: service.listGrants(ctx),
    });
  } catch (err) {
    return toSupportErrorResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const input = parseNewGrant(await readJson(req));
    return jsonOk(getSupportService().createGrant(ctx, input), 201);
  } catch (err) {
    return toSupportErrorResponse(err);
  }
}
