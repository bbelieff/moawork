import type { MessageTriggerValue } from "./types";

export const DEFAULT_MESSAGE_TEMPLATE_CODES: Readonly<Record<MessageTriggerValue, string>> = {
  "간편 부재 1회": "absence-simple-1",
  "간편 부재 2회": "absence-simple-2",
  "간편 부재 3회": "absence-simple-3",
  "간편 부재 4회": "absence-simple-4",
  "간편 부재 5회": "absence-simple-5",
  "악성 부재": "absence-malicious",
  "1차 상담 안내": "consultation-first",
  "2차 확정 안내": "consultation-confirmed",
  "미팅확정 메세지": "meeting-confirmed",
};

export function templateCodeFor(value: MessageTriggerValue): string {
  return DEFAULT_MESSAGE_TEMPLATE_CODES[value];
}
