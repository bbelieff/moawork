import { NextResponse } from "next/server";
import { loadPlatformActor } from "@/lib/platform/actor";
import { isCustomerId } from "@/lib/platform/customers/contracts";
import {
  platformCustomerClient,
  writeCustomerTask,
  writeCustomerTaskStatus,
  type CustomerRpcClient,
} from "@/lib/platform/customers/server";
import { customerFailureResponse, requirePlatformApi } from "../../_shared";

type Deps = {
  loadActor?: typeof loadPlatformActor;
  loadClient?: () => Promise<CustomerRpcClient>;
};

function badId(): NextResponse {
  return NextResponse.json({ ok: false, message: "고객사를 찾을 수 없어요. 목록을 새로 확인해 주세요." }, { status: 404 });
}

export async function handleTaskCreate(
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
  // taskId는 호출자가 만든 멱등 키다. 없으면 만들고, 있으면 그 요청을 재사용한다.
  const taskId = typeof body.taskId === "string" && isCustomerId(body.taskId) ? body.taskId : null;
  if (!taskId) {
    return NextResponse.json({ ok: false, message: "작업 식별자를 확인해 주세요." }, { status: 400 });
  }
  if (typeof body.title !== "string" || typeof body.kind !== "string") {
    return NextResponse.json({ ok: false, message: "작업 내용과 구분을 입력해 주세요." }, { status: 400 });
  }
  const gate = await requirePlatformApi(loadActor, loadClient);
  if ("response" in gate) return gate.response;
  const result = await writeCustomerTask(gate.client, orgId, { taskId, title: body.title, kind: body.kind });
  if (!result.ok) return customerFailureResponse(result);
  if (!("created" in result)) return customerFailureResponse({ reason: "unavailable" });
  return NextResponse.json({ ok: true, created: result.created, taskId: result.taskId }, { status: result.created ? 201 : 200 });
}

export async function handleTaskStatus(
  orgId: string,
  taskId: string,
  request: Request,
  { loadActor = loadPlatformActor, loadClient = platformCustomerClient }: Deps = {},
): Promise<NextResponse> {
  if (!isCustomerId(orgId) || !isCustomerId(taskId)) return badId();
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "입력값을 확인해 주세요." }, { status: 400 });
  }
  const body = payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  if (typeof body.status !== "string") {
    return NextResponse.json({ ok: false, message: "작업 상태를 확인해 주세요." }, { status: 400 });
  }
  const gate = await requirePlatformApi(loadActor, loadClient);
  if ("response" in gate) return gate.response;
  const result = await writeCustomerTaskStatus(gate.client, orgId, taskId, body.status);
  if (!result.ok) return customerFailureResponse(result);
  if (!("changed" in result)) return customerFailureResponse({ reason: "unavailable" });
  return NextResponse.json({ ok: true, changed: result.changed });
}
