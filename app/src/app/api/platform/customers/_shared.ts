import { NextResponse } from "next/server";
import { loadPlatformActor } from "@/lib/platform/actor";
import { platformCustomerClient, type CustomerRpcClient } from "@/lib/platform/customers/server";

/**
 * 플랫폼 API 공용 문지기. 페이지 가드(requirePlatformAccess)와 같은
 * loadPlatformActor/is_platform_admin 캐논을 쓰되, API답게 리다이렉트 대신
 * 상태 코드로 답한다. DB 함수의 42501이 2차 방벽이다.
 */
export async function requirePlatformApi(
  loadActor: typeof loadPlatformActor = loadPlatformActor,
  loadClient: () => Promise<CustomerRpcClient> = platformCustomerClient,
): Promise<{ client: CustomerRpcClient } | { response: NextResponse }> {
  const actor = await loadActor();
  if (actor.kind === "denied" && actor.reason === "unauthenticated") {
    return { response: NextResponse.json({ ok: false, message: "로그인이 필요해요." }, { status: 401 }) };
  }
  if (actor.kind !== "granted") {
    const unavailable = actor.kind === "unavailable";
    return {
      response: NextResponse.json(
        { ok: false, message: unavailable ? "운영 권한을 확인할 수 없어요. 잠시 뒤 다시 시도해 주세요." : "서비스 관리자만 볼 수 있어요." },
        { status: unavailable ? 503 : 403 },
      ),
    };
  }
  try {
    return { client: await loadClient() };
  } catch {
    return { response: NextResponse.json({ ok: false, message: "연결을 확인할 수 없어요. 잠시 뒤 다시 시도해 주세요." }, { status: 503 }) };
  }
}

/** lib 결과 → HTTP. «없음»과 «못 읽음»과 «잘못된 입력»을 섞지 않는다. */
export function customerFailureResponse(failure: { reason: string; message?: string }): NextResponse {
  if (failure.reason === "denied") {
    return NextResponse.json({ ok: false, message: "서비스 관리자만 볼 수 있어요." }, { status: 403 });
  }
  if (failure.reason === "not-found") {
    return NextResponse.json({ ok: false, message: "고객사를 찾을 수 없어요. 목록을 새로 확인해 주세요." }, { status: 404 });
  }
  if (failure.reason === "invalid") {
    return NextResponse.json({ ok: false, message: failure.message ?? "입력값을 확인해 주세요." }, { status: 400 });
  }
  return NextResponse.json({ ok: false, message: "지금 확인할 수 없어요. 목록을 새로 확인한 뒤 다시 시도해 주세요." }, { status: 503 });
}
