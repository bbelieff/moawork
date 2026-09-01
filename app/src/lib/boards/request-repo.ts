import type { BoardsRepo } from "./store";
import { canUseLocalSeedFallback } from "@/lib/supabase/local-fallback";

/** Request-scoped production repo. Local seed remains an explicit non-production capability. */
export async function createRequestBoardsContext(): Promise<{ client: null | Awaited<ReturnType<typeof import("@/lib/supabase/server")["createClient"]>>; repo: BoardsRepo }> {
  if (process.env.NODE_ENV !== "production" && canUseLocalSeedFallback()) {
    const { getBoardsRepo } = await import("@/lib/repo/local/boardsRepo");
    return { client: null, repo: await getBoardsRepo() };
  }
  const [{ createClient }, { SupabaseBoardsRepo }] = await Promise.all([
    import("@/lib/supabase/server"),
    import("@/lib/repo/supabase/boardsRepo"),
  ]);
  const client = await createClient();
  return { client, repo: new SupabaseBoardsRepo(client) };
}

export async function createRequestBoardsRepo(): Promise<BoardsRepo> {
  return (await createRequestBoardsContext()).repo;
}
