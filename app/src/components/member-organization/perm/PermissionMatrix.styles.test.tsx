import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PermissionMatrix } from "./PermissionMatrix";
import type { PermMatrixSnapshot } from "@/lib/perm/server";

/**
 * 2026-08-26 — «만들었는데 화면에 안 닿은» 부품을 다시 만들지 않기 위한 못.
 *
 * 무엇이 있었나 (운영 실측)
 *   이 컴포넌트가 `pane` · `ptit` · `tnode` · `prow` · `tg` 를 쓰고 있었다.
 *   그것들은 **목업 스타일시트의 클래스**이고 앱 CSS 에는 없다.
 *   그래서 역할 목록이 «소유자0관리자0팀장0멤버0» 로 붙어 보였고,
 *   ★ 켜기/끄기 토글이 **아예 안 보였다** — 이 화면의 핵심 조작이 없는 셈이었다.
 *   그런데 단위 테스트는 초록이었다. `class="tg off"` 를 «있는지» 만 봤기 때문이다.
 *
 * 그래서 두 가지를 잰다
 *   ① 목업 전용 클래스가 다시 들어오지 않는다
 *   ② 붙어 보이던 자리·안 보이던 토글·헐벗은 구역이 다시 그렇게 되지 않는다
 */

const MOCKUP_ONLY_CLASSES = ["pane", "ptit", "tnode", "prow", "rgrp", "tg", "tree", "mute", "crumbline"];

const snapshot: PermMatrixSnapshot = {
  matrix: [],
  exceptions: [],
} as unknown as PermMatrixSnapshot;

const html = renderToStaticMarkup(
  <PermissionMatrix
    orgId="org-1"
    activeRole="admin"
    viewerRole="owner"
    access={{ kind: "allowed", snapshot }}
    roleMemberCounts={{ owner: 1, admin: 2, member: 3 }}
  />,
);

/** `class="a b c"` 들에서 실제로 쓰인 클래스 이름을 전부 모은다. */
function usedClasses(markup: string): Set<string> {
  const found = new Set<string>();
  for (const match of markup.matchAll(/class="([^"]*)"/g)) {
    for (const name of match[1].split(/\s+/)) if (name) found.add(name);
  }
  return found;
}


describe("권한 매트릭스 — 화면에 실제로 닿는 스타일만 쓴다", () => {
  it("① 목업 전용 클래스가 다시 들어오지 않는다", () => {
    const used = usedClasses(html);
    const leaked = MOCKUP_ONLY_CLASSES.filter((name) => used.has(name));
    expect(leaked, `앱 CSS 에 없는 목업 클래스를 다시 쓰고 있다: ${leaked.join(", ")}`).toEqual([]);
  });

  it("② 역할 이름과 인원 수가 «붙지 않고» 각자 자리에 있다", () => {
    // 예전 증상이 정확히 이것이었다 — «소유자0관리자0팀장0멤버0».
    expect(html).not.toMatch(/소유자\d/);
    expect(html).not.toMatch(/관리자\d/);
    // 넘긴 인원 수가 그대로 나온다(예전에는 호출부가 안 넘겨 전부 0 이었다).
    expect(html).toContain(">2<");
  });

  it("★ ③ 토글이 «보이는» 요소로 그려진다", () => {
    // 스타일이 없으면 버튼 안이 비어 켜짐/꺼짐을 눈으로 구분할 수 없었다.
    expect(html).toContain('aria-pressed');
    // 스위치 몸통에 실제 배경색 유틸이 붙어 있어야 한다.
    expect(html).toMatch(/bg-(violet-600|zinc-300)/);
  });

  it("④ 두 구역이 «카드» 로 그려진다 — 옆 카드들과 같은 옷을 입는다", () => {
    // 예전 증상: 회사 로고·구성원은 테두리 있는 카드인데 이 구역만 맨 텍스트로 흘렀다.
    //   그래서 같은 화면 안에서 여기만 헐벗어 보였다.
    // ⚠ 「모든 클래스가 앱 CSS 에 있는가」를 재는 검사도 만들어 봤다가 버렸다 —
    //   `border`·`shadow` 같은 정상 유틸을 오탐으로 잡아, 앞으로 이 파일을 고칠 사람에게
    //   함정이 된다. 못은 «무엇이 틀렸었나»(①②③)에만 박는 것이 맞다.
    const roleNav = html.match(/<nav[^>]*aria-label="역할"[^>]*class="([^"]*)"/)
      ?? html.match(/<nav[^>]*class="([^"]*)"[^>]*aria-label="역할"/);
    expect(roleNav?.[1], "역할 목록이 카드가 아니다").toMatch(/rounded-md/);
    expect(roleNav?.[1]).toMatch(/border/);
    expect(html.match(/<section[^>]*aria-label="[^"]*권한"[^>]*class="([^"]*)"/)?.[1] ?? "").toMatch(/rounded-md/);
  });
});
