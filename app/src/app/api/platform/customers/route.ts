import { NextResponse } from "next/server";
import { handleCustomerList } from "./handlers";

export async function GET(request: Request): Promise<NextResponse> {
  return handleCustomerList(request);
}
