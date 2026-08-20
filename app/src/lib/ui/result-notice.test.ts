import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { noticeLive, noticeRole } from "./result-notice";

// BBE-208 — 「판정 근거를 만들어 놓고 표현이 안 읽는다」를 저장소 전체에서 고정한다.
//
// 족보: BBE-183(성공이 빨간 오류로) · BBE-193(표현이 판정을 안 읽음) ·
//       BBE-204(확인 불가와 권한 없음이 같은 404) · 이 카드(실패가 「처리됐다」로).
// 방향만 다르고 원인은 하나다.

describe("noticeRole·noticeLive — 양방향", () => {
  // 되돌리면 빨개진다: 실패를 status 로 되돌리기
  it("실패는 alert 로 끼어든다", () => {
    expect(noticeRole(false)).toBe("alert");
    expect(noticeLive(false)).toBe("assertive");
  });

  // ★ 되돌리면 빨개진다: 성공까지 alert 로 (전부 빨갛게 칠해서 도망)
  it("성공은 status 로 조용히 알린다 — 전부 alert 로 칠하는 도망도 막는다", () => {
    expect(noticeRole(true)).toBe("status");
    expect(noticeLive(true)).toBe("polite");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★ 전수 — 이 카드의 본체
//
// 4곳을 고쳐도 「그게 마지막인지」 아무도 모른다. 그래서 목록을 «테스트로» 남긴다.
//   · 「0 이어야 한다」로 쓰지 않는다 — 남은 것을 숨기려는 압력이 생긴다.
//   · «집합이 같은지» 로 쓴다 — 남은 것을 드러낸 채 고정하고, 고쳐지면 빨개져서
//     「목록에서 빼라」고 말한다. 스스로 청소되는 목록이다.
//
// ★ 훑는 범위는 app/src «전체» 다. PR #250 의 안전망이 app/src/app/ 만 봤는데,
//   실제 코드는 components/ 에 더 많이 산다(tsx 97 대 51). 사각지대가 본진이었다.
// ─────────────────────────────────────────────────────────────────────────────

const SRC = resolve(process.cwd(), "src");

/** 아직 «판정을 안 읽는» 채로 남아 있는 자리 — 각 항목에 «누가 처리 중인지» 를 적는다. */
/**
 * 아직 «판정을 안 읽는» 채로 남아 있는 자리 — 이 검사 기준으로 훑은 범위 안에서.
 *
 * ★★ 「저장소에 없다」가 아니다. **「이 기준으로 훑은 범위엔 없다」** 이다.
 *    처음엔 「이 모양의 결함이 저장소에 없다」고 적었는데 그건 사실이 아니었다 —
 *    DC-18 이 살아 있는 두 곳을 찾아냈고(그중 하나는 이 PR 이 «교과서» 라 부른
 *    WorkspaceEntry 와 같은 형태였다), 원인은 결함이 아니라 **이 검사기의 사거리** 였다.
 *
 * ★ 이 검사기가 «안 보는» 것 — 다음 사람이 여기 기대지 않도록 적어 둔다:
 *
 *   1) 판정을 **prop 으로 받는** 표현 전용 부품.
 *      아래 verdictStates() 는 파일 안의 setX(result…) 로 판정 상태를 찾는다.
 *      못 찾으면 파일을 통째로 건너뛴다 — 그런데 배너는 보통 그런 부품에 산다.
 *      (예: DashboardUnavailable 은 label 만 받아 그리므로 이 검사에 안 걸린다.)
 *   2) 판정이 **result.ok/tone 이 아닌** 형태로 표현되는 경우.
 *      예: setNavigationError("...") 처럼 «빈 문자열이면 성공» 인 관용구.
 *      WorkspaceSwitcher 가 그랬고, 이 검사기로는 영원히 안 걸린다.
 *   3) role 을 **변수로** 넘기는 경우(role={x}) — 그 x 가 판정을 읽는지는 안 본다.
 *
 * 그래서 이 목록이 비어 있다는 것은 «안심해도 된다» 가 아니라
 * «이 기준으로는 더 못 찾는다» 는 뜻이다. 새로 만들 때는 사람이 봐야 한다.
 */
const KNOWN_REMAINING: Record<string, string> = {
  // 이 기준으로 훑은 범위 안에서는 남은 자리가 없다.
  //
  // ★ 이 목록은 «스스로 청소됐다». WorkspaceChooser 가 여기 있었는데,
  //   PR #242(BBE-183)가 머지되자 CI 가 「남음: [] vs 목록: [1건]」으로 빨개져
  //   이 줄을 지우라고 말했다. 설계가 실제로 그렇게 동작했다(2026-08-18).
  //
  // 새 위반이 생기면 여기가 아니라 «테스트가» 먼저 알려준다. 손으로 추가하지 마라 —
  // 추가하려는 순간이 바로 그 결함을 고쳐야 하는 순간이다.
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * 주석을 걷어낸다.
 * ★ 결함을 «설명하는» 주석이 결함으로 잡히면 오탐이 나고, 오탐이 나면 아무도 안 쓴다.
 *   실제로 ContactPipelineAction 은 role="status" 가 주석 속 설명에 있고 코드는 이미 갈린다.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** 액션 판정에서 채워지는 상태 이름들(setX(result.message) / setX({ tone: … })). */
function verdictStates(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(/\bset([A-Z]\w*)\s*\(([^;]*?)\)\s*;/g)) {
    if (/result\.(message|ok)\b|\btone\s*:/.test(match[2])) {
      names.add(match[1][0].toLowerCase() + match[1].slice(1));
    }
  }
  return names;
}

/** 「그 판정 상태를 그리는 바로 그 줄」에 리터럴 role="status" 가 있는 자리. */
function findUnreadVerdicts(): string[] {
  const found: string[] = [];
  for (const file of walk(SRC)) {
    const source = stripComments(readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
    const states = verdictStates(source);
    if (states.size === 0) continue;

    const lines = source.split("\n");
    lines.forEach((line, index) => {
      // 양방향이다. status 고정도, alert 고정도 둘 다 «판정을 안 읽는» 것이다.
      // 성공까지 alert 로 칠하면 경고가 의미를 잃는다 — 그 도망도 여기서 막힌다.
      if (!/role="(status|alert)"/.test(line)) return;

      // ★ 한 줄만 보면 «평범한 포매팅» 에 뚫린다(DC-18 이 프로브로 잰 사각).
      //     <p role="status" className="banner">\n  {notice}\n</p>
      //   role 과 상태 표시가 다른 줄에 있으면 옛 방식은 그냥 통과시켰다.
      //   그래서 같은 JSX 요소로 볼 만한 창(뒤 6줄)까지 함께 본다.
      const window = lines.slice(index, index + 7).join("\n");
      for (const name of states) {
        if (new RegExp(`\\{\\s*${name}\\b`).test(window)) {
          found.push(file.slice(SRC.length + 1).replace(/\\/g, "/"));
          break;
        }
      }
    });
  }
  return [...new Set(found)].sort();
}

/**
 * 배너마다 «색이 판정에서 파생되는지» 를 못박는다.
 *
 * ★ role 만 고정하면 눈으로 보는 사용자는 실패를 못 알아챈다.
 *   반대로 WorkspaceEntry 는 «색만» 읽고 role 을 안 읽던 자리였다.
 *   한 채널만으로는 부족하다 — 같은 화면이 두 사용자에게 다른 사실을 말하게 된다.
 */
const VERDICT_BANNERS: Array<[string, RegExp]> = [
  // ①② 는 ResultBanner 로 그린다 — «그려진 마크업» 은 ResultBanner.test.tsx 가 재고,
  //    여기서는 «성공/실패 색을 실제로 넘기는가»(배선)를 본다. 둘 다 있어야 한다.
  ["components/workspace-entry/ApprovalQueue.tsx", /<ResultBanner notice=\{notice\} okClassName=\{styles\.status\} errorClassName=\{styles\.error\}/],
  ["components/platform/PlatformOrganizationsPanel.tsx", /<ResultBanner notice=\{notice\} okClassName=\{styles\.organizationStatus\} errorClassName=\{styles\.organizationError\}/],
  ["components/workspace-builder/CsvImportDialog.tsx", /notice\.ok \? styles\.notice : styles\.noticeError/],
  ["components/workspace-builder/BuilderWorkspaceSurface.tsx", /notice\.ok \? styles\.notice : styles\.noticeError/],
  ["components/workspace-entry/WorkspaceEntry.tsx", /notice\.tone === "error" \? styles\.error : styles\.status/],
  // ③ WorkspaceSwitcher 의 라이브영역은 «내부 state» 라 정적 렌더로는 실패쪽을 만들 수 없다.
  //    성공쪽(navigationError 없음 → status)은 WorkspaceSwitcher.test.tsx 가 «그려서» 재고,
  //    실패쪽(있음 → alert)은 여기서 배선을 못 박는다. role 을 상수로 되돌리면 빨개진다.
  ["components/workspace/WorkspaceSwitcher.tsx", /role=\{noticeRole\(!navigationError\)\}\s*\n\s*aria-live=\{noticeLive\(!navigationError\)\}/],
];

describe("전수 — 판정을 안 읽는 결과 배너", () => {
  it("★ 훑는 범위가 실제 코드가 사는 범위를 덮는다", () => {
    const files = walk(SRC);
    // app/ 만 보면 코드의 다수인 components/ 를 놓친다 — #250 이 그렇게 뚫렸다.
    expect(files.some((f) => f.includes(`${SRC}\\components`) || f.includes(`${SRC}/components`))).toBe(true);
    expect(files.some((f) => f.includes(`${SRC}\\app`) || f.includes(`${SRC}/app`))).toBe(true);
    expect(files.length).toBeGreaterThan(100);
  });

  it.each(VERDICT_BANNERS)("%s 는 색도 판정에서 파생한다", (file, pattern) => {
    const source = readFileSync(resolve(SRC, file), "utf8").replace(/\r\n/g, "\n");
    expect(source, `${file} 의 배너 색이 판정을 안 읽는다`).toMatch(pattern);
  });

  it("★ 남아 있는 자리가 «알려진 목록과 정확히 같다»", () => {
    const remaining = findUnreadVerdicts();
    const expected = Object.keys(KNOWN_REMAINING).sort();

    // 새 위반이 생겨도, 목록의 것이 고쳐져도 빨개진다.
    // 고쳐서 빨개졌다면 KNOWN_REMAINING 에서 그 줄을 지우면 된다.
    expect(remaining, `남은 자리와 목록이 어긋난다.\n남음: ${JSON.stringify(remaining)}\n목록: ${JSON.stringify(expected)}`)
      .toEqual(expected);
  });
});
