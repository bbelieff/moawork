import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  atLeast,
  isManager,
  isMemberRole,
  isMemberScope,
  roleLabel,
  roleLabelOrUnknown,
  scopeLabel,
  roleRank,
  MEMBER_ROLES,
  MEMBER_SCOPES,
} from "./roles";

describe("roleRank", () => {
  it("위계 순서대로 랭크를 매긴다 (owner>admin>member)", () => {
    expect(roleRank("owner")).toBeGreaterThan(roleRank("admin"));
    expect(roleRank("admin")).toBeGreaterThan(roleRank("member"));
  });

  it("멤버가 아니면(null/undefined) 0", () => {
    expect(roleRank(null)).toBe(0);
    expect(roleRank(undefined)).toBe(0);
  });
});

describe("atLeast", () => {
  it("동일 역할은 충족", () => {
    for (const r of MEMBER_ROLES) expect(atLeast(r, r)).toBe(true);
  });

  it("상위 역할은 하위 요구를 충족", () => {
    expect(atLeast("owner", "member")).toBe(true);
    expect(atLeast("admin", "member")).toBe(true);
    expect(atLeast("owner", "admin")).toBe(true);
  });

  it("하위 역할은 상위 요구를 충족하지 못함", () => {
    expect(atLeast("member", "admin")).toBe(false);
    expect(atLeast("admin", "owner")).toBe(false);
  });

  it("비멤버(null)는 어떤 요구도 충족하지 못함", () => {
    expect(atLeast(null, "member")).toBe(false);
  });
});

describe("isManager", () => {
  it("owner/admin 만 관리자", () => {
    expect(isManager("owner")).toBe(true);
    expect(isManager("admin")).toBe(true);
    expect(isManager("member")).toBe(false);
    expect(isManager(null)).toBe(false);
  });
});

describe("isMemberRole / isMemberScope", () => {
  it("유효한 역할만 통과", () => {
    expect(isMemberRole("owner")).toBe(true);
    expect(isMemberRole("viewer")).toBe(false); // 스키마에 없는 역할
    expect(isMemberRole(null)).toBe(false);
  });

  it("유효한 범위만 통과", () => {
    expect(isMemberScope("all")).toBe(true);
    expect(isMemberScope("assigned")).toBe(true);
    expect(isMemberScope("some")).toBe(false);
  });
});

/*
 * ★ 이름표가 «한 곳» 에서만 나오는지 지킨다.
 *
 * 착수 시점에 일곱 파일이 각자 역할 이름표를 적어 뒀고, 같은 역할이 네 이름으로 불렸다 —
 *   member → 멤버 · 사원 · 담당 · 구성원
 *   owner  → 소유자 · 대표
 * 그래서 한 사람이 목록 갈래에서는 「구성원」, 자리 갈래에서는 「담당」,
 * 권한표에서는 「멤버」로 보였다. 같은 화면 안에서도 갈래마다 달랐다.
 *
 * ★★ 그리고 그건 «불일치» 로 끝나지 않았다 — 개인정보 화면이 admin 을 「팀장」이라 불렀고,
 *    team_lead 는 아예 빠져서 팀장인 사람이 자기 역할을 「확인할 수 없어요」로 봤다.
 *    **손으로 적은 지도는 어긋나기만 하는 게 아니라 틀린다.**
 *
 * ★ 아래 다섯은 «이 파일 안» 만 본다. 다른 파일이 이름표를 다시 적는 것은 못 잡는다 —
 *   그건 맨 아래 «소스를 훑는» 시험이 잡는다. 둘이 하는 일이 다르다.
 */
