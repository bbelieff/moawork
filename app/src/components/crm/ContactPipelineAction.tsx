"use client";

import { useActionState } from "react";
import {
  mutateContactPipeline,
  type ContactPipelineActionState,
} from "@/lib/crm/contactPipelineActions";
import {
  CONTACT_MOVE_LABEL,
  WORK_MOVE_LABEL,
  type ContactTransitionKind,
} from "@/lib/crm/contactPipeline";

const INITIAL: ContactPipelineActionState = { ok: false, message: "" };

export function ContactPipelineAction({
  dealId,
  kind,
  requestId,
}: Readonly<{
  dealId: string;
  kind: ContactTransitionKind;
  requestId: string;
}>) {
  const [state, action, pending] = useActionState(mutateContactPipeline, INITIAL);
  const label = kind === "lead_to_contact" ? CONTACT_MOVE_LABEL : WORK_MOVE_LABEL;

  return (
    <form action={action} className="mt-3 border-t border-neutral-100 pt-3" aria-busy={pending}>
      <input type="hidden" name="dealId" value={dealId} />
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="operation" value="move" />
      <input type="hidden" name="kind" value={kind} />
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? "이동 중…" : label}
        </button>
      </div>
      {state.message ? (
        <p role="status" className={`mt-2 text-xs ${state.ok ? "text-emerald-700" : "text-red-700"}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
