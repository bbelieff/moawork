import { describe, expect, it } from "vitest";
import {
  modePreferenceCookie,
  readModePreference,
  signModePreference,
} from "./preference";

const SECRET = "mode-contract-test-secret-with-at-least-32-characters";

describe("signed mode preference", () => {
  it("round-trips only recognized modes with a valid signature", () => {
    const token = signModePreference("platform", SECRET);
    expect(readModePreference(token ?? undefined, SECRET)).toBe("platform");
    expect(readModePreference(signModePreference("user", SECRET) ?? undefined, SECRET)).toBe("user");
  });

  it("fails closed for a missing secret, changed payload, or malformed token", () => {
    const token = signModePreference("platform", SECRET)!;
    expect(readModePreference(token, null)).toBeNull();
    expect(readModePreference(token.replace("platform", "user"), SECRET)).toBeNull();
    expect(readModePreference("v1.owner.signature", SECRET)).toBeNull();
  });

  it("uses an HttpOnly, same-site cookie boundary", () => {
    expect(modePreferenceCookie.options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  });
});
