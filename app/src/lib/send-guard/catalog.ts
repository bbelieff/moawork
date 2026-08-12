/**
 * 발송 컬럼 카탈로그 — 어떤 칸이 «✉ 발송» 인가 (BBE-148).
 *
 * ## 왜 «컬럼 4개» 를 그냥 하드코딩하지 않는가
 *
 * 목업 정본의 발송 칸은 4개다. 그런데 **앱 구조 팩(먼데이 실측)에는 6개**다 —
 * 목업이 «부재 메세지»·«악성부재 메세지전달» 을 «부재 안내» 하나로 합치고
 * «AI_3차불가» 를 뺐기 때문이다(qa-app.mjs 가 세는 차이의 일부).
 *
 * 목업 4개만 등록하면 **지금 앱에 실제로 서 있는 발송 칸 2개가 무방비로 남는다.**
 * 그래서 카탈로그는 6개를 모두 담고, 그 위에 **모르는 칸은 발송으로 본다**는
 * 안전 우선 판정을 얹는다. 발송 칸을 일반 칸으로 잘못 보면 돈이 나가고 되돌릴 수 없지만,
 * 일반 칸을 발송 칸으로 잘못 보면 확인 창이 한 번 더 뜰 뿐이다. 틀리는 방향을 고른다.
 */

import type { SendChannel, SendColumnSpec } from "./types";

/** 목업·먼데이가 발송 칸 앞에 붙이는 표식. 라벨만 보고도 걸러낸다. */
const SEND_LABEL_MARKS = ["📬", "✉"] as const;

/** 「아직 안 보냄」을 뜻하는 값 — 어느 칸에서든 이 값이면 나가지 않는다. */
const UNIVERSAL_IDLE_VALUES = ["", "—", "보내기 전", "심사 전", "여부 미정", "미지정"] as const;

const SMS: SendChannel = "sms";

/**
 * 알려진 발송 컬럼. key 는 `board_columns.key`(먼데이 컬럼 id 를 그대로 승계한 값)다.
 * 라벨은 회사가 바꿀 수 있으므로 식별에 쓰지 않는다.
 *
 * 템플릿 코드는 `@/lib/messaging/triggers` 의 기본 코드와 같은 문자열을 쓴다 —
 * 두 곳이 어긋나면 `catalog.test.ts` 가 실패한다.
 */
const SPECS: readonly SendColumnSpec[] = [
  // ── 신규리드 관리 ──
  {
    // 목업 «부재 안내» 의 앞쪽 절반. 값마다 다른 템플릿이 나간다.
    columnKey: "color_mm3acc4d",
    mockupLabel: "부재 안내",
    idleValues: UNIVERSAL_IDLE_VALUES,
    templateByValue: {
      "1번 부재": "absence-simple-1",
      "2번 부재": "absence-simple-2",
      "3번 부재": "absence-simple-3",
      "4번 부재": "absence-simple-4",
      "간편 부재 1회": "absence-simple-1",
      "간편 부재 2회": "absence-simple-2",
      "간편 부재 3회": "absence-simple-3",
      "간편 부재 4회": "absence-simple-4",
      "간편 부재 5회": "absence-simple-5",
      // 「1일 1회 전화」는 사내 처리 지침이지 고객에게 나가는 문구가 아니다 → 미발송.
    },
    fallbackTemplateCode: "absence-simple-1",
    channel: SMS,
  },
  {
    // 목업 «부재 안내» 의 뒤쪽 절반(악성 부재).
    columnKey: "color3",
    mockupLabel: "부재 안내(악성)",
    idleValues: UNIVERSAL_IDLE_VALUES,
    templateByValue: { "부재 메세지 전달": "absence-malicious", "악성 부재": "absence-malicious" },
    fallbackTemplateCode: "absence-malicious",
    channel: SMS,
  },
  {
    columnKey: "color",
    mockupLabel: "1차 상담 안내",
    idleValues: UNIVERSAL_IDLE_VALUES,
    templateByValue: { "1차 상담완료": "consultation-first" },
    fallbackTemplateCode: "consultation-first",
    channel: SMS,
  },
  {
    columnKey: "dup__of_ai___",
    mockupLabel: "2차 확정 안내",
    idleValues: UNIVERSAL_IDLE_VALUES,
    templateByValue: { 심사확정: "consultation-confirmed" },
    fallbackTemplateCode: "consultation-confirmed",
    channel: SMS,
  },
  {
    // 목업에는 없고 앱 팩에만 있는 칸. 등록하지 않으면 무방비로 남는다.
    columnKey: "dup__of_ai_2___",
    mockupLabel: "3차 불가 안내",
    idleValues: UNIVERSAL_IDLE_VALUES,
    templateByValue: { 심사거절: "consultation-rejected" },
    fallbackTemplateCode: "consultation-rejected",
    channel: SMS,
  },
  // ── 리드컨택 관리 ──
  {
    columnKey: "color8",
    mockupLabel: "미팅확정 메세지",
    // 「미팅 미지정」이 이 칸의 «보내기 전» 이다. 목업 setCell 은 이 값을 빠뜨려
    // 미지정으로 되돌려도 발송으로 판정한다 — 여기서 고친다.
    idleValues: [...UNIVERSAL_IDLE_VALUES, "미팅 미지정"],
    templateByValue: { 보내기기: "meeting-confirmed", 보내기: "meeting-confirmed" },
    fallbackTemplateCode: "meeting-confirmed",
    channel: SMS,
  },
];