describe("역할·범위 이름표는 여기 하나가 정본이다", () => {
  it("★ 모든 역할에 이름이 있다 — 하나라도 빠지면 그 사람은 자기 역할을 못 본다", () => {
    for (const role of MEMBER_ROLES) {
      expect(roleLabel(role), `${role} 에 이름표가 없다`).toBeTruthy();
    }
  });

  it("★ 모든 범위에 이름이 있다", () => {
    for (const scope of MEMBER_SCOPES) {
      expect(scopeLabel(scope), `${scope} 에 이름표가 없다`).toBeTruthy();
    }
  });

  it("★ 이름이 서로 겹치지 않는다 — 두 역할이 같은 말로 보이면 구별이 안 된다", () => {
    const names = MEMBER_ROLES.map(roleLabel);
    expect(new Set(names).size).toBe(names.length);
  });

  it("모르는 값은 «모름» 이다 — 빈칸으로 두면 「없음」으로 읽힌다", () => {
    expect(roleLabelOrUnknown(null)).toBe("모름");
    expect(roleLabelOrUnknown(undefined)).toBe("모름");
    expect(roleLabelOrUnknown("member")).toBe(roleLabel("member"));
  });

  it("★ 「담당」을 역할 이름으로 쓰지 않는다 — 담당자·담당 보드로 이미 쓰는 말이다", () => {
    expect(MEMBER_ROLES.map(roleLabel)).not.toContain("담당");
  });
});

/*
 * ★★ «다른 파일이 이름표를 다시 적는 것» 을 잡는다.
 *
 * 위 다섯 시험은 이 파일 안만 보므로, 다음 사람이 자기 컴포넌트에
 *   const ROLE_LABEL = { owner: "소유자", … }
 * 를 적어도 통과한다. 실제로 그렇게 여덟 파일이 흩어졌고, 그중 하나는 admin 을 「팀장」이라 불렀다.
 *
 * 그래서 소스를 훑어 «역할 이름 리터럴이 roles.ts 밖에 나타나는가» 를 본다.
 * 이름표를 다시 적으려면 그 글자를 쓸 수밖에 없으므로, 여기서 걸린다.
 *
 * ★ 열쇠 «하나» 로는 안 잡는다. `owner` 는 「이 화면의 담당 트랙」에도 쓰이고(nav-items),
 *   `admin` 은 「행정 기록」에도 쓰인다(detail-event-kinds). 그건 역할 지도가 아니다.
 *   **역할 지도는 열쇠가 둘 이상 한글에 매달린다** — 그 모양만 잡는다.
 *   오탐을 내는 시험은 다음 사람이 지워 버린다. 좁게 겨냥해야 살아남는다.
 *
 * ★★ 그리고 «모양이 셋» 이다. 처음엔 객체 지도 하나만 봤는데,
 *   **정작 이번에 고친 위반 다섯 중 넷이 삼항·if 사슬이었다.**
 *   돌연변이 검증도 하필 «잡히는 유일한 모양» 을 밟아서 「잡는다」고 착각했다.
 *
 *       지도    owner: "대표"
 *       삼항    role === "owner" ? "대표" : …
 *       if      if (role === "owner") return "대표";
 *
 * ★★★ 이 시험이 «못 잡는 것» — 믿고 방심하지 마라.
 *   검수가 16종을 대조해 실측한 결과다. 아래 모양으로 이름표를 다시 적으면 그냥 통과한다:
 *
 *       label="멤버"                    value= 가 아닌 다른 속성
 *       switch (role) { case "member":  갈래문
 *       role == "member"                === 가 아닌 ==
 *       "member" === role               좌우가 뒤집힌 것
 *       new Map([["member", "멤버"]])    Map·배열 짝
 *       const x = "멤버"; … x            변수를 한 번 거친 것
 *       한 역할만 다시 적은 파일          임계값이 «둘 이상» 이라서 (오탐을 막는 대가다)
 *       value 뒤 속성이 120자 넘는 것     `[^>\n]{0,120}` 상한. 지금 저장소 최장은 64자다
 *
 *   넓힐 수는 있지만 그만큼 오탐이 는다. **오탐 내는 시험은 다음 사람이 지운다.**
 *   그래서 여기는 «좁고 확실한» 갈래만 둔다 — 나머지는 사람이 화면을 열어 본다.
 *   실제로 이 세션에서 잡힌 위반 여섯 중 둘은 시험이 아니라 «운영 화면» 이 잡았다.
 */
