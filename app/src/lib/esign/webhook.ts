import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const ESIGN_SERVER_ENV = [
  "MOAWORK_MODUSIGN_WEBHOOK_SECRET",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

export function verifyModusignSignature(rawBody: string, signature: string, secret: string): boolean {
  const supplied = signature.replace(/^sha256=/i, "");
  if (!/^[a-f0-9]{64}$/i.test(supplied) || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const actual = Buffer.from(supplied, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export type ModusignSignedPayload = { eventId: string; documentId: string; signedAt: string; eventType: string };
export function parseModusignSignedPayload(value: unknown): ModusignSignedPayload | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.eventType !== "document.signed" || typeof v.eventId !== "string" || typeof v.documentId !== "string" || typeof v.signedAt !== "string") return null;
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(v.eventId) || !/^[A-Za-z0-9:_-]{1,128}$/.test(v.documentId) || Number.isNaN(Date.parse(v.signedAt))) return null;
  return v as ModusignSignedPayload;
}

export async function applySignedPayload(payload: ModusignSignedPayload): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("e-sign persistence is unavailable");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.rpc("apply_esign_signed_event", {
    p_event_id: payload.eventId, p_provider_document_id: payload.documentId, p_signed_at: payload.signedAt,
  });
  if (error) throw new Error("e-sign persistence failed");
  return String(data);
}
