import type { NotificationProvider } from "../provider.js";
import { sendOk, type NotifyChannel, type NotifyMessage, type SendResult } from "../types.js";

/**
 * 스텁 프로바이더 — 실제 발송을 하지 않는다.
 *
 * 존재 이유: mod.notify 는 Phase 2(벤더)이고 벤더 계약(DI-5)이 미정이라
 * 실 발송 구현체를 만들 수 없다. 그동안 큐/핸들러/상태전이 배선을 검증할 수 있도록
 * 채널만 만족시키는 무해한 구현을 둔다. **운영에 투입 금지**.
 *
 * 실제 벤더 구현체는 이 파일이 아니라 providers/solapi.ts 등으로 추가한다.
 */
export class StubProvider implements NotificationProvider {
  readonly name = "stub";

  constructor(
    private readonly channels: readonly NotifyChannel[] = ["email", "sms", "alimtalk"],
    /** 발송 시도를 관찰할 수 있도록 주입 가능(기본은 콘솔). */
    private readonly log: (message: string) => void = (m) => console.log(m),
  ) {}

  supports(channel: NotifyChannel): boolean {
    return this.channels.includes(channel);
  }

  async send(message: NotifyMessage): Promise<SendResult> {
    // 본문·수신처는 개인정보라 로그에 남기지 않는다(식별자와 채널만).
    this.log(`[notify:stub] 발송 시뮬레이션 channel=${message.channel} messageId=${message.id}`);
    return sendOk(`stub-${message.id}`);
  }
}

/** 기본 프로바이더 구성 — 벤더 확정 전까지 스텁만 등록한다. */
export function defaultProviders(): NotificationProvider[] {
  return [new StubProvider()];
}
