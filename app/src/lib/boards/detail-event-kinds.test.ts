import { describe, expect, it } from "vitest";
import {
  detailEventActorInitial,
  detailEventAuthorName,
  detailEventKindIndex,
  detailEventKindLabel,
  isSelectableDetailEventKind,
  SELECTABLE_DETAIL_EVENT_KINDS,
} from "./detail-event-kinds";

/**
 * #662 — 「담당자별 아이콘은 동일해야지」.
 *
 * 여기서 막지 않으면 같은 사람이 메모를 남길 때와 전화를 걸었을 때 «다른 얼굴» 로 보인다.
 * 아바타는 누구인가, 배지는 무엇인가 — 두 축이 섞이지 않는지를 잰다.
 */

describe("#662 고를 수 있는 성격", () => {
  it("넷이다 — 메모·통화·행정·미팅", () => {
    expect([...SELECTABLE_DETAIL_EVENT_KINDS]).toEqual([
      "memo",
      "call",
      "admin",
      "meeting",
    ]);
  });

  it("★ 자동(field_change)은 «고를 수 없다» — 시스템이 남기는 기록이다", () => {
    expect(isSelectableDetailEventKind("field_change")).toBe(false);
    expect(isSelectableDetailEventKind("meeting")).toBe(true);
    expect(isSelectableDetailEventKind("admin")).toBe(true);
  });

  it("모르는 값도 고를 수 없다", () => {
    expect(isSelectableDetailEventKind("무엇")).toBe(false);
  });
});

describe("#662 배지에 적는 말", () => {
  it("다섯 다 한글로 뜬다 — 고를 수 있는 넷 + 자동", () => {
    expect(detailEventKindLabel("memo")).toBe("메모");
    expect(detailEventKindLabel("call")).toBe("통화");
    expect(detailEventKindLabel("admin")).toBe("행정");
    expect(detailEventKindLabel("meeting")).toBe("미팅");
    expect(detailEventKindLabel("field_change")).toBe("자동");
  });

  it("모르는 값이면 「기록」 — 빈칸이나 영어 코드가 보이지 않게", () => {
    expect(detailEventKindLabel("something_new")).toBe("기록");
  });
});

describe("#662 미끄러지는 표시자의 칸", () => {
  it("순서대로 0·1·2·3 이다", () => {
    expect(detailEventKindIndex("memo")).toBe(0);
    expect(detailEventKindIndex("call")).toBe(1);
    expect(detailEventKindIndex("admin")).toBe(2);
    expect(detailEventKindIndex("meeting")).toBe(3);
  });

  it("고를 수 없는 값이면 첫 칸에 둔다 — 표시자가 사라지지 않게", () => {
    expect(detailEventKindIndex("field_change")).toBe(0);
    expect(detailEventKindIndex("")).toBe(0);
  });
});

describe("#662 줄 머리 이름", () => {
  it("자동 기록에는 담당자 이름을 적지 않는다 — 손으로 바꾼 것으로 읽힌다", () => {
    expect(detailEventAuthorName("field_change", "김담당")).toBe("자동 기록");
  });

  it("사람이 남긴 것은 그 사람 이름", () => {
    expect(detailEventAuthorName("call", "김담당")).toBe("김담당");
    expect(detailEventAuthorName("meeting", "김담당")).toBe("김담당");
  });

  it("이름이 없으면 「담당자」", () => {
    expect(detailEventAuthorName("memo", null)).toBe("담당자");
    expect(detailEventAuthorName("memo", "   ")).toBe("담당자");
  });
});

describe("#662 ★ 담당자 아바타 — 같은 사람이면 «성격이 달라도» 같다", () => {
  it("성격을 받지 않는다. 이름만으로 정해진다", () => {
    const memo = detailEventActorInitial("김담당");
    const call = detailEventActorInitial("김담당");
    const meeting = detailEventActorInitial("김담당");
    expect(new Set([memo, call, meeting]).size).toBe(1);
    expect(memo).toBe("김");
  });

  it("다른 사람은 다르게 보인다", () => {
    expect(detailEventActorInitial("이대표")).toBe("이");
  });

  it("앞뒤 공백은 무시한다", () => {
    expect(detailEventActorInitial("  박실장 ")).toBe("박");
  });

  it("이름이 없으면 「담」", () => {
    expect(detailEventActorInitial(null)).toBe("담");
    expect(detailEventActorInitial("")).toBe("담");
  });

  it("★ 서로게이트 쌍을 반쪽으로 자르지 않는다 — 이름은 사용자가 적는 값이다", () => {
    // "\u{1F600}" 은 코드 유닛 두 개다. name[0] 이면 깨진 반쪽이 나온다.
    expect(detailEventActorInitial("\u{1F600}대표")).toBe("\u{1F600}");
  });
});
