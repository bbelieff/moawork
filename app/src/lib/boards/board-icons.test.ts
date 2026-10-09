// #845 대표 결정(2026-10-08) — 탭 아이콘은 이모지·색 칸 없이 선 아이콘 한 벌이다.
// 저장값(아이콘 키·옛 이모지·빈 값)을 그릴 아이콘 키로 해석하는 규칙을 잰다.
import { describe, expect, it } from "vitest";
import {
  isTabIconKey,
  resolveBoardIconKey,
  TAB_ICON_KEYS,
  TAB_ICON_LABELS,
  TAB_ICON_PATHS,
} from "./board-icons";
import { CONTACT_TAB } from "@/lib/default-tabs/contact";
import { CONTRACT_WORK_TAB, CONTRACT_WORK_TAB_SOURCE } from "@/lib/default-tabs/contract-work";
import { NEW_LEAD_TAB } from "@/lib/default-tabs/new-lead";
import { NOTICE_TAB } from "@/lib/default-tabs/notice";
import { CONTACT_TAB_SOURCE, NEW_LEAD_TAB_SOURCE, NOTICE_TAB_SOURCE } from "@/lib/default-tabs/types";

describe("탭 아이콘 한 벌", () => {
  it("16개 키마다 24×24 선 경로와 한국어 이름이 있다", () => {
    expect(TAB_ICON_KEYS).toHaveLength(16);
    expect(new Set(TAB_ICON_KEYS).size).toBe(16);
    for (const key of TAB_ICON_KEYS) {
      expect(TAB_ICON_PATHS[key], key).toMatch(/^M[\d.]/u);
      expect(TAB_ICON_LABELS[key], key).toMatch(/[가-힣]/u);
    }
    // 승인 목업의 경로를 그대로 옮겼다 — 대표 그림 둘을 고정한다.
    expect(TAB_ICON_PATHS.lead).toBe("M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M19 8v6M16 11h6");
    expect(TAB_ICON_PATHS.check).toBe("M4 12l5 5L20 6");
  });

  it("키 판정은 목록에 있는 글자만 참이다", () => {
    expect(isTabIconKey("phone")).toBe(true);
    expect(isTabIconKey("Phone")).toBe(false);
    expect(isTabIconKey("💡")).toBe(false);
    expect(isTabIconKey(null)).toBe(false);
    expect(isTabIconKey(undefined)).toBe(false);
  });
});

describe("resolveBoardIconKey — 저장된 키 → 옛 이모지 → 탭 출처 → 문서", () => {
  it("저장된 아이콘 키는 그대로 쓴다 — 출처보다 먼저다", () => {
    expect(resolveBoardIconKey("calendar", NEW_LEAD_TAB_SOURCE)).toBe("calendar");
    expect(resolveBoardIconKey(" star ", null)).toBe("star");
  });

  it("옛 이모지는 뜻이 같은 그림으로 바꿔 그린다", () => {
    expect(resolveBoardIconKey("💡")).toBe("lead");
    expect(resolveBoardIconKey("💰")).toBe("phone");
    expect(resolveBoardIconKey("📞")).toBe("phone");
    expect(resolveBoardIconKey("🔁")).toBe("case");
    expect(resolveBoardIconKey("📢")).toBe("notice");
    expect(resolveBoardIconKey("📍")).toBe("people");
    expect(resolveBoardIconKey("📋")).toBe("document");
    // 변형 선택자(U+FE0F)가 붙은 이모지도 같은 그림이다.
    expect(resolveBoardIconKey("☎️")).toBe("phone");
    expect(resolveBoardIconKey("✔️")).toBe("check");
  });

  it("값이 없거나 모르면 탭 출처로, 출처도 모르면 문서 아이콘", () => {
    expect(resolveBoardIconKey(null, NEW_LEAD_TAB_SOURCE)).toBe("lead");
    expect(resolveBoardIconKey("", CONTACT_TAB_SOURCE)).toBe("phone");
    expect(resolveBoardIconKey("🎯", CONTRACT_WORK_TAB_SOURCE)).toBe("case");
    expect(resolveBoardIconKey(undefined, NOTICE_TAB_SOURCE)).toBe("notice");
    expect(resolveBoardIconKey("🎯", "user-tab")).toBe("document");
    expect(resolveBoardIconKey(null, null)).toBe("document");
    // 프로토타입 이름이 아이콘으로 새지 않는다.
    expect(resolveBoardIconKey("constructor", "toString")).toBe("document");
  });

  it("기본 탭 정의의 아이콘은 사이드바와 같은 그림으로 풀린다", () => {
    expect(resolveBoardIconKey(NEW_LEAD_TAB.icon, NEW_LEAD_TAB.source)).toBe("lead");
    expect(resolveBoardIconKey(CONTACT_TAB.icon, CONTACT_TAB.source)).toBe("phone");
    expect(resolveBoardIconKey(CONTRACT_WORK_TAB.icon, CONTRACT_WORK_TAB.source)).toBe("case");
    expect(resolveBoardIconKey(NOTICE_TAB.icon, NOTICE_TAB.source)).toBe("notice");
  });
});
