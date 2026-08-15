import { BoardsService } from "./service";
import { SupabaseBoardsRepo } from "@/lib/repo/supabase/boardsRepo";
import { createClient } from "@/lib/supabase/server";

/** Build the board graph from the authenticated client bound to this request. */
export async function createRequestBoards() {
  const client = await createClient();
  const repo = new SupabaseBoardsRepo(client);
  return { client, repo, service: new BoardsService(repo) };
}
