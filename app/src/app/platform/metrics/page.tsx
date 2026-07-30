import { redirect } from "next/navigation";

/** Canonical platform analysis lives at /platform/analytics. */
export default async function PlatformMetricsPage() {
  redirect("/platform/analytics");
}
