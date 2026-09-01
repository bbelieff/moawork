"use client";

import { readClientValue } from "@/lib/client-consumer";

export function ClientOnlyRoot() {
  return <span>{readClientValue()}</span>;
}
