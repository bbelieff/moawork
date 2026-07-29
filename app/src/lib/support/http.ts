/**
 * 지원/접근위임 API 입력 검증 + 에러 매핑 — T08.
 */

import { UnauthorizedError } from "@/lib/crm/context";
import {
  SupportForbiddenError,
  SupportNotFoundError,
  SupportRuleError,
  sanitizeDiag,
} from "./service";
import {
  ACCESS_EVENT_ACTIONS,
  ACCESS_GRANT_MODES,
  GRANT_DURATIONS,
  resolveDurationMinutes,
  type AccessEventAction,
  type AccessGrantMode,
  type NewAccessGrant,
  type NewSupportThread,
} from "./types";

export class SupportInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupportInputError";
  }
}

export function jsonOk(data: unknown, status = 200): Response {
  return Response.json({ data }, { status });
}

export function toSupportErrorResponse(err: unknown): Response {
  const map = (status: number, message: string) =>
    Response.json({ error: message }, { status });
  if (err instanceof UnauthorizedError) return map(401, err.message);
  if (err instanceof SupportForbiddenError) return map(403, err.message);
  if (err instanceof SupportNotFoundError) return map(404, err.message);
  if (err instanceof SupportInputError) return map(400, err.message);
  if (err instanceof SupportRuleError) return map(400, err.message);
  return map(500, err instanceof Error ? err.message : "알 수 없는 오류");
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new SupportInputError("JSON 본문이 필요합니다");
  }
}

function asRecord(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new SupportInputError("본문은 JSON 객체여야 합니다");
  }
  return raw as Record<string, unknown>;
}

function requiredString(v: unknown, field: string, max = 2000): string {
  if (typeof v !== "string" || v.trim() === "") {
    throw new SupportInputError(`${field}: 필수 입력입니다`);
  }
  if (v.length > max) throw new SupportInputError(`${field}: 너무 깁니다`);
  return v;
}

export function parseNewThread(raw: unknown): NewSupportThread {
  const body = asRecord(raw);
  return {
    subject: requiredString(body.subject, "제목", 200),
    body: requiredString(body.body, "내용", 5000),
    // 화이트리스트 밖 키는 sanitizeDiag 가 버린다(고객사명·연락처·금액 자동첨부 금지).
    diag: sanitizeDiag(body.diag),
  };
}

export function parseReply(raw: unknown): string {
  const body = asRecord(raw);
  return requiredString(body.body, "내용", 5000);
}

const DURATION_IDS = new Set(GRANT_DURATIONS.map((d) => d.id));

/**
 * 위임 생성 입력.
 * `duration` 프리셋 id(30m/2h/today) 또는 `minutes` 를 받는다. 둘 다 없으면 기본 2시간.
 */
export function parseNewGrant(raw: unknown, now: Date = new Date()): NewAccessGrant {
  const body = asRecord(raw);

  let minutes: number;
  if (body.duration !== undefined) {
    if (typeof body.duration !== "string" || !DURATION_IDS.has(body.duration)) {
      throw new SupportInputError("기간: 허용되지 않은 값입니다");
    }
    minutes = resolveDurationMinutes(body.duration, now);
  } else if (body.minutes !== undefined) {
    const parsed = Number(body.minutes);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new SupportInputError("기간: 1분 이상이어야 합니다");
    }
    minutes = Math.trunc(parsed);
  } else {
    minutes = resolveDurationMinutes("2h", now);
  }

  let mode: AccessGrantMode = "read";
  if (body.mode !== undefined) {
    if (
      typeof body.mode !== "string" ||
      !(ACCESS_GRANT_MODES as readonly string[]).includes(body.mode)
    ) {
      throw new SupportInputError("범위: 허용되지 않은 값입니다");
    }
    mode = body.mode as AccessGrantMode;
  }

  let reason: string | null = null;
  if (body.reason !== undefined && body.reason !== null) {
    if (typeof body.reason !== "string") {
      throw new SupportInputError("사유: 문자열이어야 합니다");
    }
    if (body.reason.length > 500) throw new SupportInputError("사유: 너무 깁니다");
    reason = body.reason;
  }

  return { minutes, mode, reason };
}

export function parseEventAction(raw: unknown): AccessEventAction {
  const body = asRecord(raw);
  if (
    typeof body.action !== "string" ||
    !(ACCESS_EVENT_ACTIONS as readonly string[]).includes(body.action)
  ) {
    throw new SupportInputError("action: 허용되지 않은 값입니다");
  }
  return body.action as AccessEventAction;
}

export function parseEventTarget(raw: unknown): { table: string | null; id: string | null } {
  const body = asRecord(raw);
  const table =
    typeof body.target_table === "string" && body.target_table !== ""
      ? body.target_table
      : null;
  const id =
    typeof body.target_id === "string" && body.target_id !== "" ? body.target_id : null;
  return { table, id };
}
