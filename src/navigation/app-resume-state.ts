import { parseMonthRouteParam } from "./route-params";

const ROUTES = new Set([
  "/",
  "/analysis",
  "/templates",
  "/more",
  "/salary",
  "/worktime-details",
  "/annual-details",
  "/premium-details",
  "/compliance-details",
  "/working-time-profile",
]);
const PARAMETERS = new Set(["month", "period", "section", "origin"]);

export interface AppResumeState {
  readonly version: 1;
  readonly href: string;
  readonly scrollY: number;
}

/** Only stable views and non-sensitive display parameters survive a cold launch. */
export function appResumeHref(
  pathname: string,
  params: Readonly<Record<string, unknown>>,
): string | null {
  if (!ROUTES.has(pathname)) return null;
  const query = new URLSearchParams();
  for (const key of [...PARAMETERS].sort()) {
    const value = params[key];
    if (typeof value !== "string") continue;
    if (key === "month" && parseMonthRouteParam(value).status !== "valid") continue;
    if (key === "period" && value !== "MONTH" && value !== "YEAR") continue;
    if ((key === "section" || key === "origin") && !/^[A-Za-z_-]{1,32}$/.test(value)) continue;
    query.set(key, value);
  }
  const search = query.toString();
  return pathname + (search ? "?" + search : "");
}

export function parseAppResumeState(raw: string | null): AppResumeState | null {
  try {
    if (!raw || raw.length > 1024) return null;
    const state = JSON.parse(raw);
    if (state.version !== 1 || typeof state.href !== "string" || !state.href.startsWith("/"))
      return null;
    const url = new URL(state.href, "https://resume.invalid");
    const href = appResumeHref(url.pathname, Object.fromEntries(url.searchParams));
    if (href === null || url.origin !== "https://resume.invalid" || href !== state.href)
      return null;
    return {
      version: 1,
      href,
      scrollY: Number.isFinite(state.scrollY) ? Math.max(0, Math.min(100000, state.scrollY)) : 0,
    };
  } catch {
    return null;
  }
}

export function createAppResumeStore(storage: {
  readonly read: () => Promise<string | null>;
  readonly write: (value: string | null) => Promise<void>;
}) {
  let state: AppResumeState | null = null;
  let loaded: Promise<AppResumeState | null> | undefined;
  let writes = Promise.resolve();
  const load = () =>
    (loaded ??= Promise.resolve()
      .then(storage.read)
      .then((raw) => {
        state = parseAppResumeState(raw);
        return state;
      })
      .catch(() => null));
  const flush = () => {
    const raw = state ? JSON.stringify(state) : null;
    writes = writes.then(() => storage.write(raw)).catch(() => {});
    return writes;
  };
  return {
    load,
    flush,
    current: () => state,
    record: (href: string) => {
      state = { version: 1, href, scrollY: state?.href === href ? state.scrollY : 0 };
      return flush();
    },
    scroll: (href: string, y: number) => {
      if (state?.href === href && Number.isFinite(y))
        state = { ...state, scrollY: Math.max(0, Math.min(100000, y)) };
    },
    clear: () => {
      state = null;
      return flush();
    },
  };
}
