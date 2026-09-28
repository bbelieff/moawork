import { NextResponse } from "next/server";
import { handleTaskStatus } from "../handlers";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; taskId: string }> },
): Promise<NextResponse> {
  const params = await context.params;
  return handleTaskStatus(params.id, params.taskId, request);
}
