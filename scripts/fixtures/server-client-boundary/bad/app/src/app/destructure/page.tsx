import * as client from "@/components/ClientBoundary";

const { clientHelper } = client;

export default function DestructurePage() {
  return <p>{clientHelper()}</p>;
}
