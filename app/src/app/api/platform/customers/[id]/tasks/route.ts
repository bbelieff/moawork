import { NextResponse } from "next/server";
import { handleTaskCreate } from "./handlers";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  return handleTaskCreate((await context.params).id, request);
}
