import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ctx } from "@/lib/types";
import type { MemberRole } from "@/lib/auth/roles";
import { seatKeyToId, type SeatKey } from "./seats";

/**
 * 「자리」의 역할 정의서를 읽는다 (#683 · D안 1단계).
 *
 * ★ «정의서 0건» 과 «못 읽음» 을 다른 값으로 돌려준다.
 *   빈 Map 을 실패에도 돌려주면 화면이 「아직 아무도 안 썼습니다」라고 «단언» 한다.
 *   그건 사실이 아닐 수 있다 — 못 읽었으면 null 이고, 화면이 그렇게 말한다.
 *   (reporting-exceptions.ts 와 같은 규약)
 */

export type SeatDuty = Readonly<{ cycle: "daily" | "weekly" | "monthly"; text: string }>;

export type SeatDefinition = Readonly<{
  departmentId: string | null;
  role: MemberRole;
  summary: string | null;
  duties: readonly SeatDuty[];
  /** 판단 기준 — 올린다 · 직접 한다 · 손대지 않는다. */
  escalate: readonly string[];
  handle: readonly string[];
  avoid: readonly string[];
  signals: string | null;
  handover: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
}>;

const CYCLES = new Set(["daily", "weekly", "monthly"]);

/*
 * ★ 크기 상한 — summary·handover 에는 DB CHECK 가 있는데 이 둘(jsonb)에만 없었다.
 *   타입만 보고 크기를 안 보면, 거대한 배열이 들어왔을 때 화면이 그것을 «그대로 다» 그린다.
 *   그래서 화면이 믿는 쪽(여기)에서 자른다 — 화면이 감당할 수 있는 만큼만 넘긴다 (#683 검수 P2-6).
 */
const MAX_DUTIES = 50;
const MAX_RULES_PER_KIND = 30;
const MAX_LINE = 300;

/** 사람이 적은 것을 화면이 믿을 수 있는 모양으로 줄인다. 모르는 것은 버린다. */
export function parseSeatDuties(value: unknown): SeatDuty[] {
  if (!Array.isArray(value)) return [];
  const out: SeatDuty[] = [];
  for (const raw of value) {
    if (out.length >= MAX_DUTIES) break;
    if (!raw || typeof raw !== "object") continue;
    const row = raw as { cycle?: unknown; text?: unknown };
    const text = typeof row.text === "string" ? row.text.trim().slice(0, MAX_LINE) : "";
    if (!text) continue;
    const cycle = typeof row.cycle === "string" && CYCLES.has(row.cycle) ? row.cycle : "daily";
    out.push({ cycle: cycle as SeatDuty["cycle"], text });
  }
  return out;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim().slice(0, MAX_LINE) : ""))
    .filter((entry) => entry.length > 0)
    .slice(0, MAX_RULES_PER_KIND);
}

export function parseSeatRules(value: unknown): { escalate: string[]; handle: string[]; avoid: string[] } {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    escalate: stringList(row.escalate),
    handle: stringList(row.handle),
    avoid: stringList(row.avoid),
  };
}

/**
 * 「2026. 9. 1.」처럼 적는다.
 *
 * ★ `toLocaleDateString` 을 안 쓴다. 클라이언트 컴포넌트에서 쓰면 서버(UTC)와 브라우저(로컬)의
 *   시간대가 달라 **첫 그림과 두 번째 그림의 날짜가 다르게** 나온다 — 하이드레이션 불일치다.
 *   한국 시간 15시 이후에 저장한 것은 하루 어긋났다가 화면에서 슬쩍 바뀐다 (#683 검수 P3-7).
 *   보는 사람의 시간대와 무관하게 «같은 글자» 가 나와야 하므로 UTC 로 못 박아 쪼갠다.
 */
export function seatDefinitionDate(value: string | null | undefined): string {
  if (!value) return "";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  return `${at.getUTCFullYear()}. ${at.getUTCMonth() + 1}. ${at.getUTCDate()}.`;
}

/** 정의서가 «비어 있는가». 비면 화면이 「아직 아무도 안 썼습니다」라고 말한다. */
export function seatDefinitionIsEmpty(definition: SeatDefinition | null | undefined): boolean {
  if (!definition) return true;
  return (
    !definition.summary
    && definition.duties.length === 0
    && definition.escalate.length === 0
    && definition.handle.length === 0
    && definition.avoid.length === 0
    && !definition.signals
    && !definition.handover
  );
}

type Row = {
  department_id: string | null;
  role: MemberRole;
  summary: string | null;
  duties: unknown;
  rules: unknown;
  signals: string | null;
  handover: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

export function toSeatDefinition(row: Row, nameOf?: (userId: string) => string | null): SeatDefinition {
  const rules = parseSeatRules(row.rules);
  return {
    departmentId: row.department_id,
    role: row.role,
    summary: row.summary,
    duties: parseSeatDuties(row.duties),
    escalate: rules.escalate,
    handle: rules.handle,
    avoid: rules.avoid,
    signals: row.signals,
    handover: row.handover,
    updatedAt: row.updated_at,
    updatedByName: row.updated_by ? (nameOf?.(row.updated_by) ?? null) : null,
  };
}

/** 자리 열쇠 → 정의서. null 이면 «못 읽음» 이고 빈 Map 은 «아직 없음» 이다. */
export async function loadSeatDefinitions(
  ctx: Ctx,
  clientFactory: () => Promise<SupabaseClient>,
  nameOf?: (userId: string) => string | null,
): Promise<Map<string, SeatDefinition> | null> {
  try {
    const client = await clientFactory();
    const { data, error } = await client
      .from("seat_definitions")
      .select("department_id,role,summary,duties,rules,signals,handover,updated_at,updated_by")
      .eq("org_id", ctx.org.id);
    if (error) return null;

    const out = new Map<string, SeatDefinition>();
    for (const row of (data ?? []) as Row[]) {
      const key: SeatKey = { departmentId: row.department_id, role: row.role };
      out.set(seatKeyToId(key), toSeatDefinition(row, nameOf));
    }
    return out;
  } catch {
    return null;
  }
}
