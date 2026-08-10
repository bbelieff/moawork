/**
 * /api/deals/[dealId]/files/[fileId] — 첨부 다운로드(서명 URL 전용). (BBE-16)
 *
 * 이중 검증:
 *  1) 서명·만료 토큰(`?token=`) — 위조·재사용(만료 후) 방지.
 *  2) 세션 org/scope(`getCrmService().getDeal`) — 토큰이 유효해도 그 사용자가
 *     이 딜을 볼 수 없으면(다른 조직/담당범위 밖) 404 로 수렴(존재 유출 방지).
 */

import { requireCtx } from "@/lib/crm/context";
import { toErrorResponse } from "@/lib/crm/http";
import { getCrmService } from "@/lib/crm";
import { verifyFileToken } from "@/lib/deal/fileSignedUrl";
import { readDealFileBytes } from "@/lib/deal/files";

type RouteCtx = { params: Promise<{ dealId: string; fileId: string }> };

export async function GET(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const { dealId, fileId } = await params;
    const token = new URL(req.url).searchParams.get("token");
    if (!token) return Response.json({ error: "토큰이 없습니다" }, { status: 401 });

    const verified = verifyFileToken(token);
    if (!verified || verified.dealId !== dealId || verified.fileId !== fileId) {
      return Response.json({ error: "유효하지 않거나 만료된 링크입니다" }, { status: 403 });
    }

    const ctx = await requireCtx();
    // 존재/가시성 확인 겸 조직 경계 재검증(토큰 검증과 별개의 방어선).
    await getCrmService().getDeal(ctx, dealId);

    const found = await readDealFileBytes(ctx, dealId, fileId);
    if (!found) return Response.json({ error: "파일을 찾을 수 없습니다" }, { status: 404 });

    return new Response(new Uint8Array(found.buffer), {
      status: 200,
      headers: {
        "Content-Type": found.meta.mime_type,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(found.meta.name)}"`,
        "Content-Length": String(found.buffer.byteLength),
        "Cache-Control": "private, max-age=0, no-store",
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
