"use client";

export type ClientProps = { label: string };
export const clientHelper = () => "client-only";

export default function ClientBoundary({ label }: ClientProps) {
  return <button type="button">{label}</button>;
}
