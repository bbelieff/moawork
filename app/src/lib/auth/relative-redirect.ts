import { NextResponse } from "next/server";

// A relative Location keeps the browser's origin, including behind a proxy.
export function relativeRedirect(destination: string, status: 303 | 307 = 307): NextResponse {
  if (!destination.startsWith("/") || destination.startsWith("//")
    || [...destination].some((character) =>
      character === "\\" || character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)
    || /%(?:0[ad]|5c)/iu.test(destination)) {
    throw new Error("Unsafe relative redirect");
  }
  const url = new URL(destination, "http://relative.invalid");
  if (url.origin !== "http://relative.invalid" || url.pathname.startsWith("//")) {
    throw new Error("Unsafe relative redirect");
  }
  return new NextResponse(null, {
    status,
    headers: { Location: url.pathname + url.search + url.hash },
  });
}
