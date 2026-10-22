import type { ProviderUser } from "./sharing-auth-core";

/** Reads only display identity from the encrypted session; tokens never leave storage. */
export function readStoredSharingUser(value: string | null): ProviderUser | null {
  if (!value) return null;
  try {
    const session: unknown = JSON.parse(value);
    if (!session || typeof session !== "object") return null;
    const { user, access_token, refresh_token } = session as Record<string, unknown>;
    if (
      typeof access_token !== "string" ||
      !access_token ||
      typeof refresh_token !== "string" ||
      !refresh_token ||
      !user ||
      typeof user !== "object"
    )
      return null;
    const record = user as Record<string, unknown>;
    if (typeof record.id !== "string" || !record.id) return null;
    return {
      id: record.id,
      user_metadata:
        record.user_metadata && typeof record.user_metadata === "object"
          ? (record.user_metadata as Record<string, unknown>)
          : undefined,
    };
  } catch {
    return null;
  }
}
