import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TodayHome } from "./TodayHome";
import type { TodayDashboardSnapshot } from "@/lib/dash/today";
import type { TodayHomeState } from "@/lib/dash/today-server";

// 이 파일이 빨개지는 조건:
//  · 네 상태(연결안됨·오류·비어있음·부분) 중 하나라도 흰 화면이 될 때
//  · 할 일·알림 행이 deep link 를 잃을 때
//  · 화면에 스냅샷이 주지 않은 숫자·업체명이 새로 생길 때

const snapshot = (over: Partial<TodayDashboardSnapshot> = {}): TodayDashboardSnapshot => ({
  version: 1,
  orgId: "org-1",
  viewer: { userId: "user-1", role: "owner", scope: "all" },
  asOf: "2026-08-17T09:00:00.000Z",
  timezone: "Asia/Seoul",
  period: { today: "2026-08-17", monthStart: "2026-08-01", monthEndExclusive: "2026-09-01" },
  status: "ready",
  missingSources: [],
  kpis: {
    todayConsultations: 4,
    callbacks: 2,
    contractsWaiting: 3,
    contractDeposits: 8_000_000,
    fees: 21_600_000,
  },
  tasks: [
    {
      kind: "work_due",
      itemId: "item-1",
      title: "표시용 업체",
      dueOn: "2026-08-17",
      status: "in_progress",
      href: "/work?notification=item-1",
    },
    {
      kind: "work_due",
      itemId: "item-2",
      title: "표시용 업체 2",
      dueOn: "2026-08-15",
      status: "blocked",
      href: "/work?notification=item-2",
    },
  ],
  notifications: [
    {
      id: "noti-1",
      type: "deal_comment",
      title: "댓글이 달렸습니다",
      body: "확인 부탁드립니다",
      targetType: "deal",
      targetId: "deal-1",
      isAction: true,
      readAt: null,
      createdAt: "2026-08-17T08:00:00.000Z",
      href: "/settings/notifications?notification=noti-1",
    },
  ],
  ...over,
});

const render = (state: TodayHomeState) => renderToStaticMarkup(<TodayHome state={state} />);

describe("홈 «오늘» — 정상", () => {
  const html = render({ kind: "ready", snapshot: snapshot() });

  it("KPI 5장을 목업 순서대로 보여준다", () => {
    const order = ["오늘 상담할 곳", "재통화 대기", "계약 대기", "이번 달 계약금", "이번 달 수수료"];
    const positions = order.map((label) => html.indexOf(label));
    expect(positions.every((index) => index >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(html).toContain("8,000,000원");
    expect(html).toContain("21,600,000원");
  });

  it("네 영역이 모두 있다", () => {
    for (const title of ["내 할 일", "최근 알림", "바로 가기"]) expect(html).toContain(title);
    expect(html).toContain("담당자 = 나");
  });

  it("할 일과 알림이 실제 deep link 를 갖는다", () => {
    expect(html).toContain('href="/work?notification=item-1"');
    expect(html).toContain('href="/settings/notifications?notification=noti-1"');
  });

  it("기한을 오늘·지남으로 갈라 보여준다", () => {
    expect(html).toContain("오늘");
    expect(html).toContain("지남");
  });

  it("스냅샷에 없는 숫자를 지어내지 않는다", () => {
    // 목업 예시값(800만·2,160만 문구, 예시 업체명)이 코드에 박히면 여기서 잡힌다.
    expect(html).not.toContain("㈜대한정밀");
    expect(html).not.toContain("세림기업");
    expect(html).not.toContain("800만");
  });
});

describe("홈 «오늘» — 비어있음 · 부분 · 오류", () => {
  it("0건이어도 0 을 보여주고 다음 행동을 알려준다", () => {
    const html = render({
      kind: "ready",
      snapshot: snapshot({
        status: "empty",
        kpis: { todayConsultations: 0, callbacks: 0, contractsWaiting: 0, contractDeposits: 0, fees: 0 },
        tasks: [],
        notifications: [],
      }),
    });
    expect(html).toContain("0원");
    expect(html).toContain("오늘 처리할 업무가 없습니다");
    expect(html).toContain("아직 없습니다");
    expect(html).not.toContain("NaN");
  });

  it("부분 상태는 무엇이 빠졌는지 이름으로 밝힌다", () => {
    const html = render({
      kind: "ready",
      snapshot: snapshot({ status: "partial", missingSources: ["contact", "work"] }),
    });
    expect(html).toContain("리드컨택 관리");
    expect(html).toContain("계약업체 실무");
  });

  it("연결 전에는 오류가 아니라 «아직 연결 안 됨» 으로 말한다", () => {
    const html = render({ kind: "unconfigured" });
    expect(html).toContain("아직 연결되지 않았습니다");
    expect(html).not.toContain("NaN");
  });

  it("읽기 실패는 사유와 다음 행동을 함께 보여준다", () => {
    const html = render({ kind: "error", reason: "Today dashboard is unavailable." });
    expect(html).toContain("불러오지 못했습니다");
    expect(html).toContain("Today dashboard is unavailable.");
  });
});
