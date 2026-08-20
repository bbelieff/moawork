import { handleWorkspaceTarget } from "./handler";

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await context.params;
  return handleWorkspaceTarget(request, slug);
}
