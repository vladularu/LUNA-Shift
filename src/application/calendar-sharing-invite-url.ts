export function createSharingInviteUrl(
  token: string,
  configuredUrl: string | undefined,
  variant: string,
): string {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("SHARE_INVITE_INVALID");
  if (configuredUrl?.trim()) {
    let base: URL;
    try {
      base = new URL(configuredUrl.trim());
    } catch {
      throw new Error("SHARE_INVITE_URL_INVALID");
    }
    if (
      base.protocol !== "https:" ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      !base.hostname.includes(".") ||
      /^[\d[]/.test(base.hostname) ||
      /\.(local|localhost|invalid|test)$/.test(base.hostname) ||
      !["/", "/sharing-invite"].includes(base.pathname)
    )
      throw new Error("SHARE_INVITE_URL_INVALID");
    base.pathname = "/sharing-invite";
    base.searchParams.set("token", token);
    return base.toString();
  }
  const scheme =
    variant === "internal"
      ? "lunashift-internal"
      : variant === "design"
        ? "lunashift-design"
        : "lunashift";
  return `${scheme}://sharing-invite?token=${token}`;
}
