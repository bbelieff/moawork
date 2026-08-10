import { createHmac, timingSafeEqual } from "node:crypto";
import {
  MODE_PREFERENCE_COOKIE,
  parsePresentationMode,
  type PresentationMode,
} from "./contract";

const VERSION = "v1";

function signingSecret(): string | null {
  const value = process.env.MOAWORK_MODE_PREFERENCE_SECRET;
  return typeof value === "string" && value.length >= 32 ? value : null;
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Server-only cookie value; it is a presentation preference, never authority. */
export function signModePreference(
  mode: PresentationMode,
  secret = signingSecret(),
): string | null {
  if (!secret) return null;
  const payload = `${VERSION}.${mode}`;
  return `${payload}.${signature(payload, secret)}`;
}

export function readModePreference(
  value: string | undefined,
  secret = signingSecret(),
): PresentationMode | null {
  if (!value || !secret) return null;
  const [version, rawMode, provided, extra] = value.split(".");
  const mode = parsePresentationMode(rawMode);
  if (version !== VERSION || !mode || !provided || extra) return null;
  const expected = signature(`${version}.${mode}`, secret);
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right) ? mode : null;
}

export const modePreferenceCookie = {
  name: MODE_PREFERENCE_COOKIE,
  options: {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 60,
  },
};
