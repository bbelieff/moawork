import "server-only";
import { createClient } from "@/lib/supabase/server";
import { SupabaseBoardsSource } from "@/lib/repo/supabase/supabaseBoardsSource";
import type { Ctx } from "@/lib/types";

export async function getNewcustSource(): Promise<SupabaseBoardsSource> {
  return new SupabaseBoardsSource(await createClient());
}

export async function loadNewcustBoard(ctx: Ctx) {
  return (await getNewcustSource()).ensureNewcustBoard(ctx);
}
