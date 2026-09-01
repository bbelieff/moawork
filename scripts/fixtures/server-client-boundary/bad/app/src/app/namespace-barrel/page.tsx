import { clientNs } from "@/lib/client-namespace-barrel";

export default function NamespaceBarrelPage() {
  return <p>{clientNs.clientHelper()}</p>;
}
