import * as client from "@/components/ClientBoundary";

export default function NamespacePage() {
  return <p>{client.clientHelper()}</p>;
}
