import { NextResponse } from "next/server";
import { loadPlatformActor } from "@/lib/platform/actor";
import { parseCustomerListQuery } from "@/lib/platform/customers/contracts";
import {
  platformCustomerClient,
  readPlatformCustomerList,
  type CustomerRpcClient,
} from "@/lib/platform/customers/server";
import { customerFailureResponse, requirePlatformApi } from "./_shared";

export async function handleCustomerList(
  request: Request,
  loadActor: typeof loadPlatformActor = loadPlatformActor,
  loadClient: () => Promise<CustomerRpcClient> = platformCustomerClient,
): Promise<NextResponse> {
  const gate = await requirePlatformApi(loadActor, loadClient);
  if ("response" in gate) return gate.response;
  const url = new URL(request.url);
  const query = parseCustomerListQuery({ q: url.searchParams.get("q"), status: url.searchParams.get("status") });
  const result = await readPlatformCustomerList(gate.client, query);
  if (!result.ok) return customerFailureResponse(result);
  return NextResponse.json({ ok: true, customers: result.customers });
}
