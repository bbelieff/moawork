/**
 * /api/entities/[entityId]/values — 커스텀필드 값 조회(GET) / 설정(PUT).
 * entityId = company.id | deal.id. PUT 은 ?entity= 로 대상 엔티티 종류를 받는다
 * (필드 정의 조회에 필요). 값은 각 필드 타입 스펙으로 정규화·검증된다.
 */

import {
  getCustomService,
  requireCtx,
  parseValuesPatch,
  ValidationError,
  jsonOk,
  toErrorResponse,
  readJson,
} from "@/lib/custom";
import { FIELD_ENTITIES, type FieldEntity } from "@/lib/types";

type RouteCtx = { params: Promise<{ entityId: string }> };

function requireEntity(req: Request): FieldEntity {
  const raw = new URL(req.url).searchParams.get("entity");
  if (!raw || !(FIELD_ENTITIES as readonly string[]).includes(raw))
    throw new ValidationError(`entity: ${FIELD_ENTITIES.join("|")} 중 하나여야 합니다`);
  return raw as FieldEntity;
}

export async function GET(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { entityId } = await params;
    return jsonOk(await getCustomService().getValues(ctx.org.id, entityId));
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const { entityId } = await params;
    const entity = requireEntity(req);
    const patch = parseValuesPatch(await readJson(req));
    return jsonOk(await getCustomService().setValues(ctx.org.id, entity, entityId, patch));
  } catch (err) {
    return toErrorResponse(err);
  }
}
