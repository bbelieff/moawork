// BBE-186 · 홈 «오늘» 화면의 표시 규칙(순수 · 조회 없음).
//
// 왜 별도 파일인가: 수용기준 3(«과잉 위젯 홈 잔존 0»)과 KPI 5종은 **기계가 재야 하는 계약**이다.
// 화면 컴포넌트 안에 문자열로 흩어 두면 테스트가 «렌더가 안 터졌다» 만 증명한다(BBE-183 교훈).
// 순서·라벨·파생 규칙을 여기 한 곳에 두고, 테스트는 이 상수를 직접 검사한다.

import { NAV_ITEMS } from "@/components/shell/nav-items";
import { formatCount, formatKrw } from "./format";
import type { TodayDashboardSnapshot, TodayDashboardTask } from "./today";

/**
 * KPI 카드 6장 — BBE-215 총괄 확정(2026-08-18).
 *
 * 목업(`:1534~1538`)은 5장이었고 첫 칸이 「오늘 상담할 곳」이었다. 총괄이 그것을
 * **행동의 종류**로 갈라 「전화예정 / 미팅예정」으로 바꿨다 — 전화를 걸 곳과 만나러 갈 곳은
 * 준비도 시간도 다르기 때문이다. 6칸이 되는 것은 총괄이 허용했다.
 *
 * ★ 앞의 셋은 상담 상황의 «서로 다른 값» 하나씩이라 **같은 건이 두 칸에서 세어질 수 없다.**
 *   순서도 그 흐름을 따른다 — 걸어야 할 곳 → 다시 걸 곳 → 만날 곳 → 계약 → 돈.
 */
export const HOME_KPIS = [
  { key: "calls", label: "전화예정", unit: "count" },
  { key: "callbacks", label: "재통화 대기", unit: "count" },
  { key: "meetings", label: "미팅예정", unit: "count" },
  { key: "contractsWaiting", label: "계약 대기", unit: "count" },
  { key: "contractDeposits", label: "이번 달 계약금", unit: "krw" },
  { key: "fees", label: "이번 달 수수료", unit: "krw" },
] as const satisfies readonly {
  key: keyof TodayDashboardSnapshot["kpis"];
  label: string;
  unit: "count" | "krw";
}[];

export type HomeKpi = (typeof HOME_KPIS)[number];

export function formatKpi(kpi: HomeKpi, kpis: TodayDashboardSnapshot["kpis"]): string {
  return kpi.unit === "krw" ? formatKrw(kpis[kpi.key]) : formatCount(kpis[kpi.key]);
}

/**
 * 할 일이 어느 탭의 것인지 — `task.href` 의 첫 구간으로 되짚는다.
 *
 * 표시 이름은 지어내지 않고 사이드바 정본(`nav-items.ts`)에서 가져온다. 거기서 이름을 바꾸면
 * 홈도 같이 바뀐다. 정본에 없는 주소면 '-' 로 두고 링크만 살린다(빈칸 대신 NaN 금지 규칙과 같다).
 */
export function taskTabLabel(href: string): string {
  const path = href.split("?")[0];
  const match = NAV_ITEMS.filter((item) => item.href && item.href !== "/")
    .filter((item) => path === item.href || path.startsWith(`${item.href}/`))
    // 가장 긴 일치를 고른다 — '/settings' 와 '/settings/members' 가 함께 있을 때를 위해서다.
    .sort((a, b) => (b.href?.length ?? 0) - (a.href?.length ?? 0))[0];
  return match?.label ?? "-";
}

const TASK_KIND_LABEL: Record<TodayDashboardTask["kind"], string> = {
  work_due: "기한 도래 업무",
  follow_up: "후속 연락",
  assign_owner: "담당자 지정",
  decide: "결정 대기",
  reconcile_payment: "입금 확인",
};

const TASK_STATUS_LABEL: Record<TodayDashboardTask["status"], string> = {
  not_started: "시작 전",
  in_progress: "진행 중",
  blocked: "막힘",
};

/**
 * «할 일» 칸 문구.
 *
 * BBE-185 계약에는 자유 서술 필드가 없다(today.ts:13~21 — kind·status 뿐). 그래서 문장을
 * 지어내지 않고 그 둘을 사람 말로 옮기기만 한다. 목업의 «1차 통화 (재 유선상담 …)» 같은
 * 문구는 read model 이 주지 않는 값이라 **만들지 않는다**(샘플 고객명·가짜 문구 0).
 */
export function taskWhat(task: TodayDashboardTask): string {
  return `${TASK_KIND_LABEL[task.kind]} · ${TASK_STATUS_LABEL[task.status]}`;
}

export type DueTone = "overdue" | "today" | "upcoming";

/** 기한 배지 — 지남 / 오늘 / 그 밖(날짜 그대로). 문자열 비교로 충분하다(둘 다 YYYY-MM-DD·KST). */
export function dueBadge(dueOn: string, today: string): { tone: DueTone; label: string } {
  if (dueOn < today) return { tone: "overdue", label: "지남" };
  if (dueOn === today) return { tone: "today", label: "오늘" };
  return { tone: "upcoming", label: dueOn };
}

/**
 * 바로 가기 — 정적 링크다. read model 을 늘리지 않는다(카드 금지: dashboard DB·RPC 자체 구현).
 *
 * V6 목업 `:1563~1565` 의 셋. **지금은 목업과 같다.**
 *
 * ★ 이력 — BBE-186 에서 «업무 분석» 을 넷째로 «추가했다가» BBE-215 에서 «뺐다».
 *   추가한 이유: 분석 화면(/dash·/dash/all·/dash/tasks)이 사이드바에 없어 홈이 유일한 진입점이었다.
 *   뺀 이유: 총괄 결정으로 그 위젯들이 «홈 아래 회사 현황 절» 로 옮겨왔다 — 같은 화면이라 링크가 무의미하다.
 *   ★ 다만 «원래 걱정» 은 사라지지 않았다. 자식 화면으로 가는 링크를 이제 그 절이 들고 있고,
 *     `app/(app)/company-status-placement.test.ts` 가 그것을 못 박는다. 아래 주석 참조.
 */
export const HOME_SHORTCUTS = [
  { label: "신규리드 관리", href: "/newcust" },
  { label: "자동화 규칙", href: "/settings/automations" },
  { label: "온보딩 이어하기", href: "/onboarding" },
  // ★ BBE-215: 「업무 분석」 바로가기는 «이사가 끝난 뒤» 에 뺐다.
  //   DC-12 가 이 자리에 「위젯이 홈으로 실제로 옮겨간 뒤에 지워라」고 조건을 적어 뒀고,
  //   그 조건이 충족됐다 — 위젯은 이제 홈 아래 「회사 현황」 절에 있고,
  //   자식 화면(/dash/all · /dash/[pipelineId] · /dash/tasks)으로 가는 링크도 그 절이 들고 있다.
  //   `company-status-placement.test.ts` 가 그 링크가 살아 있는지를 못 박는다.
  //   `/dash` 자체는 지우지 않고 redirect("/") 로 남겼다 — 북마크·OUT_OF_TAB_HREFS·isGated 가 가리킨다.
] as const;
