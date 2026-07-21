/**
 * /api/custom-views — 저장뷰 목록(GET, ?entity=, 공유 ∪ 내 개인뷰) / 생성(POST).
 * ?default=1 이면 기본 뷰 1건만(규약: shared 우선 → name ASC → id ASC).
 */

import {
  getCustomService,
  requireCtx,
  parseCreateView,
  jsonOk,
  toErrorResponse,
  readJson,
} from "@/lib/custom";
import { FIELD_ENTITIES, type FieldEntity } from "@/lib/types";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const sp = new URL(req.url).searchParams;
    const raw = sp.get("entity");
    const entity =
      raw && (FIELD_ENTITIES as readonly string[]).includes(raw)
        ? (raw as FieldEntity)
        : undefined;
    const svc = getCustomService();
    if (sp.get("default") === "1") {
      if (!entity) return jsonOk(null);
      return jsonOk(await svc.getDefaultView(ctx.org.id, ctx.user.id, entity));
    }
    return jsonOk(await svc.listViews(ctx.org.id, ctx.user.id, entity));
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const input = parseCreateView(await readJson(req));
    return jsonOk(await getCustomService().createView(ctx.org.id, ctx.user.id, input), 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
