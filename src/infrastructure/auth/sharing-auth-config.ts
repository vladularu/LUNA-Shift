export type SharingBackendConfiguration = {
  url: string;
  publishableKey: string;
  storageKey: string;
};

/** There is no fallback to the signed rule-catalog backend or to privileged keys. */
export function readSharingBackendConfiguration(
  url: string | undefined,
  publishableKey: string | undefined,
): SharingBackendConfiguration | null {
  if (!url || !publishableKey || !/^sb_publishable_[a-zA-Z0-9_-]{20,}$/.test(publishableKey))
    return null;
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== "/" ||
      !/^[a-zA-Z0-9.-]{1,120}$/.test(parsed.hostname)
    )
      return null;
    return {
      url: parsed.origin,
      publishableKey,
      storageKey: `luna.sharing.${parsed.hostname}.auth`,
    };
  } catch {
    return null;
  }
}
