import * as client from "@/components/ClientBoundary";

const exportName: keyof typeof client = "clientHelper";

export default function DynamicPage() {
  const selected = client[exportName];
  return <p>{typeof selected === "function" ? selected({ label: "not allowed" }) : "no"}</p>;
}
