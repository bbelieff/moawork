import { describe, expect, it } from "vitest";
import {
  HOME_KPIS,
  HOME_SHORTCUTS,
  dueBadge,
  formatKpi,
  taskTabLabel,
  taskWhat,
} from "./today-view";
import type { TodayDashboardTask } from "./today";

// 이 파일이 빨개지는 조건:
//  · KPI 5장의 순서·라벨이 V6 목업(:1534~1538)에서 벗어날 때
//  · KPI 가 BBE-185 스냅샷에 없는 키를 읽으려 할 때(타입으로 이미 막히지만 값도 확인한다)
//  · 할 일 «탭» 이 사이드바 정본 이름을 벗어날 때
//  · 기한 배지가 지남/오늘/예정을 구분하지 못할 때
//  · 홈에서 분석 화면으로 가는 유일한 길이 사라질 때

const task = (over: Partial<TodayDashboardTask> = {}): TodayDashboardTask => ({
  kind: "work_due",
  itemId: "item-1",
  title: "표시용 업체",
  dueOn: "2026-08-17",
  status: "in_progress",
  href: "/work?notification=item-1",
  ...over,
});

describe("홈 KPI 계약", () => {
  // ★ BBE-215(2026-08-18) 로 계약이 바뀌었다 — 목업 5장이 «틀려서» 가 아니라 총괄이 바꿔서다.
  //   「오늘 상담할 곳」을 «행동의 종류» 로 갈라 「전화예정 / 미팅예정」으로 만들었다.
  //   그래서 이 단언은 목업이 아니라 «그 결정» 을 정본으로 삼는다.
  it("총괄 확정 6장을 순서까지 그대로 유지한다 (BBE-215)", () => {
    expect(HOME_KPIS.map((kpi) => kpi.label)).toEqual([
      "전화예정",
      "재통화 대기",
      "미팅예정",
      "계약 대기",
      "이번 달 계약금",
      "이번 달 수수료",
    ]);
    expect(HOME_KPIS.map((kpi) => kpi.key)).toEqual([
      "calls",
      "callbacks",
      "meetings",
      "contractsWaiting",
      "contractDeposits",
      "fees",
    ]);
  });

  it("건수는 건수로, 금액은 원화로 — 0 도 '—' 가 아니라 0 으로 보여준다", () => {
    const kpis = {
      calls: 0,
      callbacks: 12,
      meetings: 4,
      contractsWaiting: 3,
      contractDeposits: 8_000_000,
      fees: 21_600_000,
    };
    expect(HOME_KPIS.map((kpi) => formatKpi(kpi, kpis))).toEqual([
      "0",
      "12",
      "4",
      "3",
      "8,000,000원",
      "21,600,000원",
    ]);
  });
});

describe("할 일 행 파생", () => {
  it("탭 이름을 사이드바 정본에서 가져온다", () => {
    expect(taskTabLabel("/work?notification=abc")).toBe("계약업체 실무");
    expect(taskTabLabel("/newcust")).toBe("신규리드 관리");
    expect(taskTabLabel("/contract")).toBe("리드컨택 관리");
  });

  it("정본에 없는 주소는 지어내지 않고 '-' 로 둔다", () => {
    expect(taskTabLabel("/unknown-route?x=1")).toBe("-");
  });

  it("더 긴 일치를 고른다 — /settings 계열이 서로를 가리지 않는다", () => {
    expect(taskTabLabel("/settings/notifications?notification=1")).toBe("알림");
  });

  it("할 일 문구는 계약이 준 kind·status 만 옮긴다(문장을 지어내지 않는다)", () => {
    expect(taskWhat(task({ kind: "work_due", status: "not_started" }))).toBe("기한 도래 업무 · 시작 전");
    expect(taskWhat(task({ kind: "follow_up", status: "blocked" }))).toBe("후속 연락 · 막힘");
  });
});

describe("기한 배지", () => {
  it("지남 / 오늘 / 예정을 구분한다", () => {
    expect(dueBadge("2026-08-16", "2026-08-17")).toEqual({ tone: "overdue", label: "지남" });
    expect(dueBadge("2026-08-17", "2026-08-17")).toEqual({ tone: "today", label: "오늘" });
    expect(dueBadge("2026-08-19", "2026-08-17")).toEqual({ tone: "upcoming", label: "2026-08-19" });
  });
});

describe("바로 가기", () => {
  it("전부 앱 내부 절대경로다 — 외부 링크·상대경로를 홈에 두지 않는다", () => {
    for (const shortcut of HOME_SHORTCUTS) {
      expect(shortcut.href.startsWith("/")).toBe(true);
      expect(shortcut.href.startsWith("//")).toBe(false);
    }
  });

  it("옮겨 간 분석 화면으로 가는 길을 반드시 하나 남긴다", () => {
    // 이 링크가 사라지면 /dash·/dash/all·/dash/tasks 가 어느 화면에도 닿지 않는다(진단 §1.3).
    expect(HOME_SHORTCUTS.some((shortcut) => shortcut.href === "/dash")).toBe(true);
  });
});
