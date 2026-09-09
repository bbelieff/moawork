import { relativeRedirect } from "@/lib/auth/relative-redirect";
import { NextResponse } from "next/server";
import { loadPlatformActor } from "@/lib/platform/actor";
import {
  decideModeMutation,
  sanitizeModeNext,
} from "@/lib/mode/contract";
import {
  modePreferenceCookie,
  signModePreference,
} from "@/lib/mode/preference";

export async function POST(request: Request): Promise<Response> {
  const actor = await loadPlatformActor();
  const form = await request.formData();
  const decision = decideModeMutation(
    actor.kind === "granted"
      ? "granted"
      : actor.kind === "unavailable"
        ? "unavailable"
        : "denied",
    form.get("mode"),
  );
  if (decision.kind === "unavailable") {
    return NextResponse.json({ error: "mode_unavailable" }, { status: 503 });
  }
  if (decision.kind === "forbidden") {
    return NextResponse.json({ error: "mode_forbidden" }, { status: 403 });
  }
  if (decision.kind === "invalid") {
    return NextResponse.json({ error: "mode_invalid" }, { status: 400 });
  }

  const url = new URL("/mode", request.url);
  const next = sanitizeModeNext(form.get("next"));
  if (next) url.searchParams.set("next", next);

  const signed = signModePreference(decision.mode);
  if (!signed) {
    // MOAWORK_MODE_PREFERENCE_SECRET missing/misconfigured — a server setup
    // problem, not a bad request. Previously this fell through to the same
    // raw-JSON "mode_invalid" 400 as a genuinely malformed request, which is
    // an unreachable dead end for a person clicking a real button (same
    // shape as the 2026-08-11 P0: a working action with no reachable
    // outcome). Send them to a page that explains it instead.
    url.searchParams.set("error", "config");
    return relativeRedirect(url.pathname + url.search);
  }

  const response = relativeRedirect(url.pathname + url.search);
  response.cookies.set(modePreferenceCookie.name, signed, modePreferenceCookie.options);
  return response;
}
