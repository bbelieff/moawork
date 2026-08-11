import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OnboardingPanel } from "./OnboardingPanel";
import type { PracticeSnapshot } from "@/lib/onboarding/server";

function snapshot(overrides: Partial<PracticeSnapshot> = {}): PracticeSnapshot {
  return {
    orgId: "org-practice-1",
    quests: [
      { questKey: "q1", title: "항목 만들기", description: "설명1", judgeKind: "item_created", judgeParams: {}, completed: false },
      { questKey: "q2", title: "상태 옮기기", description: null, judgeKind: "item_in_group", judgeParams: {}, completed: true },
    ],
    ...overrides,
  };
}

describe("OnboardingPanel — 연습 회사 없음 vs 권한없음 vs 장애를 다른 화면으로 보여준다", () => {
  it("snapshot 이 없으면 진입(연습 시작) 화면", () => {
    const html = renderToStaticMarkup(<OnboardingPanel snapshot={null} />);
    expect(html).toContain("연습 시작");
    expect(html).not.toContain("불러오지 못했어요");
  });

  it("permission 은 «내 연습 회사가 아니다» 문구", () => {
    const html = renderToStaticMarkup(<OnboardingPanel snapshot={null} error="permission" />);
    expect(html).toContain("내 연습 회사가 아니에요");
    expect(html).not.toContain("불러오지 못했어요");
    expect(html).not.toContain("연습 시작");
  });

  it("unavailable 은 장애 문구 — permission 과 다르다", () => {
    const html = renderToStaticMarkup(<OnboardingPanel snapshot={null} error="unavailable" />);
    expect(html).toContain("불러오지 못했어요");
    expect(html).not.toContain("내 연습 회사가 아니에요");
  });
});

describe("OnboardingPanel — 퀘스트 목록", () => {
  it("퀘스트가 전부 렌더되고 통과/미통과가 데이터 속성으로 구분된다", () => {
    const html = renderToStaticMarkup(<OnboardingPanel snapshot={snapshot()} />);
    expect(html).toContain('data-quest-key="q1" data-completed="false"');
    expect(html).toContain('data-quest-key="q2" data-completed="true"');
    expect(html).toContain("항목 만들기");
    expect(html).toContain("상태 옮기기");
  });

  it("통과 개수를 «N / 전체»로 보여준다", () => {
    const html = renderToStaticMarkup(<OnboardingPanel snapshot={snapshot()} />);
    expect(html).toContain("1");
    expect(html).toContain("/");
    expect(html).toContain("2");
  });

  it("«했다고 체크»가 아니라 시스템 판정임을 재확인 폼(orgId 포함)으로 제공한다", () => {
    const html = renderToStaticMarkup(<OnboardingPanel snapshot={snapshot()} />);
    const formMatch = html.match(/<form[^>]*>[\s\S]*?name="orgId" value="org-practice-1"[\s\S]*?<\/form>/);
    expect(formMatch).toBeTruthy();
  });

  it("설명이 없는 퀘스트는 설명 블록을 렌더하지 않는다", () => {
    const html = renderToStaticMarkup(<OnboardingPanel snapshot={snapshot()} />);
    const q2Block = html.split('data-quest-key="q2"')[1]?.split("</li>")[0] ?? "";
    expect(q2Block).not.toContain("text-xs");
  });
});
