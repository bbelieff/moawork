/**
 * 발송 문구 템플릿과 변수 치환 (BBE-148).
 *
 * 확인 화면은 «무슨 문구가 나가는가» 를 **변수까지 치환된 실제 문장**으로 보여줘야 한다.
 * 자리표시자가 남은 문장을 보여 주면 사람은 그것이 진짜 나갈 문장인지 알 수 없다.
 *
 * ⚠ 제품 규칙(D71~D75) — 여기에 특정 회사·사람 이름을 넣지 않는다.
 * 보내는 회사 이름은 «그 워크스페이스의 이름» 에서 오고(`senderName`),
 * 업체명·대표자명은 그 건의 값에서 온다. 기본 문구는 어느 회사가 써도 말이 되어야 한다.
 */

/** 템플릿 본문에 쓰는 변수 이름. */
export const TEMPLATE_VARIABLES = ["보내는회사", "업체명", "대표자명"] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

/**
 * 기본 문구. 회사가 `message_templates` 에서 바꾸기 전까지 쓰는 값이다.
 *
 * 코드는 `@/lib/messaging/triggers` 의 `DEFAULT_MESSAGE_TEMPLATE_CODES` 와 같은 문자열이다
 * (`catalog.test.ts` 가 두 곳이 어긋나지 않는지 고정한다).
 */
export const DEFAULT_TEMPLATE_BODIES: Readonly<Record<string, string>> = {
  "absence-simple-1":
    "[{보내는회사}] {대표자명} 대표님, 문의 주신 건으로 연락드렸으나 통화가 어려워 문자 남깁니다. 편하신 시간 회신 주시면 다시 연락드리겠습니다.",
  "absence-simple-2":
    "[{보내는회사}] {대표자명} 대표님, 두 번째 연락드렸으나 닿지 않아 문자 남깁니다. 상담 원하시면 회신 부탁드립니다.",
  "absence-simple-3":
    "[{보내는회사}] {대표자명} 대표님, 여러 차례 연락드렸으나 통화가 어려웠습니다. 상담을 이어가길 원하시면 회신 주세요.",
  "absence-simple-4":
    "[{보내는회사}] {대표자명} 대표님, 연락이 닿지 않아 문자로 안내드립니다. 회신이 없으면 접수 건은 잠시 보류됩니다.",
  "absence-simple-5":
    "[{보내는회사}] {대표자명} 대표님, 마지막으로 문자 남깁니다. 상담을 원하시면 회신 주시면 바로 도와드리겠습니다.",
  "absence-malicious":
    "[{보내는회사}] {대표자명} 대표님, 접수하신 건의 상담 진행이 어려워 안내드립니다. 다시 원하시면 회신 주세요.",
  "consultation-first":
    "[{보내는회사}] {업체명} {대표자명} 대표님, 1차 상담이 마무리되었습니다. 다음 절차는 담당자가 순차적으로 안내드리겠습니다.",
  "consultation-confirmed":
    "[{보내는회사}] {업체명} {대표자명} 대표님, 심사 진행이 확정되었습니다. 필요한 서류는 담당자가 개별 안내드립니다.",
  "consultation-rejected":
    "[{보내는회사}] {업체명} {대표자명} 대표님, 이번 건은 진행이 어렵게 되었습니다. 다음 기회에 다시 도와드리겠습니다.",
  "meeting-confirmed":
    "[{보내는회사}] {업체명} {대표자명} 대표님, 미팅 일정이 확정되었습니다. 변경이 필요하시면 회신 부탁드립니다.",
};

export interface RenderedTemplate {
  /** 변수까지 치환된 문장. */
  text: string;
  /** 값이 없어 «—» 로 채운 변수. 확인 화면이 이것을 경고로 띄운다. */
  missingVariables: readonly TemplateVariable[];
  /** 등록된 기본 문구가 없는 템플릿 코드인가. 숨기지 않고 드러낸다. */
  bodyMissing: boolean;
}

const VARIABLE_PATTERN = /\{([^{}]+)\}/g;

function isTemplateVariable(name: string): name is TemplateVariable {
  return (TEMPLATE_VARIABLES as readonly string[]).includes(name);
}

/**
 * 문구 1건을 실제 문장으로 만든다.
 *
 * 값이 없는 변수는 «—» 로 남기고 `missingVariables` 에 담는다. 조용히 지우지 않는다 —
 * 「{대표자명} 대표님」이 「 대표님」이 되어 나가는 사고를 사람이 확인 화면에서 봐야 한다.
 */
export function renderTemplate(
  templateCode: string,
  values: Readonly<Partial<Record<TemplateVariable, string | null>>>,
  bodies: Readonly<Record<string, string>> = DEFAULT_TEMPLATE_BODIES,
): RenderedTemplate {
  const body = bodies[templateCode];
  if (body === undefined) {
    return {
      text: `(등록된 문구가 없습니다 — 템플릿 «${templateCode}»)`,
      missingVariables: [],
      bodyMissing: true,
    };
  }

  const missing: TemplateVariable[] = [];
  const text = body.replace(VARIABLE_PATTERN, (whole, rawName: string) => {
    const name = rawName.trim();
    if (!isTemplateVariable(name)) return whole;
    const value = values[name];
    if (value === null || value === undefined || value.trim() === "") {
      if (!missing.includes(name)) missing.push(name);
      return "—";
    }
    return value.trim();
  });

  return { text, missingVariables: missing, bodyMissing: false };
}

/** 문자 1건의 길이(자). 90자를 넘으면 LMS 로 넘어가 단가가 오른다 — 화면에 표기한다. */
export function templateLength(text: string): number {
  return [...text].length;
}

/** SMS 단문 한도(자). 초과분은 장문 요금이 붙는다. */
export const SMS_SHORT_LIMIT = 90;
