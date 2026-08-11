import { requireCtx, jsonOk, readJson, toErrorResponse } from "@/lib/crm";
import { quickCreate, searchWorkspace } from "@/lib/search/service";
import { SEARCH_KINDS, type RecentRef } from "@/lib/search/types";

function parseRecent(raw: string | null): RecentRef[] {
  if (!raw) return [];
  const kinds = new Set<string>(SEARCH_KINDS);
  return raw.split(",").slice(0, 12).flatMap((token) => {
    const separator = token.indexOf(":");
    const kind = token.slice(0, separator);
    const id = token.slice(separator + 1);
    return separator > 0 && kinds.has(kind) && id ? [{ kind: kind as RecentRef["kind"], id }] : [];
  });
}

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const params = new URL(req.url).searchParams;
    return jsonOk(await searchWorkspace(ctx, params.get("q"), parseRecent(params.get("recent"))));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const body = await readJson(req) as Record<string, unknown>;
    if ((body.kind !== "deal" && body.kind !== "company") || typeof body.title !== "string") {
      return new Response(JSON.stringify({ error: "만들 항목과 이름을 확인해 주세요" }), { status: 400, headers: { "content-type": "application/json" } });
    }
    return jsonOk(await quickCreate(ctx, { kind: body.kind, title: body.title }), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
