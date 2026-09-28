import { NextResponse } from "next/server";
import { loadPlatformActor } from "@/lib/platform/actor";
import { isCustomerId } from "@/lib/platform/customers/contracts";
import {
  platformCustomerClient,
  readPlatformCustomerDetail,
  writeCustomerInvite,
  writeCustomerSetup,
  type CustomerRpcClient,
} from "@/lib/platform/customers/server";
import { customerFailureResponse, requirePlatformApi } from "../_shared";

type Deps = {
  loadActor?: typeof loadPlatformActor;
  loadClient?: () => Promise<CustomerRpcClient>;
};

function badId(): NextResponse {
  return NextResponse.json({ ok: false, message: "고객사를 찾을 수 없어요. 목록을 새로 확인해 주세요." }, { status: 404 });
}

export async function handleCustomerDetail(
  orgId: string,
  { loadActor = loadPlatformActor, loadClient = platformCustomerClient }: Deps = {},
): Promise<NextResponse> {
  if (!isCustomerId(orgId)) return badId();
  const gate = await requirePlatformApi(loadActor, loadClient);
  if ("response" in gate) return gate.response;
  const result = await readPlatformCustomerDetail(gate.client, orgId);
  if (!result.ok) return customerFailureResponse(result);
  return NextResponse.json({ ok: true, customer: result.customer, tasks: result.tasks, history: result.history });
}

export async function handleCustomerPatch(
  orgId: string,
  request: Request,
  { loadActor = loadPlatformActor, loadClient = platformCustomerClient }: Deps = {},
): Promise<NextResponse> {
  if (!isCustomerId(orgId)) return badId();
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "입력값을 확인해 주세요." }, { status: 400 });
  }
  const body = payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const hasSetup = typeof body.setupStatus === "string";
  const hasInvite = typeof body.inviteState === "string";
  // 한 번에 한 축만 바꾼다 — 두 축이 섞이면 어느 이력이 어느 변경인지 흐려진다.
  if (hasSetup === hasInvite) {
    return NextResponse.json({ ok: false, message: "도입 상태와 초대 중 하나만 보내 주세요." }, { status: 400 });
  }
  const gate = await requirePlatformApi(loadActor, loadClient);
  if ("response" in gate) return gate.response;
  const result = hasSetup
    ? await writeCustomerSetup(gate.client, orgId, body.setupStatus as string)
    : await writeCustomerInvite(gate.client, orgId, body.inviteState as string);
  if (!result.ok) return customerFailureResponse(result);
  if ("created" in result) return NextResponse.json({ ok: true, created: result.created, taskId: result.taskId });
  return NextResponse.json({ ok: true, changed: result.changed });
}
