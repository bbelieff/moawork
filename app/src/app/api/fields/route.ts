/**
 * /api/fields — 커스텀필드 정의 목록(GET, ?entity=company|deal) / 생성(POST).
 * key 파생·옵션 id 발급은 서비스가 수행한다(core.custom 엔진).
 */

import {
  createRequestCustomService,
  requireCtx,
  parseCreateFieldDef,
  jsonOk,
  toErrorResponse,
  readJson,
} from "@/lib/custom";
import { FIELD_ENTITIES, type FieldEntity } from "@/lib/types";

function entityParam(req: Request): FieldEntity | undefined {
  const raw = new URL(req.url).searchParams.get("entity");
  return raw && (FIELD_ENTITIES as readonly string[]).includes(raw)
    ? (raw as FieldEntity)
    : undefined;
}

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireCtx();
    return jsonOk(await (await createRequestCustomService()).listFields(ctx.org.id, entityParam(req)));
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const input = parseCreateFieldDef(await readJson(req));
    return jsonOk(await (await createRequestCustomService()).createField(ctx.org.id, input), 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
