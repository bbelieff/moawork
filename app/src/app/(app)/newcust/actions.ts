"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import {
  createFirstLead,
  createLocalFirstLead,
  FirstLeadError,
} from "@/lib/crm/first-lead";
import { getServerCrmSource } from "@/lib/repo/supabase/server-source";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function errorKey(error: unknown): string {
  if (!(error instanceof FirstLeadError)) return "save";
  if (error.operation === "input") {
    return error.message.includes("업체명") ? "company" : "input";
  }
  if (error.operation === "pipeline") return "pipeline";
  if (
    error.operation === "rpc" &&
    (error.message.includes("pipeline") || error.message.includes("stage"))
  ) {
    return "pipeline";
  }
  return "save";
}

export async function createFirstLeadAction(formData: FormData): Promise<never> {
  const ctx = await getSession();
  const input = {
    requestId: field(formData, "requestId"),
    companyName: field(formData, "companyName"),
    dealTitle: field(formData, "dealTitle"),
  };

  let dealId: string;
  try {
    const result = hasSupabaseEnv()
      ? await createFirstLead(await createClient(), ctx, input)
      : await createLocalFirstLead(await getServerCrmSource(), ctx, input);
    dealId = result.dealId;
  } catch (error) {
    redirect(`/newcust?error=${errorKey(error)}`);
  }

  revalidatePath("/newcust");
  redirect(`/newcust?created=1&deal=${encodeURIComponent(dealId)}`);
}
