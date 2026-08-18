import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// BBE-213 — 「액션이 catch 밖에서 던지면 전면 오류」를 «구조로» 막는다.
//
// 총괄 실측(운영): 보드에서 항목을 만들거나 필드를 채우면 This page couldn't load.
// BBE-201 이 그 병을 고쳤다고 했는데, 전수를 세니 **19개 중 2개만** 덮여 있었고
// 그 2개도 일부만 덮여 있었다(setCellAction 의 createRequestBoards() 가 try 밖).
//
// ★ 그래서 이 검사는 「지금 19개가 다 덮였다」가 아니라
//   **「스무 번째 액션이 생겨도 덮인다」** 를 잰다. 손으로 try/catch 를 넣는 방식이면
//   다음 액션에서 또 빠진다 — 오늘 이 저장소에서 같은 형태가 일곱 번 나왔다.

const SOURCE = readFileSync(resolve(process.cwd(), "src", "app", "(app)", "boards", "actions.ts"), "utf8")
  .replace(/\r\n/gu, "\n");

/**
 * 자기 가드를 직접 들고 있는 액션들 — 셀 단위 플래시라 보드 단위 래퍼와 다르다.
 * ★ 여기 «추가하려는 순간» 이 곧 그 액션을 래퍼로 옮겨야 하는 순간이다. 늘리지 마라.
 */
const OWN_GUARD = new Set([
  "addItemAction",        // 보드 단위 플래시 + 성공 시 이전 실패 삭제
  "setCellAction",        // 셀 아래에 사유를 붙인다(itemId·columnKey 가 필요)
  // ★ 유일한 «진짜 미가드». boardId 가 아직 없어서(보드를 만드는 중) 사유를 붙일 대상이 없다.
  //   지금도 실패하면 전면 오류가 난다 — 보드 «목록» 화면에 붙이는 별도 작업이 필요하다(후속).
  "createBoardAction",
]);

type Action = { name: string; body: string };

function actions(): Action[] {
  const lines = SOURCE.split("\n");
  const out: Action[] = [];
  lines.forEach((line, index) => {
    const match = /^export async function (\w+)\(formData: FormData\): Promise<void> \{$/.exec(line);
    if (!match) return;
    let end = lines.length;
    for (let i = index + 1; i < lines.length; i += 1) if (lines[i] === "}") { end = i; break; }
    out.push({ name: match[1], body: lines.slice(index + 1, end).join("\n") });
  });
  return out;
}

describe("BBE-213 보드 액션은 전면 오류로 새지 않는다", () => {
  it("★ 액션을 실제로 찾아낸다 — 0개를 훑고 통과하는 일이 없게", () => {
    expect(actions().length).toBeGreaterThanOrEqual(19);
  });

  // ★ 되돌리면 빨개진다: 아무 액션에서나 runBoardAction 감싸기를 걷어내기
  //   (= 스무 번째 액션을 감싸지 않고 추가하는 것과 같은 모양)
  it("★ 모든 액션이 단일 출구를 지난다 — 새 액션이 생겨도 덮인다", () => {
    const unguarded = actions()
      .filter((action) => !OWN_GUARD.has(action.name))
      .filter((action) => !/return runBoardAction\(formData, async \(\) => \{/.test(action.body))
      .map((action) => action.name);

    expect(unguarded, `runBoardAction 을 안 지나는 액션: ${unguarded.join(", ")}`).toEqual([]);
  });

  // 되돌리면 빨개진다: 자기 가드를 가진 액션에서 try 를 지우기
  it("자기 가드를 든 액션은 실제로 try 를 갖고 있다 — 목록이 면제부가 되지 않게", () => {
    for (const action of actions().filter((candidate) => OWN_GUARD.has(candidate.name))) {
      if (action.name === "createBoardAction") continue; // 붙일 boardId 자체가 없다
      expect(/\btry\s*\{/.test(action.body), `${action.name} 이 목록에만 있고 가드가 없다`).toBe(true);
    }
  });

  // ★ 되돌리면 빨개진다: 제어 흐름 되던지기를 지우기
  //   redirect/notFound 를 삼키면 로그인 이동·페이지 이동이 죽는다.
  it("★ redirect·notFound 는 삼키지 않고 되던진다", () => {
    expect(SOURCE).toMatch(/if \(isNextControlFlow\(error\)\) throw error;/u);
    expect(SOURCE).toMatch(/digest\.startsWith\("NEXT_REDIRECT"\)/u);
  });
});
