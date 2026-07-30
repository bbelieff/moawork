import { createClient } from "@/lib/supabase/server";
import {
  unavailablePlatformAggregate,
  type PlatformAggregateState,
  type PlatformMetricsDailyRow,
  type PlatformSectionKey,
} from "./contracts";

type RpcRow = Record<string, unknown>;

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function toMetricsDailyRow(value: RpcRow): PlatformMetricsDailyRow | null {
  const day = textValue(value.day);
  const workspaceCount = numberValue(value.workspace_count);
  const dau = numberValue(value.dau);
  const mau = numberValue(value.mau);
  const stickiness = numberValue(value.stickiness);
  const activeUsers = numberValue(value.active_users);
  const dormantUsers = numberValue(value.dormant_users);
  const newDeals = numberValue(value.new_deals);
  if (!day || workspaceCount === null || dau === null || mau === null || stickiness === null || activeUsers === null || dormantUsers === null || newDeals === null) return null;
  return { day, workspace_count: workspaceCount, dau, mau, stickiness, active_users: activeUsers, dormant_users: dormantUsers, new_deals: newDeals, computed_at: textValue(value.computed_at) };
}

function dayInput(daysBeforeToday: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysBeforeToday);
  return date.toISOString().slice(0, 10);
}

function numberDisplay(value: number | null): string | null {
  return value === null ? null : new Intl.NumberFormat("ko-KR").format(value);
}

export function toPlatformAggregate(section: PlatformSectionKey, rows: readonly PlatformMetricsDailyRow[]): PlatformAggregateState {
  const latest = rows.at(-1) ?? null;
  if (!latest) return { kind: "unavailable", message: "아직 표시할 집계 스냅샷이 없어요. 값이 0이라는 뜻으로 바꾸어 보여주지 않아요." };
  const freshness = latest.computed_at ?? latest.day;
  if (section === "overview") return { kind: "ready", updatedAt: freshness, values: [
    { label: "워크스페이스", value: numberDisplay(latest.workspace_count), description: `${latest.day} 기준 집계` },
    { label: "활성 사용자", value: numberDisplay(latest.active_users), description: "개인 식별 정보 없이 합산" },
    { label: "새 진행 업무", value: numberDisplay(latest.new_deals), description: "제목·고객 정보 없이 합산" },
  ] };
  if (section === "organizations") return { kind: "ready", updatedAt: freshness, values: [
    { label: "연결된 워크스페이스", value: numberDisplay(latest.workspace_count), description: "이름과 구성원 목록은 표시하지 않아요." },
  ] };
  if (section === "analytics") return { kind: "ready", updatedAt: freshness, values: [
    { label: "최근 집계일", value: latest.day, description: `${rows.length}일 범위의 일별 집계` },
    { label: "일일 활성", value: numberDisplay(latest.dau), description: "최근 집계일 기준" },
    { label: "월간 활성", value: numberDisplay(latest.mau), description: "최근 집계일 기준" },
    { label: "활성 비율", value: `${Math.round(latest.stickiness * 100)}%`, description: "일일 활성 ÷ 월간 활성" },
  ] };
  if (section === "system") return { kind: "ready", updatedAt: freshness, values: [
    { label: "마지막 집계", value: freshness, description: "집계가 계산된 시각 또는 기준일" },
    { label: "집계 범위", value: `${rows.length}일`, description: "최근 30일 범위에서 읽었어요." },
  ] };
  return { kind: "unavailable", message: "이 영역은 현재 집계 전용 계약에 포함되지 않아요. 고객·개인·결제 원문이나 운영 권한을 대신 표시하지 않아요." };
}

/** The page guard runs first; this loader only calls migration 016's aggregate RPC. */
export async function loadPlatformAggregate(section: PlatformSectionKey): Promise<PlatformAggregateState> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("platform_console_metrics_daily", { p_from: dayInput(29), p_to: dayInput(0) });
    if (error || !Array.isArray(data)) return unavailablePlatformAggregate();
    const rows = data.map((row) => toMetricsDailyRow(row as RpcRow)).filter((row): row is PlatformMetricsDailyRow => row !== null);
    return toPlatformAggregate(section, rows);
  } catch {
    return unavailablePlatformAggregate();
  }
}
