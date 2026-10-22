import { describe, expect, it } from "vitest";
import { readStoredSharingUser } from "./sharing-stored-user";

describe("encrypted stored session display identity", () => {
  it("returns display identity without exposing credentials", () => {
    expect(
      readStoredSharingUser(
        JSON.stringify({
          access_token: "private-access",
          refresh_token: "private-refresh",
          expires_at: 1,
          user: {
            id: "account",
            email: "private@example.com",
            user_metadata: { full_name: "Alex" },
          },
        }),
      ),
    ).toEqual({ id: "account", user_metadata: { full_name: "Alex" } });
  });
  it.each([
    null,
    "{broken",
    "null",
    "[]",
    "{}",
    '{"user":{"id":"account"}}',
    '{"access_token":"a","refresh_token":"r","user":{"id":42}}',
  ])("rejects missing or malformed local session data: %s", (value) => {
    expect(readStoredSharingUser(value)).toBeNull();
  });
});
