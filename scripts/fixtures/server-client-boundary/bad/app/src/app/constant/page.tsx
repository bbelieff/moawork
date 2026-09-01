import { CLIENT_RULES } from "@/components/ClientBoundary";

export default function ConstantPage() {
  return <p>{CLIENT_RULES.includes("ready") ? "yes" : "no"}</p>;
}
