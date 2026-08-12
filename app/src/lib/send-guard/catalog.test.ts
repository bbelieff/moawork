/**
 * BBE-148 — 발송 칸 판정. 여기서 틀리면 돈이 나가거나 안 나간다.
 *
 * 가장 중요한 것은 마지막 케이스다: **구조 팩에 실제로 심긴 발송 칸이 하나라도
 * 카탈로그 밖에 있으면 실패한다.** 목업 4칸만 보고 만들면 앱에 서 있는 2칸이 무방비가 된다.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_MESSAGE_TEMPLATE_CODES } from "@/lib/messaging";
import { SEOUL_STRUCTURE_PACK } from "@/lib/structure-packs/seoul-pack";
import {
  isSendColumn,
  labelLooksLikeSendColumn,
  resolveSendColumn,
  sendColumnSpecs,
  templateCodeForValue,
  valueTriggersSend,
} from "./catalog";
import { DEFAULT_TEMPLATE_BODIES } from "./template";

const meetingSpec = sendColumnSpecs().find((s) => s.columnKey === "color8")!;

describe("발송 칸 판정", () => {
  it("카탈로그에 등록된 칸은 발송 칸이다", () => {
    expect(isSendColumn({ key: "color8" })).toBe(true);
    expect(isSendColumn({ key: "dup__of_ai___" })).toBe(true);
  });

  it("출처 메타가 msg 면 카탈로그에 없어도 발송 칸이다", () => {
    expect(isSendColumn({ key: "회사가_새로_만든_칸", source: "msg" })).toBe(true);
  });

  it("라벨에 📬·✉ 가 붙어 있으면 발송 칸이다 — 마지막 방어선", () => {
    expect(labelLooksLikeSendColumn("📬AI_4차")).toBe(true);
    expect(labelLooksLikeSendColumn("✉ 재안내")).toBe(true);
    expect(isSendColumn({ key: "unknown", label: "📬AI_4차" })).toBe(true);
  });

  it("평범한 칸은 발송 칸이 아니다", () => {
    expect(isSendColumn({ key: "person", label: "담당자", source: "act" })).toBe(false);
    expect(isSendColumn({ key: "___6", label: "계약금", source: "in" })).toBe(false);
    expect(resolveSendColumn({ key: "___6", label: "계약금", source: "in" })).toBeNull();
  });

  it("모르는 발송 칸에도 정의를 지어낸다 — 통과시키지 않는다", () => {
    const spec = resolveSendColumn({ key: "새칸", label: "📬새 안내" });
    expect(spec).not.toBeNull();
    expect(spec!.fallbackTemplateCode).toBe("custom:새칸");
    expect(valueTriggersSend(spec!, "무슨 값이든")).toBe(true);
  });
});

describe("어떤 값이 문자를 내보내는가", () => {
  it("null·빈 값·«보내기 전» 류는 나가지 않는다", () => {
    expect(valueTriggersSend(meetingSpec, null)).toBe(false);
    expect(valueTriggersSend(meetingSpec, "")).toBe(false);
    expect(valueTriggersSend(meetingSpec, "   ")).toBe(false);
    expect(valueTriggersSend(meetingSpec, "보내기 전")).toBe(false);
  });

  it("«미팅 미지정» 은 나가지 않는다 — 목업 setCell 이 빠뜨린 값이다", () => {
    // 목업은 `val!=="보내기 전" && val!=="심사 전"` 만 보므로 미지정으로 되돌려도
    // 발송으로 판정한다. 카탈로그가 이 칸의 idle 값을 따로 갖는 이유다.
    expect(valueTriggersSend(meetingSpec, "미팅 미지정")).toBe(false);
    expect(valueTriggersSend(meetingSpec, "보내기기")).toBe(true);
  });

  it("값별 템플릿 표가 있으면 표에 없는 값은 나가지 않는다", () => {
    const absence = sendColumnSpecs().find((s) => s.columnKey === "color_mm3acc4d")!;
    // 「1일 1회 전화」는 사내 처리 지침이지 고객에게 나가는 문구가 아니다.
    expect(valueTriggersSend(absence, "1일 1회 전화")).toBe(false);
    expect(valueTriggersSend(absence, "2번 부재")).toBe(true);
    expect(templateCodeForValue(absence, "2번 부재")).toBe("absence-simple-2");
  });
});

describe("카탈로그와 다른 정의의 대조", () => {
  it("템플릿 코드는 @/lib/messaging 의 기본 코드와 어긋나지 않는다", () => {
    const known = new Set(Object.values(DEFAULT_MESSAGE_TEMPLATE_CODES));
    const used = new Set(
      sendColumnSpecs().flatMap((s) => [
        ...Object.values(s.templateByValue ?? {}),
        s.fallbackTemplateCode,
      ]),
    );
    // 겹치는 코드는 문자열이 같아야 한다. 새로 생긴 코드(consultation-rejected)는
    // messaging 쪽에 아직 없으므로 «겹치는 것만» 본다.
    for (const code of used) {
      if (code.startsWith("consultation-rejected") || code.startsWith("custom:")) continue;
      expect(known.has(code), `messaging 에 없는 코드: ${code}`).toBe(true);
    }
  });

  it("쓰는 템플릿 코드에는 전부 기본 문구가 있다", () => {
    for (const spec of sendColumnSpecs()) {
      const codes = [...Object.values(spec.templateByValue ?? {}), spec.fallbackTemplateCode];
      for (const code of codes) {
        expect(DEFAULT_TEMPLATE_BODIES[code], `문구 없는 코드: ${code}`).toBeTruthy();
      }
    }
  });

  it("★ 구조 팩에 심긴 발송 칸이 카탈로그 밖에 있으면 안 된다", () => {
    const packSendColumns = SEOUL_STRUCTURE_PACK.boards.flatMap((board) =>
      board.columns
        .filter((column) => labelLooksLikeSendColumn(column.label))
        .map((column) => ({ board: board.slug, key: column.key, label: column.label })),
    );
    // 목업은 4칸이라고 세지만 앱 팩에는 6칸이 심겨 있다. 그 차이가 이 테스트의 존재 이유다.
    expect(packSendColumns.length).toBeGreaterThanOrEqual(4);

    const registered = new Set(sendColumnSpecs().map((s) => s.columnKey));
    const missing = packSendColumns.filter((c) => !registered.has(c.key));
    expect(missing, `카탈로그에 없는 발송 칸: ${JSON.stringify(missing)}`).toEqual([]);
  });
});