const BY_KEY: ReadonlyMap<string, SendColumnSpec> = new Map(SPECS.map((s) => [s.columnKey, s]));

/** 카탈로그 전체. 테스트와 문서가 이 목록을 센다. */
export function sendColumnSpecs(): readonly SendColumnSpec[] {
  return SPECS;
}

/** 라벨이 발송 표식(📬·✉)을 달고 있는가 — 카탈로그에 없는 칸의 마지막 방어선. */
export function labelLooksLikeSendColumn(label: string): boolean {
  return SEND_LABEL_MARKS.some((mark) => label.includes(mark));
}

/**
 * 이 컬럼이 발송 칸인가. **판단 근거는 세 가지이고, 하나라도 걸리면 발송으로 본다.**
 *
 * ① 카탈로그 등록  ② 출처 메타가 `msg`  ③ 라벨에 📬·✉ 가 붙어 있음
 *
 * ②는 `board_columns.source` 다(BBE-123). 회사가 새로 만든 발송 칸은 카탈로그에 없으므로
 * 이 축이 실질적인 주 판정이 된다. 카탈로그는 «값별 템플릿» 을 아는 칸의 목록이다.
 */
export function isSendColumn(column: {
  key: string;
  label?: string;
  source?: string | null;
}): boolean {
  if (BY_KEY.has(column.key)) return true;
  if (column.source === "msg") return true;
  return column.label ? labelLooksLikeSendColumn(column.label) : false;
}

/**
 * 발송 칸의 정의를 찾는다. 카탈로그에 없으면 **안전한 기본값을 지어낸다** —
 * 모르는 칸이라고 통과시키지 않는다. 템플릿을 모르면 값 자체를 코드로 쓰고,
 * 그 사실은 미리보기에 드러난다(`template.ts` 가 미등록 템플릿을 숨기지 않는다).
 */
export function resolveSendColumn(column: {
  key: string;
  label?: string;
  source?: string | null;
}): SendColumnSpec | null {
  const known = BY_KEY.get(column.key);
  if (known) return known;
  if (!isSendColumn(column)) return null;
  return {
    columnKey: column.key,
    mockupLabel: column.label ?? column.key,
    idleValues: UNIVERSAL_IDLE_VALUES,
    fallbackTemplateCode: `custom:${column.key}`,
    channel: SMS,
  };
}

/** 이 값이 실제로 문자를 내보내는 값인가. null·빈 문자열·«보내기 전» 류는 아니다. */
export function valueTriggersSend(spec: SendColumnSpec, value: string | null): boolean {
  if (value === null) return false;
  const trimmed = value.trim();
  if (trimmed === "") return false;
  if (spec.idleValues.includes(trimmed)) return false;
  // 값별 템플릿 표가 있으면 «표에 없는 값» 은 발송하지 않는다.
  // 「1일 1회 전화」처럼 사내 지침용 선택지가 섞여 있기 때문이다.
  if (spec.templateByValue) return trimmed in spec.templateByValue;
  return true;
}

/** 이 값으로 나갈 템플릿 코드. */
export function templateCodeForValue(spec: SendColumnSpec, value: string): string {
  return spec.templateByValue?.[value.trim()] ?? spec.fallbackTemplateCode;
}
