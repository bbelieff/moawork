import { describe, expect, it } from "vitest";
import { eulReul, iGa, eunNeun, gwaWa, euroRo } from "./josa";
import { MEMBER_ROLES, roleLabel } from "@/lib/auth/roles";

describe("조사 — 받침을 보고 고른다", () => {
  it("받침 있으면 을·이·은·과", () => {
    expect(eulReul("구성원")).toBe("을");
    expect(iGa("팀장")).toBe("이");
    expect(eunNeun("구성원")).toBe("은");
    expect(gwaWa("팀장")).toBe("과");
  });

  it("받침 없으면 를·가·는·와", () => {
    expect(eulReul("대표")).toBe("를");
    expect(iGa("관리자")).toBe("가");
    expect(eunNeun("대표")).toBe("는");
    expect(gwaWa("관리자")).toBe("와");
  });

  /*
   * ★ 「으로/로」만 규칙이 다르다 — 받침이 ㄹ 이면 「로」다.
   *   이걸 빼먹으면 「서울으로」가 된다. 실제로 흔히 틀리는 자리다.
   */
  it("★ 으로/로 — 받침 ㄹ 은 «없음» 처럼 다룬다", () => {
    expect(euroRo("대표")).toBe("로");      // 받침 없음
    expect(euroRo("관리자")).toBe("로");    // 받침 없음
    expect(euroRo("팀장")).toBe("으로");    // ㅇ
    expect(euroRo("구성원")).toBe("으로");  // ㄴ
    expect(euroRo("서울")).toBe("로");      // ★ ㄹ
    expect(euroRo("하늘")).toBe("로");      // ★ ㄹ
  });

  /*
   * ★ 한글이 아니면 «받침 없음» 쪽으로 «일관되게» 간다.
   *   영문·숫자는 읽는 방식에 따라 갈려서 기계가 정할 수 없다(3 을 「삼」으로 읽나 「셋」으로 읽나).
   *   틀릴 바에는 한쪽으로 일관되게 틀리는 편이 읽기 낫다 — 여기서 추측하지 않는다.
   */
  it("한글이 아니면 받침 없음 쪽으로 일관되게 간다", () => {
    expect(eulReul("Admin")).toBe("를");
    expect(euroRo("CEO")).toBe("로");
    expect(iGa("2팀")).toBe("이");   // 마지막 글자가 한글이면 그걸 본다
    expect(eulReul("")).toBe("를");  // 빈 값도 터지지 않는다
  });

  it("뒤 공백은 무시한다 — 이름 끝에 공백이 붙어도 조사가 안 깨진다", () => {
    expect(euroRo("구성원  ")).toBe("으로");
    expect(eulReul("대표 ")).toBe("를");
  });

  /*
   * ★★ 이게 이 모듈이 존재하는 이유다.
   *
   *   `presentation.ts` 가 `${roleLabel(role)}로 참여하고 있어요` 라고 적어 뒀는데,
   *   네 역할 중 «둘» 이 받침으로 끝나서 「팀장로」·「구성원로」로 보였다.
   *   역할이 늘어도 안 깨지도록, 목록을 손으로 적지 않고 MEMBER_ROLES 를 돈다.
   */
  it("★ 모든 역할 이름에 조사가 붙어도 «로/으로» 가 맞다", () => {
    const wrong = MEMBER_ROLES.filter((role) => {
      const label = roleLabel(role);
      const josa = euroRo(label);
      // 받침이 있는데 「로」가 붙거나, 없는데 「으로」가 붙으면 틀린 것이다.
      const code = label.codePointAt(label.length - 1) ?? 0;
      const jong = (code - 0xac00) % 28;
      const needsEuro = jong !== 0 && jong !== 8;
      return josa !== (needsEuro ? "으로" : "로");
    });
    expect(wrong, `조사가 틀리는 역할: ${wrong.join(", ")}`).toEqual([]);
  });
});
