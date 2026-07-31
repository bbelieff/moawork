import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loadWorkspaceRoutingSnapshot } from "@/lib/auth/workspace-entry-server";
import {
  decideModeDestination,
  sanitizeModeNext,
} from "@/lib/mode/contract";
import {
  modePreferenceCookie,
  readModePreference,
} from "@/lib/mode/preference";
import { loadPlatformActor } from "@/lib/platform/actor";

function modePath(next: string | null): string {
  return next ? `/mode?next=${encodeURIComponent(next)}` : "/mode";
}

export default async function ModePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = sanitizeModeNext((await searchParams).next);
  const snapshot = await loadWorkspaceRoutingSnapshot();
  if (snapshot.kind === "unauthenticated") {
    redirect(`/login?next=${encodeURIComponent(modePath(next))}`);
  }
  if (snapshot.kind === "error") redirect("/workspace-entry?error=routing");

  const actor = await loadPlatformActor();
  const preference = readModePreference(
    (await cookies()).get(modePreferenceCookie.name)?.value,
  );
  const platformAccess = actor.kind === "granted"
    ? "granted"
    : actor.kind === "unavailable"
      ? "unavailable"
      : "denied";
  const destination = decideModeDestination({
    preference,
    platformAccess,
    memberships: snapshot.memberships,
  });
  if (destination.kind !== "chooser") redirect(destination.path);

  return (
    <main>
      <h1>어디에서 시작할까요?</h1>
      <p>플랫폼 운영과 내 워크스페이스는 서로 다른 영역이에요.</p>
      <form action="/mode" method="post">
        <input type="hidden" name="mode" value="platform" />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <button type="submit">플랫폼 운영으로 이동</button>
      </form>
      <form action="/mode" method="post">
        <input type="hidden" name="mode" value="user" />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <button type="submit">내 워크스페이스로 이동</button>
      </form>
    </main>
  );
}
