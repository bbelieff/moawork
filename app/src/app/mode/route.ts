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
  const signed = decision.kind === "accepted" ? signModePreference(decision.mode) : null;
  if (!signed) {
    return NextResponse.json({ error: "mode_invalid" }, { status: 400 });
  }

  const url = new URL("/mode", request.url);
  const next = sanitizeModeNext(form.get("next"));
  if (next) url.searchParams.set("next", next);
  const response = NextResponse.redirect(url);
  response.cookies.set(modePreferenceCookie.name, signed, modePreferenceCookie.options);
  return response;
}
