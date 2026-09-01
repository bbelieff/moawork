"use server";

import { clientHelper } from "@/components/ClientBoundary";

export async function runServerAction() {
  return clientHelper();
}
