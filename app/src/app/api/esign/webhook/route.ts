import { NextResponse } from "next/server";
import { applySignedPayload, parseModusignSignedPayload, verifyModusignSignature } from "@/lib/esign/webhook";

export async function POST(request: Request) {
  const secret = process.env.MOAWORK_MODUSIGN_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "webhook unavailable" }, { status: 503 });
  const rawBody = await request.text();
  if (!verifyModusignSignature(rawBody, request.headers.get("x-modusign-signature") ?? "", secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch { return NextResponse.json({ error: "invalid payload" }, { status: 400 }); }
  const signed = parseModusignSignedPayload(payload);
  if (!signed) return NextResponse.json({ accepted: false }, { status: 202 });
  const outcome = await applySignedPayload(signed);
  return NextResponse.json({ accepted: true, outcome });
}
