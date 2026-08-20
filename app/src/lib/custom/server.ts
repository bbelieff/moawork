import { createClient } from "@/lib/supabase/server";
import { canUseLocalSeedFallback } from "@/lib/supabase/local-fallback";
import { getCustomService } from "./repo-store";
import { CustomService } from "./service";
import { SupabaseCustomStore } from "./supabase-store";

/** Production uses the request's authenticated Supabase client; explicit local seed uses LocalRepo. */
export async function createRequestCustomService(): Promise<CustomService> {
  if (process.env.NODE_ENV !== "production" && canUseLocalSeedFallback()) {
    return getCustomService();
  }
  return new CustomService(new SupabaseCustomStore(await createClient()), () => crypto.randomUUID());
}
