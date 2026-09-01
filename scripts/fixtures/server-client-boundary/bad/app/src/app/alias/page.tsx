import { clientHelper } from "@/components/ClientBoundary";

const helperAlias = clientHelper;

export default function AliasPage() {
  return <p>{helperAlias()}</p>;
}
