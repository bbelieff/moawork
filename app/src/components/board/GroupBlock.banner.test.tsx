// @vitest-environment jsdom
/**
 * #839 (대표 지시 2026-10-06) — 그룹 머리말 «색 띠» 복원.
 * v17(#761)은 html 단계 변수로 띠를 8px 점으로 줄였다. 이제 GroupBlock 이 그룹색 틴트·3px 레일·
 * 그룹색을 섞은 진한 제목을 인라인으로 그리고, 색이 없는 그룹은 id 로 고정된 자동색을 쓴다.
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
import { pickPaletteColor } from "@/lib/boards/status-palette";
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

describe("GroupBlock 색 띠 (#839)", () => {
  it("저장된 그룹색으로 틴트 띠·3px 레일·AA 제목색을 그리고 행 줄무늬용 변수를 단다", () => {
    const markup = html({ color: "#9CD326", colorKey: "g-review" });
    expect(markup).toContain("--mw-group-accent:#9cd326");
    expect(markup).toContain("background-color:color-mix(in srgb, #9cd326 14%, var(--mw-card))");
    expect(markup).toContain("border-left:3px solid #9cd326");
    expect(markup).toContain("color:color-mix(in srgb, #9cd326 40%, var(--mw-fg))");
    // v17 의 «점만» 변수로 되돌리지 않는다.
    expect(markup).not.toContain("--mw-group-header-bg");
    expect(markup).not.toContain("--mw-group-title-ink");
  });

  it("색이 없으면 그룹 id 로 고정된 자동색 — 이름이 바뀌어도 같은 색, hex 가 아닌 값은 버린다", () => {
    const auto = pickPaletteColor("g-new");
    expect(html({ colorKey: "g-new" })).toContain(`--mw-group-accent:${auto}`);
    expect(html({ colorKey: "g-new", name: "다른 이름" })).toContain(`--mw-group-accent:${auto}`);
    const injected = html({ colorKey: "g-new", color: "red;background:url(x)" });
    expect(injected).toContain(`--mw-group-accent:${auto}`);
    expect(injected).not.toContain("url(x)");
    // 안정 키도 없는 «그룹 없음» 은 중립색.
    expect(html({ colorKey: null })).toContain("--mw-group-accent:var(--mw-sub)");
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
        colorKey="g-ready"
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
