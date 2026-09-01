import ClientBoundary, { clientHelper, type ClientProps } from "@/components/ClientBoundary";
import { ClientOnlyRoot } from "@/components/ClientOnlyRoot";
import { serverSafeValue, type ReExportedClientOnlyShape } from "@/lib/server-safe";
import * as serverUtils from "@/lib/server-utils";
import type { ClientOnlyShape } from "@/lib/type-only-client-consumer";

const props: ClientProps = { label: "rendering is allowed" };
const directTypeOnly: ClientOnlyShape = { label: "direct type-only edge" };
const reExportedTypeOnly: ReExportedClientOnlyShape = { label: "type-only re-export edge" };
const serverExportName: keyof typeof serverUtils = "serverHelper";

function readServerLocalValue() {
  const clientHelper = () => "shadowed server-local value";
  return clientHelper();
}

export default function Page() {
  const selectedServerHelper = serverUtils[serverExportName];
  return <><ClientBoundary {...props} /><ClientOnlyRoot /><span>{serverSafeValue}{directTypeOnly.label}{reExportedTypeOnly.label}{selectedServerHelper()}{readServerLocalValue()}</span></>;
}
