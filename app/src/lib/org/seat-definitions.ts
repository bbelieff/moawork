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
  /**
   * 누가 썼는가.
   *
   * ★ id 를 «들고 있는다». 이름은 나중에 붙는다 —
   *   정의서는 구성원 요약과 «같은 물결» 로 나가므로(왕복을 늘리지 않으려고)
   *   읽는 시점에는 이름표가 아직 없다. id 를 버리면 그 뒤로 영영 못 붙인다.
   */
  updatedById: string | null;
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

/**
 * 판단 기준 한 갈래를 «화면과 저장이 같은 모양» 으로 줄인다.
 *
 * ★ 읽기와 쓰기가 «이 함수 하나» 를 같이 부른다. 상한 정의는 한 곳뿐이어야 하기 때문이다.
 *   전에는 쓰기 쪽이 `parseSeatRules({escalate: ...}).escalate` 로 우회했는데,
 *   그러면 갈래 하나(escalate)의 규칙이 나머지 둘을 «대변» 하게 된다.
 *   지금은 셋의 상한이 같아 맞지만, 언젠가 갈리면 쓰기 경로가 조용히 틀린 규칙을 적용하고
 *   **시험은 그때도 통과한다** — 어느 갈래인지 인자로 안 받으니까 (#683 3차 검수 P3-4).
 */
export function normalizeRuleLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim().slice(0, MAX_LINE) : ""))
    .filter((entry) => entry.length > 0)
    .slice(0, MAX_RULES_PER_KIND);
}

const stringList = normalizeRuleLines;

export function parseSeatRules(value: unknown): { escalate: string[]; handle: string[]; avoid: string[] } {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    escalate: stringList(row.escalate),
    handle: stringList(row.handle),
    avoid: stringList(row.avoid),
  };
}

/**
 * 「2026. 9. 1.」처럼 적는다. **시간대를 못 박는다.**
 *
 * ★ 왜 시간대를 «인자로» 주는가 — 두 가지를 동시에 만족해야 한다.
 *
 *   ① 하이드레이션이 안전해야 한다. 맨 `toLocaleDateString()` 은 서버(UTC)와 브라우저(로컬)가
 *      서로 다른 날짜를 그려서, 첫 그림과 두 번째 그림이 달라진다 (#683 검수 P3-7).
 *   ② 그런데 값도 맞아야 한다. UTC 로 못 박았더니 이번엔 **한국 00:00~09:00 에 저장한 것이
 *      매일 «어제» 로 보였다** — 하루 9시간짜리 창이다 (#683 재검수 P2-D).
 *
 *   `timeZone` 을 명시하면 «누가 어디서 그리든 같은 글자» 이면서 «한국 날짜» 다.
 *   ①은 결정적이라서 풀리고, ②는 기준이 맞아서 풀린다. 둘 중 하나를 포기할 필요가 없었다.
 */
const SEAT_DATE_ZONE = "Asia/Seoul";

export function seatDefinitionDate(value: string | null | undefined): string {
  if (!value) return "";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleDateString("ko-KR", { timeZone: SEAT_DATE_ZONE });
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
    updatedById: row.updated_by,
    updatedByName: row.updated_by ? (nameOf?.(row.updated_by) ?? null) : null,
  };
}

/**
 * 이미 읽어 둔 정의서에 «이름표만» 나중에 입힌다.
 *
 * ★ 왜 나중인가 — 정의서와 구성원 요약이 같은 물결로 나간다. 순서를 매기면 왕복이 는다.
 *   그래서 정의서는 먼저 도착하고, 이름은 요약이 온 뒤에 붙인다.
 *
 * ★ 이걸 안 해서 화면이 계속 「누군가가 씀」이라고 말했다. 우리는 누구인지 «알고 있었다» —
 *   `updated_by` 도 요약도 같은 화면에 다 있었다. **아는 것을 모른다고 말하는 것**이고,
 *   이 PR 이 네 라운드 동안 고친 것과 정확히 같은 종류다 (#683 운영 화면 확인에서 발견).
 *
 * 모르는 id 는 그대로 null 로 둔다 — 그때는 「누군가」가 «맞는» 말이다.
 */
export function withSeatDefinitionNames(
  definitions: Map<string, SeatDefinition> | null,
  nameOf: (userId: string) => string | null,
): Map<string, SeatDefinition> | null {
  if (!definitions) return null;
  const out = new Map<string, SeatDefinition>();
  for (const [key, definition] of definitions) {
    out.set(
      key,
      definition.updatedById
        ? { ...definition, updatedByName: nameOf(definition.updatedById) }
        : definition,
    );
  }
  return out;
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
