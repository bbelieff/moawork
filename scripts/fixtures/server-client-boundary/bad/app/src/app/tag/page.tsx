import { clientHelper } from "@/components/ClientBoundary";

export default function TagPage() {
  return <p>{clientHelper`not allowed`}</p>;
}
