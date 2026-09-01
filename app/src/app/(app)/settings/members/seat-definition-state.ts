// 역할 정의서 저장의 «상태 모양» 과 «적은 줄을 읽는 법» — 순수 모듈 (#683).
//
// ★ 왜 액션 파일에서 여기로 나왔나
//   `"use server"` 파일은 **모든 export 가 async 함수여야** 한다. 상수나 동기 함수를 하나라도
//   내보내면 Next 가 그 페이지의 서버 액션 로더를 평가할 때 통째로 터진다:
//     A "use server" file can only export async functions, found object.
//
//   같은 함정을 `(app)/boards/trash-action-state.ts` 가 이미 파일로 남겨 뒀다. 그 파일이
//   적어 둔 대로 «규칙» 이 아니라 «파일» 로 막는다 — 여기 두는 한 액션 파일이 어길 수 없다.

import { parseSeatDuties, type SeatDuty } from "@/lib/org/seat-definitions";

export type SeatDefinitionState = Readonly<{ ok: boolean; message: string }>;

export const SEAT_DEFINITION_IDLE: SeatDefinitionState = { ok: false, message: "" };

const CYCLE: Record<string, SeatDuty["cycle"]> = { 매일: "daily", 매주: "weekly", 매월: "monthly" };

function lines(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** 「매일: 아침에 뷰부터」 처럼 적은 줄을 할 일로 읽는다. 앞말이 없으면 매일로 둔다. */
export function parseDutyLines(raw: FormDataEntryValue | null): SeatDuty[] {
  return parseSeatDuties(
    lines(raw).map((line) => {
      const match = line.match(/^(매일|매주|매월)\s*[:：]\s*(.+)$/u);
      return match ? { cycle: CYCLE[match[1]], text: match[2] } : { cycle: "daily", text: line };
    }),
  );
}

/** 여러 줄을 그대로 목록으로 — 판단 기준(올린다/직접 한다/손대지 않는다) 세 칸이 쓴다. */
export function parseRuleLines(raw: FormDataEntryValue | null): string[] {
  return lines(raw);
}

/** 한 칸짜리 글. 비면 null 이다 — «빈 문자열» 과 «안 적음» 을 서버에서 갈라 보게 한다. */
export function trimmedText(raw: FormDataEntryValue | null, max: number): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;
  return value.slice(0, max);
}
