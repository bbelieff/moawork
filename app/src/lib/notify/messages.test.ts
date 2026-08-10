import { describe, it, expect } from "vitest";
import { actorLabel, deepLink, feedLine, relativeTime } from "./messages";
import { groupFeed } from "./grouping";
import type { FeedItem } from "./types";

const NOW = new Date("2026-07-22T12:00:00.000Z");

function feed(over: Partial<FeedItem> = {}): FeedItem {
  return {
    id: "f1",
    org_id: "org1",
    actor: "u2",
    action: "deal.move",
    target_type: "deal",
    target_id: "d1",
    at: "2026-07-22T11:50:00.000Z",
    ...over,
  };
}

describe("★ 주어를 반드시 표시한다", () => {
  it("누가·무엇을·어디서·시간이 모두 들어간다", () => {
    const line = feedLine(feed(), "박실장", NOW);
    expect(line.actor).toBe("박실장");
    expect(line.verb).toContain("옮겼습니다");
    expect(line.where).toBe("업무관리");
    expect(line.when).toBe("10분 전");
    expect(line.text).toContain("박실장");
  });

  it("이름이 없어도 주어 자리를 비우지 않는다", () => {
    expect(actorLabel(null)).toBe("알 수 없는 사용자");
    expect(actorLabel("  ")).toBe("알 수 없는 사용자");
    expect(feedLine(feed(), null, NOW).text).toContain("알 수 없는 사용자");
  });
});

describe("★ 문구에 금액·개인정보를 넣지 않는다", () => {
  it("정산 소식은 '등록되었습니다' 까지만 말한다", () => {
    const line = feedLine(feed({ action: "settlement.create" }), "김대리", NOW);
    expect(line.verb).toBe("정산이 등록되었습니다");
    // 금액을 표현할 자리 자체가 없다.
    expect(line.text).not.toMatch(/[0-9][0-9,]*\s*(원|만원|억)/);
  });

  it("모든 템플릿 문구에 숫자 금액이 없다", () => {
    const actions = [
      "deal.create",
      "deal.move",
      "deal.update",
      "company.create",
      "settlement.create",
      "settlement.update",
      "notice.create",
      "member.join_request",
      "member.join_approved",
    ];
    for (const action of actions) {
      const line = feedLine(feed({ action }), "홍길동", NOW);
      expect(line.verb).not.toMatch(/[0-9]/);
    }
  });

  it("알 수 없는 action 도 값 노출 없이 일반 문구로 처리한다", () => {
    const line = feedLine(feed({ action: "something.unknown" }), "홍길동", NOW);
    expect(line.verb).toBe("변경했습니다");
  });
});

describe("묶음 표현", () => {
  it("같은 사람의 반복 행동은 건수로 묶어 표시한다", () => {
    const line = feedLine(feed(), "박실장", NOW, 5);
    expect(line.verb).toContain("(5건)");
    expect(line.text).toContain("박실장");
  });

  it("같은 사람·같은 행동이 시간창 안에 있으면 한 줄로 접힌다", () => {
    const items = [
      feed({ id: "a", at: "2026-07-22T11:50:00.000Z" }),
      feed({ id: "b", at: "2026-07-22T11:52:00.000Z" }),
      feed({ id: "c", at: "2026-07-22T11:54:00.000Z" }),
    ];
    const groups = groupFeed(items);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.count).toBe(3);
  });

  it("다른 사람 활동은 묶이지 않는다", () => {
    const items = [
      feed({ id: "a", actor: "u2", at: "2026-07-22T11:54:00.000Z" }),
      feed({ id: "b", actor: "u3", at: "2026-07-22T11:52:00.000Z" }),
    ];
    expect(groupFeed(items)).toHaveLength(2);
  });

  it("시간창을 벗어나면 묶지 않는다", () => {
    const items = [
      feed({ id: "a", at: "2026-07-22T11:54:00.000Z" }),
      feed({ id: "b", at: "2026-07-22T10:00:00.000Z" }),
    ];
    expect(groupFeed(items)).toHaveLength(2);
  });
});

describe("relativeTime", () => {
  it("사람이 읽는 단위로 표기한다", () => {
    expect(relativeTime("2026-07-22T11:59:40.000Z", NOW)).toBe("방금");
    expect(relativeTime("2026-07-22T11:30:00.000Z", NOW)).toBe("30분 전");
    expect(relativeTime("2026-07-22T09:00:00.000Z", NOW)).toBe("3시간 전");
    expect(relativeTime("2026-07-20T12:00:00.000Z", NOW)).toBe("2일 전");
  });
});

describe("★ 딥링크 — 2클릭 내 도달", () => {
  it("가입 요청은 이미 존재하는 승인 화면으로 보낸다", () => {
    expect(deepLink("member_approval", "req1")).toBe("/settings/members/approvals");
  });

  it("딜·정산은 정책자금 보드로 보낸다(보드 id 라우트로 오인 금지)", () => {
    expect(deepLink("deal", "d1")).toBe("/policyfund?focus=d1");
    expect(deepLink("settlement", "s1")).toBe("/policyfund?focus=s1");
  });

  it("공지는 공지 화면으로 보낸다", () => {
    expect(deepLink("notice", null)).toBe("/notices");
  });

  it("대상이 없으면 링크를 만들지 않는다", () => {
    expect(deepLink(null, null)).toBeNull();
    expect(deepLink("unknown", "x")).toBeNull();
  });
});
