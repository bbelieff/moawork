"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { getSession } from "@/lib/auth/session";
import { getSupabaseClient } from "@/lib/repo/supabase/client";
import { NewcustLegacyMigrationSource } from "@/lib/repo/supabase/newcustLegacyMigrationSource";
import type { LegacyApplyResult, LegacyDryRunResult } from "@/lib/newcust/legacy-types";

function source(): NewcustLegacyMigrationSource {
  const db = getSupabaseClient();
  if (!db) throw new Error("Supabase 연결이 필요합니다.");
  return new NewcustLegacyMigrationSource(db);
}

export async function dryRunNewcustLegacyMigration(): Promise<LegacyDryRunResult> {
  const ctx = await getSession();
  return source().dryRun(ctx.org.id);
}

export async function applyNewcustLegacyMigration(expectedChecksum: string): Promise<LegacyApplyResult> {
  const ctx = await getSession();
  const result = await source().apply(ctx.org.id, randomUUID(), expectedChecksum);
  revalidatePath("/newcust");
  return result;
}

export async function rollbackNewcustLegacyMigration(expectedTargetChecksum: string) {
  const ctx = await getSession();
  const result = await source().rollback(ctx.org.id, expectedTargetChecksum);
  revalidatePath("/newcust");
  return result;
}
