"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { cancelEntry, correctEntry, exportLedgerCsv, postEntry } from "@/lib/settlements/server";
import type { LedgerEntryKind } from "@/lib/settlements/ledger";

const value = (form: FormData, key: string) => String(form.get(key) ?? "");

export async function addLedgerEntry(form: FormData) {
  const ctx = await getSession();
  await postEntry(ctx, { settlementId: value(form,"settlementId"), kind: value(form,"kind") as LedgerEntryKind, amount: value(form,"amount"), occurredOn: value(form,"occurredOn") });
  revalidatePath("/settlements");
}

export async function cancelLedgerEntry(form: FormData) {
  await cancelEntry(await getSession(), value(form,"entryId"));
  revalidatePath("/settlements");
}

export async function correctLedgerEntry(form: FormData) {
  await correctEntry(await getSession(), { entryId: value(form,"entryId"), amount: value(form,"amount"), occurredOn: value(form,"occurredOn") });
  revalidatePath("/settlements");
}

export async function downloadLedgerCsv() {
  return exportLedgerCsv(await getSession());
}
