import type { Ctx } from "@/lib/types";
import { BoardsService } from "@/lib/boards/service";
import { SupabaseBoardsRepo } from "@/lib/repo/supabase/boardsRepo";
import { createClient } from "@/lib/supabase/server";
import { loadPermGuard } from "@/lib/perm/guard";
import { RetargetingCampaignService } from "./service";
import { SupabaseCampaignOptOut, SupabaseCampaignOutbox } from "./supabase";

/** Request-scoped composition. It never falls back to LocalRepo in production. */
export async function createRetargetingCampaignService(): Promise<RetargetingCampaignService> {
  const client = await createClient();
  const boards = new BoardsService(new SupabaseBoardsRepo(client));
  return new RetargetingCampaignService(
    {
      async loadScopedBoard(ctx: Ctx, boardId: string) {
        const [detail, rows] = await Promise.all([
          boards.getBoardDetail(ctx, boardId),
          boards.listItems(ctx, boardId),
        ]);
        return { columns: detail.columns, rows };
      },
    },
    { async canBulkSend(ctx: Ctx) { return (await loadPermGuard(ctx.org.id, "danger.bulk_edit_delete")).kind === "allowed"; } },
    new SupabaseCampaignOptOut(client),
    new SupabaseCampaignOutbox(client),
  );
}

