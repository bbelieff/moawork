import { NextResponse } from "next/server";
import { handleCustomerDetail, handleCustomerPatch } from "./handlers";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  return handleCustomerDetail((await context.params).id);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  return handleCustomerPatch((await context.params).id, request);
}
