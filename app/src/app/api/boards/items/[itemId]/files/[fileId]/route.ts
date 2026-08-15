import { getSession } from "@/lib/auth/session";
import { createRequestBoards } from "@/lib/boards/server";
import { verifyFileToken } from "@/lib/deal/fileSignedUrl";
import { parseNoticeFile } from "@/lib/notices/official-file";

type RouteCtx = { params: Promise<{ itemId: string; fileId: string }> };
export async function GET(req: Request, { params }: RouteCtx) {
  const { itemId, fileId } = await params;
  const verified = verifyFileToken(new URL(req.url).searchParams.get("token") ?? "");
  if (!verified || verified.dealId !== itemId || verified.fileId !== fileId) return Response.json({ error: "유효하지 않거나 만료된 링크입니다" }, { status: 403 });
  const ctx = await getSession();
  const { repo } = await createRequestBoards();
  if (!(await repo.getItem(ctx, itemId))) return Response.json({ error: "파일을 찾을 수 없습니다" }, { status: 404 });
  const stored = (await repo.listValues(ctx, [itemId])).map((value) => parseNoticeFile(value.value_jsonb)).find((file) => file?.id === fileId);
  if (!stored) return Response.json({ error: "파일을 찾을 수 없습니다" }, { status: 404 });
  return new Response(Buffer.from(stored.contentB64, "base64"), { headers: { "Content-Type": stored.mimeType, "Content-Disposition": `attachment; filename="${encodeURIComponent(stored.name)}"`, "Cache-Control": "private, no-store" } });
}
