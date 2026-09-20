import { NextResponse } from "next/server";
import { parseSupporterMode } from "@/lib/supporter/contracts";
import { loadSupporterStatus } from "@/lib/supporter/status";

/**
 * GET /api/supporter/status?mode=user|operations
 *
 * 서포터 패널이 서버 검증 컨텍스트를 받는 유일한 통로다.
 * mode 는 strict 파싱(단일·정확 일치)이며, 성공·실패 모두 no-store 다.
 * 성공 본문은 최소 메타데이터만 둔다. 다른 세션·회사 데이터·서비스
 * 자격증명은 어떤 경우에도 출력하지 않는다.
 */
function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const modes = url.searchParams.getAll("mode");
  const mode = modes.length === 1 ? parseSupporterMode(modes[0]) : null;
  if (!mode) {
    return noStore(
      NextResponse.json({ error: "mode_invalid" }, { status: 400 }),
    );
  }
  const result = await loadSupporterStatus(mode);
  if (!result.ok) {
    return noStore(
      NextResponse.json({ error: result.error }, { status: result.httpStatus }),
    );
  }
  return noStore(NextResponse.json({ status: result.status }));
}
