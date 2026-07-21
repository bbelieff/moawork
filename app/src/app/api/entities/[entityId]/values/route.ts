/**
 * /api/entities/[entityId]/values — 커스텀필드 값 조회(GET) / 설정(PUT).
 * entityId = company.id | deal.id. PUT 은 ?entity= 로 대상 엔티티 종류를 받는다
 * (필드 정의 조회에 필요).
 *
 * 값 정책(기획2 판정) = **관대 + 인라인 피드백**: 유효한 값만 저장하고 유효하지 않은
 * 값은 저장하지 않은 채 `errors[key]` 로 사유를 돌려준다(UI 가 그 자리서 표시).
 * 조용한 null 수렴 없음. 단 무결성 필드(실행액·수수료%·수수료입금일)는 하드 거부(400).
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
    // { ok, values, errors } — errors 가 있어도 200(인라인 피드백용), ok 로 판별한다.
    return jsonOk(await getCustomService().applyValues(ctx.org.id, entity, entityId, patch));
  } catch (err) {
    return toErrorResponse(err);
  }
}
