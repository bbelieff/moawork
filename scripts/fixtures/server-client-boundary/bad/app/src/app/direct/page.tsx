import { clientHelper, type ClientProps } from "@/components/ClientBoundary";

const props: ClientProps = { label: "mixed type/value import keeps its runtime edge" };

export default function DirectPage() {
  return <p>{props.label}{clientHelper()}</p>;
}
