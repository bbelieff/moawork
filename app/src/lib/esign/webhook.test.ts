import { createHmac } from "node:crypto";
import { describe,expect,it } from "vitest";
import { parseModusignSignedPayload,verifyModusignSignature } from "./webhook";
describe("Modusign webhook boundary",()=>{it("fails closed and accepts only signed valid payloads",()=>{const raw='{"eventType":"document.signed","eventId":"e1","documentId":"d1","signedAt":"2026-08-15T00:00:00Z"}',sig=createHmac("sha256","secret").update(raw).digest("hex");expect(verifyModusignSignature(raw,sig,"secret")).toBe(true);expect(verifyModusignSignature(raw+" ",sig,"secret")).toBe(false);expect(parseModusignSignedPayload(JSON.parse(raw))).toMatchObject({eventId:"e1"});expect(parseModusignSignedPayload({...JSON.parse(raw),eventType:"opened"})).toBeNull();});});
