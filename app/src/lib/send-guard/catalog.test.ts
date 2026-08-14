/**
 * BBE-148 — 발송 칸 판정. 여기서 틀리면 돈이 나가거나 안 나간다.
 *
 * 2026-08-12 A′ 판정 이후 정본이 `@/lib/structure-packs`(먼데이 실측 — 이관 매핑 사전으로만
 * 보존)에서 `@/lib/default-tabs`(BBE-145 · 목업 v6 를 그대로 옮긴 제품 기본 구조)로 바뀌었다.
 * 이 파일도 그에 맞춰 검증 대상을 바꿨다 — 더는 구조 팩 발송 칸을 세지 않는다.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_MESSAGE_TEMPLATE_CODES } from "@/lib/messaging";
import {
  isSendColumn,
  labelLooksLikeSendColumn,
  resolveSendColumn,
  sendColumnSpecs,
  templateCodeForValue,
  valueTriggersSend,
} from "./catalog";
import { DEFAULT_TEMPLATE_BODIES } from "./template";

const absenceSpec = sendColumnSpecs().find((s) => s.columnKey === "absence_notice")!;

describe("발송 칸 판정", () => {
  it("카탈로그에 등록된 칸은 발송 칸이다", () => {
    expect(isSendColumn({ key: "absence_notice" })).toBe(true);
    expect(isSendColumn({ key: "consult1_notice" })).toBe(true);
    expect(isSendColumn({ key: "confirm2_notice" })).toBe(true);
    expect(isSendColumn({ key: "meeting_confirm_message" })).toBe(true);
  });

  it("출처 메타가 msg 면 카탈로그에 없어도 발송 칸이다 — 회사가 만든 칸도 안전망이 잡는다", () => {
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
    const spec = sendColumnSpecs().find((s) => s.columnKey === "consult1_notice")!;
    expect(valueTriggersSend(spec, null)).toBe(false);
    expect(valueTriggersSend(spec, "")).toBe(false);
    expect(valueTriggersSend(spec, "   ")).toBe(false);
    expect(valueTriggersSend(spec, "보내기 전")).toBe(false);
    expect(valueTriggersSend(spec, "1차 상담완료")).toBe(true);
  });

  it("값별 템플릿 표가 있으면 표에 없는 값은 나가지 않는다", () => {
    // absence_notice(부재 안내)는 default-tabs 에서 6개 값 전부가 실발송 값이다 —
    // 「미입력(null)」이 유일한 idle 상태다(BBE-145 module 주석 근거).
    expect(valueTriggersSend(absenceSpec, "간편 부재 3회")).toBe(true);
    expect(valueTriggersSend(absenceSpec, "악성 부재")).toBe(true);
    expect(valueTriggersSend(absenceSpec, "표에 없는 값")).toBe(false);
    expect(templateCodeForValue(absenceSpec, "간편 부재 3회")).toBe("absence-simple-3");
    expect(templateCodeForValue(absenceSpec, "악성 부재")).toBe("absence-malicious");
  });

  it("리드컨택 미팅확정 값은 공용 meeting-confirmed 템플릿만 연다", () => {
    const spec = sendColumnSpecs().find((s) => s.columnKey === "meeting_confirm_message")!;
    expect(valueTriggersSend(spec, "미팅 미지정")).toBe(false);
    expect(valueTriggersSend(spec, "보내기기")).toBe(true);
    expect(valueTriggersSend(spec, "알 수 없는 값")).toBe(false);
    expect(templateCodeForValue(spec, "보내기기")).toBe("meeting-confirmed");
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
    for (const code of used) {
      if (code.startsWith("custom:")) continue;
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

  /**
   * ★ default-tabs 신규리드 탭의 발송 칸 3개(BBE-145)가 카탈로그에 전부 있는가.
   *
   * BBE-145(PR #170)가 아직 미병합이라 `@/lib/default-tabs/new-lead`를 여기서 import 할
   * 수 없다 — 파일이 이 브랜치 트리에 없다. 그래서 지금은 실제 소스(origin/
   * claude/bbe-145-new-lead-tab, 2026-08-12 확인)에서 직접 읽은 key·값을 하드코딩해
   * 대조한다. **#170 이 머지되면 이 테스트를 `default-tabs/new-lead`를 직접 import 하는
   * 살아있는 대조로 승격해야 한다** — 지금의 하드코딩은 그 전까지의 임시 다리다.
   */
  it("★ default-tabs 신규리드 탭 발송 칸 3개가 카탈로그에 전부 있다 (BBE-145 대조)", () => {
    const NEW_LEAD_SEND_KEYS = ["absence_notice", "consult1_notice", "confirm2_notice"];
    const registered = new Set(sendColumnSpecs().map((s) => s.columnKey));
    const missing = NEW_LEAD_SEND_KEYS.filter((key) => !registered.has(key));
    expect(missing, `카탈로그에 없는 발송 칸: ${JSON.stringify(missing)}`).toEqual([]);
  });

  it("★ default-tabs 리드컨택 발송 칸은 카탈로그에 등록돼 있다 (BBE-149 대조)", async () => {
    const { CONTACT_TAB } = await import("@/lib/default-tabs/contact");
    const sendKeys = CONTACT_TAB.columns.filter((column) => column.source === "msg").map((column) => column.key);
    const registered = new Set(sendColumnSpecs().map((spec) => spec.columnKey));
    expect(sendKeys).toEqual(["meeting_confirm_message"]);
    expect(sendKeys.filter((key) => !registered.has(key))).toEqual([]);
  });
});
