/**
 * 확인표(ticket) — «사람이 확인 화면을 실제로 지났다» 를 증명하는 유일한 물건 (BBE-148).
 *
 * ## 왜 지문만으로는 부족했나
 *
 * 처음에는 계획 지문(`planFingerprint`)만으로 요청을 검증했다. 그런데 지문의 재료가
 * **전부 요청 자기 필드**라, 지문을 스스로 계산해 넣은 위조 요청이 자가일관성 검사를
 * 그냥 통과한다. 즉 그 검사는 «내용이 바뀌지 않았다» 는 말할 수 있어도
 * **«사람이 확인했다» 는 말하지 못한다.** (2026-08-12 독립 검수가 실측으로 잡았다.)
 *
 * 그래서 확인 화면을 그릴 때 서버가 확인표를 **발급**하고, 발송 요청을 만들 때 그것을
 * **한 번만 쓰고 태운다.** 확인표 id 는 서버가 만든 난수라 요청 본문만 보고는 지어낼 수 없고,
 * 한 번 쓰면 사라지므로 같은 확인으로 두 번 보낼 수도 없다.
 *
 * ```
 * 확인 화면 그릴 때   issueConfirmationTicket(store, plan, actor, now)  → 확인표
 * 사람이 확인하면     confirmSend(plan, confirmation, store)            → 확인표를 태운다
 * ```
 *
 * ⚠ 기본 저장소는 **프로세스 메모리**다. 서버가 여러 대면 발급한 인스턴스와 태우는 인스턴스가
 * 달라 실패할 수 있다. 그때는 `ConfirmationTicketStore` 를 DB·Redis 구현으로 갈아끼운다 —
 * 그러라고 포트로 뽑아 뒀다. 실패는 «못 보냄» 쪽이라 안전한 방향이다.
 */

import { randomUUID } from "node:crypto";
import type { SendPlan } from "./types";

/** 확인표 유효 시간(밀리초). 확인 화면을 열어 두고 오래 방치한 뒤 보내는 것을 막는다. */
export const TICKET_TTL_MS = 10 * 60 * 1000;

export interface ConfirmationTicket {
  /** 서버가 만든 난수. 요청 본문만 보고는 지어낼 수 없다. */
  id: string;
  /** 이 확인표가 묶인 계획. 다른 계획에 돌려쓸 수 없다. */
  planFingerprint: string;
  /** 발급받은 사람. 다른 사람이 주워 쓸 수 없다. */
  actorId: string;
  issuedAtMs: number;
  expiresAtMs: number;
}

export interface ConfirmationTicketStore {
  issue(ticket: ConfirmationTicket): void;
  /** 맞으면 **태우고** true. 이미 썼거나 만료·불일치면 false. 두 번 통과하지 않는다. */
  consume(input: { id: string; planFingerprint: string; actorId: string; nowMs: number }): boolean;
}

/** 프로세스 메모리 저장소. 만료분은 태울 때 함께 치운다. */
export function createMemoryTicketStore(): ConfirmationTicketStore {
  const tickets = new Map<string, ConfirmationTicket>();

  return {
    issue(ticket) {
      tickets.set(ticket.id, ticket);
    },
    consume({ id, planFingerprint, actorId, nowMs }) {
      for (const [key, value] of tickets) {
        if (value.expiresAtMs <= nowMs) tickets.delete(key);
      }
      const ticket = tickets.get(id);
      if (!ticket) return false;
      // 맞든 틀리든 한 번 손댄 확인표는 태운다 — 찍어 보며 맞히는 길을 남기지 않는다.
      tickets.delete(id);
      if (ticket.expiresAtMs <= nowMs) return false;
      if (ticket.planFingerprint !== planFingerprint) return false;
      if (ticket.actorId !== actorId) return false;
      return true;
    },
  };
}

let shared: ConfirmationTicketStore | null = null;

/** 앱이 쓰는 기본 저장소. 소비하는 화면은 이것을 그대로 쓰면 된다. */
export function defaultTicketStore(): ConfirmationTicketStore {
  shared ??= createMemoryTicketStore();
  return shared;
}

/** 확인 화면을 그리기 직전에 부른다. 여기서 발급한 확인표를 화면이 그대로 되돌려준다. */
export function issueConfirmationTicket(
  store: ConfirmationTicketStore,
  plan: SendPlan,
  actorId: string,
  nowMs: number,
  ttlMs: number = TICKET_TTL_MS,
): ConfirmationTicket {
  const ticket: ConfirmationTicket = {
    id: randomUUID(),
    planFingerprint: plan.fingerprint,
    actorId,
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
  };
  store.issue(ticket);
  return ticket;
}
