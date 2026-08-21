import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PermissionUnavailable } from "@/components/perm/PermissionUnavailable";

// BBE-204 — 「권한 없음」과 「권한을 확인 못 함」을 화면에서 구분한다.
//
// `lib/perm/guard.ts` 는 처음부터 둘을 나눠 내려보내고, 그 파일 머리에
// **「화면에서 달라야 한다」** 고 적혀 있다. 호출부가 그걸 안 읽은 것이 결함이었다.
// (BBE-183 · BBE-193 과 같은 족보 — 판정 근거를 만들어 놓고 읽지 않는다.)
//
// ★ 접근 허용 범위는 한 글자도 넓히지 않는다. 아래 테스트가 그걸 고정한다.

const boardsList = new URL("../../app/(app)/boards/page.tsx", import.meta.url);
const boardDetail = new URL("../../app/(app)/boards/[id]/page.tsx", import.meta.url);

function source(url: URL): string {
  return readFileSync(url, "utf8").split("\r\n").join("\n");
}

describe("BBE-204 권한 판정 근거를 화면이 읽는다", () => {
  // 되돌리면 빨개진다: unavailable 분기를 지우고 다시 전부 notFound() 로 접기
  it.each([
    ["boards/page.tsx", boardsList],
    ["boards/[id]/page.tsx", boardDetail],
  ])("%s 는 판정 불능을 404 로 접지 않는다", (_name, url) => {
    const text = source(url);
    expect(text).toContain('reason === "unavailable"');
    expect(text).toContain("<PermissionUnavailable />");
  });

  // ★ 되돌리면 빨개진다: 권한 없음(permission)까지 PermissionUnavailable 로 보여주기.
  // 그러면 존재 숨김이 깨지고 «권한 없는 사용자에게 자원이 있다는 사실» 이 새어 나간다.
  // 「전부 친절하게」로 도망가는 것도 막는다.
  //
  // ★ 파일에 notFound() 가 «있는지» 만 보면 안 된다(검수 지적).
  //   boards/[id] 에는 notFound() 가 셋이다 — 권한 46행 · scopedItems · NotFoundError.
  //   그래서 권한 분기만 PermissionUnavailable 로 바꿔도 나머지 둘 때문에 초록이었다.
  //   방어가 이웃 테스트에 얹혀 있으면, 이웃을 정당하게 리팩터하는 사람이
  //   자기가 존재 숨김 방어를 걷어냈다는 걸 모른다. **그 줄 자체**를 단언한다.
  it.each([
    ["boards/page.tsx", boardsList, 'if (viewPermission.kind !== "allowed") notFound();'],
    ["boards/[id]/page.tsx", boardDetail, 'if (viewTabs.kind !== "allowed") notFound();'],
  ])("%s 는 권한 없음을 여전히 notFound() 로 숨긴다", (_name, url, line) => {
    expect(source(url)).toContain(line);
  });

  // 되돌리면 빨개진다: 실패 화면에서 role="alert" 를 떼거나 성공 표현으로 바꾸기
  it("판정 불능 화면은 실패로 알린다", () => {
    const html = renderToStaticMarkup(<PermissionUnavailable />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("권한을 확인하지 못했어요");
    expect(html).not.toContain('role="status"');
  });

  // 되돌리면 빨개진다: 이 화면이 자원 정보를 흘리도록 문구를 바꾸기
  it("판정 불능 화면은 자원에 대해 아무것도 말하지 않는다 — 존재 숨김 유지", () => {
    const text = renderToStaticMarkup(<PermissionUnavailable />);
    for (const leak of ["보드", "개", "목록", "삭제"]) {
      expect(text).not.toContain(leak);
    }
  });

  // ★ 전수 목록 — 「두 곳만 고치고 나머지에 전파 안 함」을 막는다.
  // workspace-entry-server.ts 가 한 번 고치고 11곳에 안 퍼진 전례가 있다.
  // 남은 자리가 고쳐지면 이 테스트가 빨개진다 → 그때 위 목록으로 옮기고 카드를 닫는다.
  it("아직 reason 을 안 읽는 자리를 목록으로 고정한다", () => {
    const remaining = [
      // 능력(버튼 노출)만 가리는 자리 — 장애일 때 «권한이 없다» 처럼 보인다. 접근은 안 열린다.
      ["../../app/(app)/(tabs)/presets/page.tsx", 'tabPermission.kind === "allowed"'],
      ["../../app/(app)/(tabs)/presets/page.tsx", 'presetPermission.kind === "allowed"'],
      ["../campaign/server.ts", '.kind === "allowed"'],
    ] as const;

    for (const [relative, marker] of remaining) {
      const text = source(new URL(relative, import.meta.url));
      expect(text, `${relative} 가 고쳐졌다면 이 목록을 갱신하고 BBE-204 를 닫아라`).toContain(marker);
    }
  });
});
