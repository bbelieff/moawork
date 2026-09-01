import { clientHelper } from "@/components/ClientBoundary";

export type ClientOnlyShape = { label: string };
export const callInsideRuntimeUnreachableModule = () => clientHelper();
