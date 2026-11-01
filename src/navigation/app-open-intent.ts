import { appResumeStore } from "./app-resume-storage";

/** SDK 57 treats null as no navigation; cold launches restore a persisted safe view. */
export function redirectAppOpenIntent({
  path,
  initial,
}: {
  readonly path: string;
  readonly initial: boolean;
}): string | null | Promise<string> {
  try {
    const relative = path.startsWith("/");
    const url = new URL(path, "pflegeshift:///");
    if (
      !relative &&
      !["pflegeshift:", "lunashift:", "pflegeshift-internal:", "lunashift-internal:"].includes(
        url.protocol,
      )
    )
      return path;
    const route =
      `${url.hostname ? "/" + url.hostname : ""}${url.pathname}`.replace(/\/$/, "") || "/";
    const keys = [...url.searchParams.keys()];
    const widget = route === "/widget-day" && keys.every((key) => ["date", "month"].includes(key));
    const launcher = route === "/" && keys.every((key) => key === "month");
    if (widget || launcher)
      return initial ? appResumeStore.load().then((state) => state?.href ?? "/") : null;
  } catch {
    // Leave malformed and unrelated links to the router's existing handling.
  }
  return path;
}
