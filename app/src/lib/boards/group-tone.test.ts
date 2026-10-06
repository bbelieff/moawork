import { describe, expect, it } from "vitest";
import { CONTRACT_WORK_TAB, CONTRACT_WORK_TAB_SOURCE } from "@/lib/default-tabs/contract-work";
import { CONTACT_TAB } from "@/lib/default-tabs/contact";
import { NEW_LEAD_TAB } from "@/lib/default-tabs/new-lead";
import { CONTACT_TAB_SOURCE, NEW_LEAD_TAB_SOURCE } from "@/lib/default-tabs/types";
import {
  fallbackGroupTones,
  groupToneAccent,
  groupToneFromTable,
  groupToneKey,
  groupToneLabel,
  resolveGroupTones,
  spreadLevel,
  type GroupToneInput,
} from "./group-tone";

const named = (...names: string[]): GroupToneInput[] => names.map((name, index) => ({ key: `g${index}`, name }));
const labels = (source: string | null, groups: GroupToneInput[]) => {
  const tones = resolveGroupTones(source, groups);
  return Object.fromEntries(groups.map((group) => [group.name, groupToneLabel(tones.get(group.key))]));
};

describe("group-tone — 탭 2색 × 깊이 (#845, 대표 지시 2026-10-06)", () => {
  it("계약업체 실무: 운영 그룹 이름(이모지·이름 바꾼 그룹·빈 설치 복제 포함)을 지시된 깊이로 칠한다", () => {
    const shown = labels(CONTRACT_WORK_TAB_SOURCE, named(
      "준비단계", "진행중", "심사 중", "승인",
      "📂 소진공 취약자금 접수예정", "📂 소진공 혁신성장 접수예정", "📂 소진공 일시적경영애로 접수예정", "📂 소진공 재도전 접수예정",
      "기업인증 진행", "소공인(상생)", "관리중", "해당연도 매출", "업체관리", "⛔ 대출불가",
      "⏹️ 준비단계", "▶️ 진행중", "🔂 심사 중", "💰 승인",
    ));
    expect(shown).toEqual({
      준비단계: "A1", 진행중: "A2", "심사 중": "A4", 승인: "A5",
      "📂 소진공 취약자금 접수예정": "A3", "📂 소진공 혁신성장 접수예정": "A3",
      "📂 소진공 일시적경영애로 접수예정": "A3", "📂 소진공 재도전 접수예정": "A3",
      "기업인증 진행": "B1", "소공인(상생)": "B2", 관리중: "B3", "해당연도 매출": "B4", 업체관리: "B5",
      "⛔ 대출불가": "S",
      "⏹️ 준비단계": "A1", "▶️ 진행중": "A2", "🔂 심사 중": "A4", "💰 승인": "A5",
    });
  });

  it("기본 탭이 실제로 설치하는 그룹은 모두 표에 있다 — 낱말 규칙으로 떨어지지 않는다", () => {
    for (const tab of [CONTRACT_WORK_TAB, NEW_LEAD_TAB, CONTACT_TAB]) {
      for (const group of tab.groups) {
        expect(groupToneFromTable(tab.source, group.name), `${tab.key}: ${group.name}`).not.toBeNull();
      }
    }
    expect(groupToneFromTable("custom", "준비단계")).toBeNull();
    expect(labels(NEW_LEAD_TAB_SOURCE, named(...NEW_LEAD_TAB.groups.map((group) => group.name)))).toEqual({
      "💡 신규고객": "A1", "🔍 2차 상담고객": "A3", "🔇 1차 부재": "B2", "📑 보류": "B4", "🚫 거절": "S",
    });
    expect(labels(CONTACT_TAB_SOURCE, named(...CONTACT_TAB.groups.map((group) => group.name)))).toEqual({
      "💰 컨텍": "A1", "💰 담당자 1": "A3", "💰 담당자 2": "A3", "💰 계약보류(온/오프)": "B4",
      "📍 미팅보류": "B2", "📍 미팅취소": "S", "📍 계약취소": "S",
    });
  });

  it("단계 보기의 가상 묶음은 «(N)» 건수 표시와 무관하게 같은 깊이다", () => {
    expect(labels(NEW_LEAD_TAB_SOURCE, named("통화대기", "부재", "재통화", "통화완료"))).toEqual({
      통화대기: "A1", 부재: "B2", 재통화: "A3", 통화완료: "A5",
    });
    expect(labels(CONTACT_TAB_SOURCE, named("상담예정 (3)", "상담예정 (0)", "거절 (1)", "계약 확인 완료 (2)"))).toEqual({
      "상담예정 (3)": "A2", "상담예정 (0)": "A2", "거절 (1)": "S", "계약 확인 완료 (2)": "A5",
    });
    // 회사마다 멤버 이름으로 바뀐 담당자 그룹은 모두 같은 줄(A3)이다.
    expect(labels(CONTACT_TAB_SOURCE, named("김하늘", "이도윤"))).toEqual({ 김하늘: "A3", 이도윤: "A3" });
  });

  it("표가 없는 보드: 멈춤 낱말 → S, 곁가지 낱말 → B, 나머지는 순서대로 A 가 깊어진다", () => {
    expect(labels("custom", named("접수", "검토 대기", "진행", "완료", "중단", "고객 거절", "해당 안 됨", "보류"))).toEqual({
      접수: "A1", "검토 대기": "B1", 진행: "A3", 완료: "A5", 중단: "S", "고객 거절": "S", "해당 안 됨": "S", 보류: "B5",
    });
    expect(labels(null, named("하나"))).toEqual({ 하나: "A3" });
  });

  it("앞 낱말이 같은 그룹들은 한 자리를 나눠 같은 깊이다", () => {
    expect(labels("custom", named("준비", "소진공 혁신성장", "소진공 재도전", "심사", "승인"))).toEqual({
      준비: "A1", "소진공 혁신성장": "A2", "소진공 재도전": "A2", 심사: "A4", 승인: "A5",
    });
  });

  it("깊이는 최대 5단계 — 자리가 많으면 이웃한 자리가 같은 깊이를 나눠 쓴다", () => {
    const many = fallbackGroupTones(named(...Array.from({ length: 9 }, (_, index) => `단계${index}`)));
    const levels = [...many.values()].map((value) => value.level);
    expect(new Set(levels)).toEqual(new Set([1, 2, 3, 4, 5]));
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect([0, 1].map((position) => spreadLevel(position, 2))).toEqual([1, 5]);
    expect([0, 1, 2].map((position) => spreadLevel(position, 3))).toEqual([1, 3, 5]);
  });

  it("표에 없는 그룹이 기본 탭에 더해지면 그것만 낱말·순서 규칙으로 정한다", () => {
    expect(labels(CONTRACT_WORK_TAB_SOURCE, named("준비단계", "새로 만든 그룹", "서류 보류", "취소 건"))).toEqual({
      준비단계: "A1", "새로 만든 그룹": "A3", "서류 보류": "B3", "취소 건": "S",
    });
  });

  it("톤 → 탭 색 토큰. 톤 없는 «그룹 없음» 은 중립색이다", () => {
    expect(groupToneAccent({ axis: "A", level: 3 })).toBe("var(--mw-tab-a-3)");
    expect(groupToneAccent({ axis: "B", level: 5 })).toBe("var(--mw-tab-b-5)");
    expect(groupToneAccent({ axis: "S", level: 1 })).toBe("var(--mw-tab-stop)");
    expect(groupToneAccent(null)).toBe("var(--mw-sub)");
    expect(groupToneKey("📂 소진공 취약자금 접수예정")).toBe("소진공취약자금접수예정");
    expect(groupToneKey("상담예정 (12)")).toBe("상담예정");
  });
});