describe("역할 이름표를 다른 파일이 다시 적지 않는다", () => {
  const ROLE_KEYS = ["owner", "admin", "team_lead", "member"] as const;

  function sourcesUnder(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...sourcesUnder(full));
      else if (/\.(ts|tsx)$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name)) out.push(full);
    }
    return out;
  }

  it("★ 역할 열쇠 둘 이상을 한글에 매다는 «지도» 가 roles.ts 밖에 없다", () => {
    const root = resolve(process.cwd(), "src");
    const canonical = resolve(root, "lib", "auth", "roles.ts");
    const offenders: string[] = [];

    for (const file of sourcesUnder(root)) {
      if (resolve(file) === canonical) continue;
      const source = readFileSync(file, "utf8");
      const hit = ROLE_KEYS.filter((key) =>
        [
          // ① 지도    owner: "대표"
          `\\b${key}\\s*:\\s*["'][가-힣]`,
          /*
           * ② 삼항·if 사슬 — `=== "owner"` 뒤 «같은 줄» 에 한글 리터럴이 오는 모양.
           *   `? "대표"` 도, `) return { label: "대표" }` 도 여기 걸린다.
           *   줄바꿈을 안 넘는 것이 오탐을 막는다 — 멀리 떨어진 한글은 다른 문장이다.
           */
          `===\\s*["']${key}["'][^\\n]{0,80}?["'][가-힣]`,
          /*
           * ③ 고르는 칸 — <option value="member">멤버</option>
           *   ★ 이 모양을 놓쳐서 «역할을 지정하는 드롭다운» 이 혼자 옛 이름을 쓰고 있었다.
           *     고르는 자리에서 다른 이름을 쓰면 고른 뒤 목록에 다른 말로 뜬다.
           *     운영 화면을 열어 보고서야 발견했다 — 소스 훑기가 네 번째 모양을 몰랐다.
           *
           *   ★★ 그리고 이 줄의 «첫 판» 은 두 갈래를 또 놓쳤다. 검수가 잡아 줬다:
           *         value={"member"}              중괄호로 감싼 것 — tsc 도 이 시험도 통과했다
           *         value="member" key="m">멤버   value 뒤에 속성이 더 붙은 것
           *     둘 다 «고쳐 놓은 버그를 그대로 되돌릴 수 있는» 유효한 코드다.
           *     그래서 따옴표 앞의 중괄호를 허용하고(`\{\s*`), 닫는 `>` 까지
           *     같은 태그 안이면 무엇이 오든 넘어가게 한다(`[^>\n]`).
           *
           *   ★ 여기 «오탐이 없다» 고 적지 마라 — 처음에 그렇게 적었다가 검수가 반증했다.
           *     `[^>\n]` 는 태그 안에 머무는 게 맞지만, 그 뒤 `>` 를 삼키고 나오는
           *     `\s*` 에는 **줄바꿈이 들어간다.** 그래서 «자기완결 태그» 뒤 형제 텍스트까지 닿는다:
           *
           *         <input name="filter" value="admin" /> 관리 기록만 보기
           *         → 걸린다. 그런데 여기 `admin` 은 역할이 아니고 뒷말도 이름표가 아니다.
           *
           *     저장소에 그런 코드가 지금 0건이라 실제 위반은 0이고, 임계값이 «둘 이상» 이라
           *     한 건으로는 안 터진다. **하지만 오탐이 «불가능한» 것은 아니다.**
           *     이 줄을 믿고 패턴을 더 넓히면 그때는 진짜로 터진다.
           */
          `value=(?:["']|\\{\\s*["'])${key}["']\\s*\\}?[^>\\n]{0,120}>\\s*[가-힣]`,
        ].some((pattern) => new RegExp(pattern, "u").test(source)),
      );
      if (hit.length >= 2) offenders.push(`${file.replace(root, "src")} — ${hit.join(", ")}`);
    }

    expect(offenders, `이름표는 lib/auth/roles.ts 하나에서만 나와야 한다:\n${offenders.join("\n")}`).toEqual([]);
  });
});
