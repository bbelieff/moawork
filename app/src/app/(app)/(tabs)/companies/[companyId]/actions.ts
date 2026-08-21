"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { startCompanyWork, type CompanyStartWorkClient } from "@/lib/companies/start-work";
import { createClient } from "@/lib/supabase/server";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function startCompanyWorkAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  const companyId = text(formData, "companyId");
  const requestId = text(formData, "requestId");
  if (!companyId || !requestId) redirect(`/companies/${encodeURIComponent(companyId)}?workStart=invalid`);

  let dealId: string;
  try {
    const client = await createClient();
    const result = await startCompanyWork(client as unknown as CompanyStartWorkClient, { orgId: ctx.org.id, companyId, requestId });
    dealId = result.dealId;
  } catch {
    redirect(`/companies/${encodeURIComponent(companyId)}?workStart=failed`);
  }
  revalidatePath(`/companies/${companyId}`);
  revalidatePath("/work");
  redirect(`/companies/${encodeURIComponent(companyId)}?workStart=ok&dealId=${encodeURIComponent(dealId)}`);
}
