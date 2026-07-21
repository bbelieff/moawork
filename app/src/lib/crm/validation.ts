/**
 * 입력 검증 (T02 core.crm). 의존성 없는 경량 검증기.
 * API 라우트에서 요청 바디를 repo 입력 타입으로 좁힌다.
 * 대상: companies · deals · activities · 단계이동. (수식/뷰/커스텀필드는 타 트랙)
 */

import type { CompanyPatch, DealPatch, NewCompany, NewDeal } from "@/lib/repo";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function reqString(v: unknown, field: string, max = 500): string {
  if (typeof v !== "string") throw new ValidationError(`${field}: 문자열이어야 합니다`);
  const t = v.trim();
  if (t === "") throw new ValidationError(`${field}: 비어 있을 수 없습니다`);
  if (t.length > max) throw new ValidationError(`${field}: ${max}자를 초과했습니다`);
  return t;
}

/** null 허용 문자열(빈 문자열 → null). */
function optString(v: unknown, field: string, max = 1000): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") throw new ValidationError(`${field}: 문자열이어야 합니다`);
  if (v.length > max) throw new ValidationError(`${field}: ${max}자를 초과했습니다`);
  return v;
}

function optNumber(v: unknown, field: string): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new ValidationError(`${field}: 숫자여야 합니다`);
  return n;
}

/** YYYY-MM-DD 검증(느슨). null 허용. */
function optDate(v: unknown, field: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v))
    throw new ValidationError(`${field}: YYYY-MM-DD 형식이어야 합니다`);
  return v;
}

function optId(v: unknown, field: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") throw new ValidationError(`${field}: id 문자열이어야 합니다`);
  return v;
}

// ── companies ─────────────────────────────────────────

function companyFields(b: Record<string, unknown>): Omit<NewCompany, "name"> {
  return {
    biz_type: optString(b.biz_type, "biz_type", 100),
    region: optString(b.region, "region", 100),
    owner_name: optString(b.owner_name, "owner_name", 100),
    phone: optString(b.phone, "phone", 50),
    email: optString(b.email, "email", 200),
    revenue: optNumber(b.revenue, "revenue"),
    founded_on: optDate(b.founded_on, "founded_on"),
    homepage: optString(b.homepage, "homepage", 500),
    assigned_to: optId(b.assigned_to, "assigned_to"),
  };
}

export function parseCreateCompany(body: unknown): NewCompany {
  if (!isObject(body)) throw new ValidationError("본문이 객체가 아닙니다");
  return { name: reqString(body.name, "name", 200), ...companyFields(body) };
}

export function parseUpdateCompany(body: unknown): CompanyPatch {
  if (!isObject(body)) throw new ValidationError("본문이 객체가 아닙니다");
  const patch: CompanyPatch = {};
  if (body.name !== undefined) patch.name = reqString(body.name, "name", 200);
  for (const k of [
    "biz_type", "region", "owner_name", "phone", "email", "homepage",
  ] as const) {
    if (body[k] !== undefined) patch[k] = optString(body[k], k);
  }
  if (body.revenue !== undefined) patch.revenue = optNumber(body.revenue, "revenue");
  if (body.founded_on !== undefined) patch.founded_on = optDate(body.founded_on, "founded_on");
  if (body.assigned_to !== undefined) patch.assigned_to = optId(body.assigned_to, "assigned_to");
  if (Object.keys(patch).length === 0) throw new ValidationError("변경할 필드가 없습니다");
  return patch;
}

// ── deals ─────────────────────────────────────────────

function dealFields(b: Record<string, unknown>): Omit<NewDeal, "title"> {
  const out: Omit<NewDeal, "title"> = {
    company_id: optId(b.company_id, "company_id"),
    pipeline_id: optId(b.pipeline_id, "pipeline_id"),
    stage_id: optId(b.stage_id, "stage_id"),
    assigned_to: optId(b.assigned_to, "assigned_to"),
    amount: optNumber(b.amount, "amount"),
    status_note: optString(b.status_note, "status_note", 1000),
    applied_on: optDate(b.applied_on, "applied_on"),
  };
  if (b.custom !== undefined) {
    if (!isObject(b.custom)) throw new ValidationError("custom: 객체여야 합니다");
    out.custom = b.custom;
  }
  return out;
}

export function parseCreateDeal(body: unknown): NewDeal {
  if (!isObject(body)) throw new ValidationError("본문이 객체가 아닙니다");
  return { title: reqString(body.title, "title", 300), ...dealFields(body) };
}

export function parseUpdateDeal(body: unknown): DealPatch {
  if (!isObject(body)) throw new ValidationError("본문이 객체가 아닙니다");
  const patch: DealPatch = {};
  if (body.title !== undefined) patch.title = reqString(body.title, "title", 300);
  if (body.company_id !== undefined) patch.company_id = optId(body.company_id, "company_id");
  if (body.pipeline_id !== undefined) patch.pipeline_id = optId(body.pipeline_id, "pipeline_id");
  if (body.stage_id !== undefined) patch.stage_id = optId(body.stage_id, "stage_id");
  if (body.assigned_to !== undefined) patch.assigned_to = optId(body.assigned_to, "assigned_to");
  if (body.amount !== undefined) patch.amount = optNumber(body.amount, "amount");
  if (body.status_note !== undefined) patch.status_note = optString(body.status_note, "status_note", 1000);
  if (body.applied_on !== undefined) patch.applied_on = optDate(body.applied_on, "applied_on");
  if (body.custom !== undefined) {
    if (!isObject(body.custom)) throw new ValidationError("custom: 객체여야 합니다");
    patch.custom = body.custom;
  }
  if (Object.keys(patch).length === 0) throw new ValidationError("변경할 필드가 없습니다");
  return patch;
}

// ── move / activities ─────────────────────────────────

export function parseMoveStage(body: unknown): { stageId: string } {
  if (!isObject(body)) throw new ValidationError("본문이 객체가 아닙니다");
  const stageId = optId(body.stageId ?? body.stage_id, "stageId");
  if (!stageId) throw new ValidationError("stageId: 필수입니다");
  return { stageId };
}

const ACTIVITY_TYPE_SET = new Set(["call", "meeting", "memo", "status"]);

export function parseCreateActivity(body: unknown): { type: string; content: string | null } {
  if (!isObject(body)) throw new ValidationError("본문이 객체가 아닙니다");
  const type = reqString(body.type, "type", 30);
  if (!ACTIVITY_TYPE_SET.has(type))
    throw new ValidationError("type: call|meeting|memo|status 중 하나여야 합니다");
  return { type, content: optString(body.content, "content", 5000) };
}
