// @vitest-environment jsdom
/**
 * 그룹 머리말 «색 띠» — #839 복원 + #845 탭 2색 × 깊이 톤 (대표 지시 2026-10-06).
 * 띠는 그룹 톤 틴트·3px 레일·톤을 섞은 진한 제목이고, 색은 탭 토큰(--mw-tab-*)이다.
 * 저장된 board_groups.color(이관 색)는 지금 쓰지 않는다 — #839 사용자 선택이 override 자리다.
 */
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/boards/title-actions", () => ({
  renameGroupTitleAction: vi.fn(async (_board: string, _group: string, name: string) => ({ ok: true, name })),
}));

import { GroupBlock } from "./GroupBlock";
import { GroupNameEditor } from "./GroupNameEditor";
import { presentLabel } from "@/lib/boards/label-presentation";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

function html(props: Partial<React.ComponentProps<typeof GroupBlock>>) {
  return renderToStaticMarkup(
    <GroupBlock name="🔂 심사 중" color={null} columns={[]} rows={[]} presetName="" presetChanged={false} {...props}>
      <div>본문</div>
    </GroupBlock>,
  );
}

describe("GroupBlock 색 띠 — 탭 2색 × 깊이 (#839 · #845)", () => {
  it("톤의 탭 토큰으로 틴트 띠·3px 레일·AA 제목색을 그리고 행 줄무늬용 변수를 단다", () => {
    const markup = html({ tone: { axis: "A", level: 4 } });
    expect(markup).toContain("--mw-group-accent:var(--mw-tab-a-4)");
    expect(markup).toContain('data-group-tone="A4"');
    expect(markup).toContain("background-color:color-mix(in srgb, var(--mw-tab-a-4) 16%, var(--mw-card))");
    expect(markup).toContain("border-left:3px solid var(--mw-tab-a-4)");
    expect(markup).toContain("color:color-mix(in srgb, var(--mw-tab-a-4) 40%, var(--mw-fg))");
    // 컴포넌트는 hex 를 고르지 않는다 — 색은 언제나 토큰.
    expect(markup).not.toMatch(/#[0-9a-f]{6}/i);
    // v17 의 «점만» 변수로 되돌리지 않는다.
    expect(markup).not.toContain("--mw-group-header-bg");
  });

  it("곁가지는 색 2, 멈춤은 회색, 톤이 없는 «그룹 없음» 은 중립색", () => {
    expect(html({ tone: { axis: "B", level: 2 } })).toContain("--mw-group-accent:var(--mw-tab-b-2)");
    expect(html({ tone: { axis: "S", level: 1 } })).toContain("--mw-group-accent:var(--mw-tab-stop)");
    expect(html({ tone: { axis: "S", level: 1 } })).toContain('data-group-tone="S"');
    expect(html({})).toContain("--mw-group-accent:var(--mw-sub)");
  });

  it("저장된 이관 색은 지금 쓰지 않는다 — 같은 톤이면 저장색과 무관하게 같은 띠", () => {
    const tone = { axis: "A", level: 3 } as const;
    expect(html({ tone, color: "#9CD326" })).toBe(html({ tone, color: null }));
    expect(html({ tone, color: "red;background:url(x)" })).not.toContain("url(x)");
  });

  it("제목은 표시에서만 앞머리 이모지를 걷는다", () => {
    expect(html({})).toContain(">심사 중<");
    expect(html({})).not.toContain("🔂");
    expect(html({ displayName: "🔂 심사 중" })).toContain("🔂 심사 중");
  });

  it("관리자 이름 편집은 표시만 걷고 편집칸은 저장된 원문으로 시작한다", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(
      <GroupBlock
        name="⏹️ 준비단계"
        color="#00c875"
        tone={{ axis: "A", level: 1 }}
        columns={[]}
        rows={[]}
        presetName=""
        presetChanged={false}
        nameEditor={<GroupNameEditor boardId="b1" groupId="g-ready" name="⏹️ 준비단계" display={presentLabel} />}
      >
        <div />
      </GroupBlock>,
    ));
    const edit = host.querySelector<HTMLButtonElement>('button[aria-label="그룹 이름 편집"]')!;
    expect(edit.textContent).toBe("준비단계");
    await act(async () => edit.click());
    expect(host.querySelector<HTMLInputElement>('input[aria-label="그룹 이름"]')!.value).toBe("⏹️ 준비단계");
  });
});
