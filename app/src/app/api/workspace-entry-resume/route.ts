import { NextResponse } from "next/server";
import { WORKSPACE_ENTRY_RESUME_COOKIE } from "@/lib/workspace-entry/contracts";

export async function DELETE(): Promise<Response> {
  const response = new NextResponse(null, { status: 204 });
  response.cookies.delete(WORKSPACE_ENTRY_RESUME_COOKIE);
  return response;
}
