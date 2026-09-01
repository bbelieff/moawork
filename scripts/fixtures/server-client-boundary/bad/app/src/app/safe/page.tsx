import ClientBoundary, { type ClientProps } from "@/components/ClientBoundary";

const props: ClientProps = { label: "rendering is allowed" };

export default function SafePage() {
  return <ClientBoundary {...props} />;
}
