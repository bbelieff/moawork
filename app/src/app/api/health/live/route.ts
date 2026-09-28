import { createHealthResponse } from "@/lib/operations/runtime-identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(): Response {
  return createHealthResponse("live");
}
