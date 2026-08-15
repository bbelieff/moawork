import { createHmac, timingSafeEqual } from "node:crypto";
import type { EsignProvider, EsignWebhookVerifier, ProviderCreateResult, VerifiedProviderEvent } from "./types.js";

export const MODUSIGN_ENV_NAMES = ["MOAWORK_MODUSIGN_API_URL", "MOAWORK_MODUSIGN_API_KEY", "MOAWORK_MODUSIGN_WEBHOOK_SECRET"] as const;

export class ModusignProvider implements EsignProvider {
  constructor(private readonly baseUrl: string, private readonly apiKey: string, private readonly fetcher: typeof fetch = fetch) {
    if (!/^https:\/\//.test(baseUrl) || !apiKey) throw new Error("Modusign provider configuration is unavailable");
  }
  async createSigningRequest(input: Parameters<EsignProvider["createSigningRequest"]>[0]): Promise<ProviderCreateResult> {
    try {
      const response = await this.fetcher(`${this.baseUrl.replace(/\/$/, "")}/documents`, {
        method: "POST", headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json", "idempotency-key": input.idempotencyKey },
        body: JSON.stringify({ templateId: input.templateId, signerReference: input.signerReference, metadata: { orgId: input.orgId, dealId: input.dealId } }),
      });
      if (!response.ok) return { ok:false, retryable:response.status===429, error:`provider_${response.status}` };
      const body=await response.json() as { documentId?:unknown; signingUrl?:unknown };
      if(typeof body.documentId!=="string" || typeof body.signingUrl!=="string" || !/^https:\/\//.test(body.signingUrl)) return {ok:false,retryable:false,error:"provider_invalid_response"};
      return {ok:true,providerDocumentId:body.documentId,signingUrl:body.signingUrl};
    } catch { return {ok:false,retryable:false,error:"provider_transport_unknown"}; }
  }
}

export class ModusignWebhookVerifier implements EsignWebhookVerifier {
  constructor(private readonly secret:string){ if(!secret) throw new Error("Modusign webhook configuration is unavailable"); }
  async verify({rawBody,signature}:{rawBody:string;signature:string}):Promise<VerifiedProviderEvent|null>{
    const hex=signature.replace(/^sha256=/i,""); if(!/^[a-f0-9]{64}$/i.test(hex)) return null;
    const expected=createHmac("sha256",this.secret).update(rawBody).digest(), actual=Buffer.from(hex,"hex");
    if(actual.length!==expected.length || !timingSafeEqual(actual,expected)) return null;
    let value:unknown; try{value=JSON.parse(rawBody);}catch{return null;} const v=value as Record<string,unknown>;
    if(typeof v.eventId!=="string"||typeof v.documentId!=="string"||typeof v.signedAt!=="string") return null;
    return {kind:v.eventType==="document.signed"?"signed":"other",eventId:v.eventId,providerDocumentId:v.documentId,occurredAt:v.signedAt};
  }
}
