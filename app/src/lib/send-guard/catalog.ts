/**
 * 발송 컬럼 카탈로그 — 어떤 칸이 «✉ 발송» 인가 (BBE-148).
 *
 * ## 2026-08-12 A′ 판정 이후 키가 바뀐 이유 — DC-03 제보
 *
 * 처음 이 카탈로그는 구(舊) 먼데이 실측 컬럼 id(`color_mm3acc4d`·`color3`·`color`·
 * `dup__of_ai___` 등)로 등록돼 있었다. **A′ 판정(목업 v6 = 제품 기본 구조 · 먼데이
 * 실측 복제분 = 이관 매핑 사전으로만 보존)** 이후, 실제 워크스페이스가 쓰는 것은
 * `@/lib/default-tabs`(BBE-145·D76)의 키다 — 목업을 그대로 옮긴 새 정본이고, 먼데이
 * 실측 id 와는 이름 체계가 전혀 다르다. 옛 키로 등록해 두면 실제 셀 값이 카탈로그에
 * 하나도 안 걸려 `resolveSendColumn` 이 매번 «모르는 칸» 경로(안전하지만 값별 템플릿
 * 정밀도가 없는 fallback)로 빠진다 — 틀린 방향은 아니지만 이 카탈로그가 원래 하려던
 * «값별 템플릿을 정확히 안다» 는 일을 못 한다. 그래서 default-tabs 의 실제 키로 다시 맞춘다.
 *
 * 옛 먼데이 실측 id 는 지우지 않는다 — `@/lib/structure-packs` 자체가 그 이관 매핑
 * 사전이고 이미 보존돼 있다(A′). 이 카탈로그가 그걸 다시 들고 있을 필요는 없다.
 *
 * ## 아직 등록하지 않은 것 — 리드컨택 «미팅확정 메세지»
 *
 * `default-tabs` 에는 아직 신규리드 탭(`new-lead.ts`, BBE-145)만 있다. 리드컨택 탭은
 * BBE-149(DC-04) 가 만든다 — 그 탭이 서면 실제 키를 확인해 여기 추가한다. 그때까지는
 * `isSendColumn`/`resolveSendColumn` 의 «출처가 msg 면 발송으로 본다» 규칙이 안전망이다
 * (아래 판정 함수 설명 참고) — 안 등록됐다고 무방비는 아니다, 값별 템플릿 정밀도만 없다.
 *
 * ## 왜 «값 그대로 하드코딩» 이 아니라 카탈로그인가
 *
 * 회사가 새 발송 칸을 직접 만들 수도 있다(D09 출처=msg). 카탈로그는 «값별 템플릿을
 * 미리 아는 칸» 의 목록일 뿐이고, 모르는 칸은 **안전 우선 판정**(모르면 발송으로 본다)
 * 으로 걸러진다. 발송 칸을 일반 칸으로 잘못 보면 돈이 나가고 되돌릴 수 없지만, 일반 칸을
 * 발송 칸으로 잘못 보면 확인 창이 한 번 더 뜰 뿐이다 — 틀리는 방향을 고른다.
 */

import type { SendChannel, SendColumnSpec } from "./types";

/** default-tabs·회사 자체 제작 칸이 발송 칸 앞에 붙이는 표식. 라벨만 보고도 걸러낸다. */
const SEND_LABEL_MARKS = ["📬", "✉"] as const;

/** 「아직 안 보냄」을 뜻하는 값 — 어느 칸에서든 이 값이면 나가지 않는다. */
const UNIVERSAL_IDLE_VALUES = ["", "—", "보내기 전", "심사 전", "여부 미정", "미지정"] as const;

const SMS: SendChannel = "sms";

/**
 * 알려진 발송 컬럼. key 는 `board_columns.key` = `@/lib/default-tabs` 가 설치 시 그대로
 * 심는 값이다(「절대 바뀌면 안 된다」— `default-tabs/types.ts` 계약). 라벨은 회사가
 * 바꿀 수 있으므로 식별에 쓰지 않는다.
 *
 * 템플릿 코드는 `@/lib/messaging/triggers` 의 기본 코드와 같은 문자열을 쓴다 —
 * 두 곳이 어긋나면 `catalog.test.ts` 가 실패한다.
 */
const SPECS: readonly SendColumnSpec[] = [
  // ── 신규리드 관리 (`default-tabs/new-lead.ts`, BBE-145) ──
  {
    // 목업·default-tabs 모두 단일 컬럼이다(구 실측은 이걸 2컬럼으로 쪼개 놓았었다 —
    // BBE-145 module 주석이 정정 근거를 남겼다). idle 값은 없다 — 이 칸은 미입력(null)
    // 이 «안 보냄» 이고, 목록에 있는 값 6개는 전부 실제 발송 값이다.
    columnKey: "absence_notice",
    mockupLabel: "부재 안내",
    idleValues: UNIVERSAL_IDLE_VALUES,
    templateByValue: {
      "간편 부재 1회": "absence-simple-1",
      "간편 부재 2회": "absence-simple-2",
      "간편 부재 3회": "absence-simple-3",
      "간편 부재 4회": "absence-simple-4",
      "간편 부재 5회": "absence-simple-5",
      "악성 부재": "absence-malicious",
    },
    fallbackTemplateCode: "absence-simple-1",
    channel: SMS,
  },
  {
    columnKey: "consult1_notice",
    mockupLabel: "1차 상담 안내",
    idleValues: UNIVERSAL_IDLE_VALUES,
    templateByValue: { "1차 상담완료": "consultation-first" },
    fallbackTemplateCode: "consultation-first",
    channel: SMS,
  },
  {
    columnKey: "confirm2_notice",
    mockupLabel: "2차 확정 안내",
    idleValues: UNIVERSAL_IDLE_VALUES,
    templateByValue: { 심사확정: "consultation-confirmed" },
    fallbackTemplateCode: "consultation-confirmed",
    channel: SMS,
  },
  // ── 리드컨택 관리 — 아직 default-tabs 에 없다. BBE-149 가 세우면 실제 키로 추가한다.
  //    그 전까지는 위 파일 주석의 안전망(출처=msg 판정)이 이 칸을 대신 잡는다.
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
 * ②는 `board_columns.source` 다(BBE-123·D09, `default-tabs` 가 설치 시 그대로 심는다).
 * 카탈로그에 아직 없는 칸(리드컨택 미팅확정 메세지 등)은 이 축이 실질적인 주 판정이 된다.
 * 카탈로그는 «값별 템플릿» 을 아는 칸의 목록일 뿐, 발송 칸 여부의 유일한 판정자가 아니다.
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
  // 값별 템플릿 표가 있으면 «표에 없는 값» 은 발송하지 않는다 — 알려진 칸인데 목록에 없는
  // 값이 온 경우까지 안전 우선으로 걸러야 하기 때문이다.
  if (spec.templateByValue) return trimmed in spec.templateByValue;
  return true;
}

/** 이 값으로 나갈 템플릿 코드. */
export function templateCodeForValue(spec: SendColumnSpec, value: string): string {
  return spec.templateByValue?.[value.trim()] ?? spec.fallbackTemplateCode;
}
