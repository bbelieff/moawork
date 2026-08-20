import { handleWorkspaceRequest } from "./handler";

export async function POST(request: Request): Promise<Response> {
  return handleWorkspaceRequest(request);
}
