import { createHmac, randomBytes } from "node:crypto";
import {
  MESSAGING_PROVIDER_FAILURE,
  type MessagingProvider,
  type MessagingRecord,
  type ProviderResult,
} from "./types.js";

export interface SolapiCredentials {
  apiKey: string;
  apiSecret: string;
}

export function solapiAuthorization(
  credentials: SolapiCredentials,
  date = new Date().toISOString(),
  salt = randomBytes(16).toString("hex"),
): string {
  const signature = createHmac("sha256", credentials.apiSecret)
    .update(date + salt)
    .digest("hex");
  return `HMAC-SHA256 apiKey=${credentials.apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

function formatPhone(digits: string): string {
  return digits.replace(/\D/g, "");
}

function failed(retryable: boolean): ProviderResult {
  return {
    ok: false,
    reason: retryable
      ? MESSAGING_PROVIDER_FAILURE.retry
      : MESSAGING_PROVIDER_FAILURE.failed,
    retryable,
  };
}

export class SolapiProvider implements MessagingProvider {
  constructor(
    private readonly credentials: SolapiCredentials,
    private readonly request: typeof fetch = fetch,
  ) {}

  async send(message: MessagingRecord): Promise<ProviderResult> {
    const payload: Record<string, unknown> = {
      to: formatPhone(message.toDigits),
      from: formatPhone(message.fromDigits),
      text: message.body,
      type: message.channel === "sms" ? "SMS" : "ATA",
    };
    if (message.channel === "alimtalk") {
      payload.kakaoOptions = { templateCode: message.templateCode, pfId: message.senderProfileId };
    }

    try {
      const response = await this.request("https://api.solapi.com/messages/v4/send-many/detail", {
        method: "POST",
        headers: {
          Authorization: solapiAuthorization(this.credentials),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages: [payload] }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) return failed(response.status >= 500 || response.status === 429);

      const first = (body as { messageList?: Array<{ messageId?: unknown }> } | null)?.messageList?.[0]?.messageId;
      if (typeof first !== "string" || !first) return failed(false);
      return { ok: true, providerMessageId: first };
    } catch {
      return failed(true);
    }
  }
}
