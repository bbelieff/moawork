import { handleWorkspaceAlias } from "./handler";

export async function GET(request: Request, context: { params: Promise<{ alias: string }> }): Promise<Response> {
  const { alias } = await context.params;
  return handleWorkspaceAlias(request, alias);
}
