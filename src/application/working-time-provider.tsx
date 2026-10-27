import { employmentProfileAt } from "@/domain/employment-history";
import { Temporal } from "@js-temporal/polyfill";
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
  type Context,
} from "react";
import type { PflegeShiftPorts } from "./pflegeshift-ports";
import { useRemunerationData } from "./remuneration-provider";
import type { CalendarEntry, UserProfile, SaveProfileInput } from "@/domain/types";
import type { WorkingTimeTargetSnapshot } from "@/domain/saved-working-time-target";
import {
  createWorkingTimeCalculationProfile,
  type WorkingTimeCalculationProfile,
} from "@/engine/working-time-calculation-profile";

export interface PflegeShiftProfileValue {
  readonly profile: UserProfile | null;
  readonly calculationProfile?: WorkingTimeCalculationProfile | null;
  readonly refreshWorkingTimeTarget?: () => void;
  readonly updateProfile: (input: SaveProfileInput) => Promise<UserProfile>;
}

/** Current check preference gates training references without becoming dated age evidence. */
export const WorkingTimeYouthProtectionContext = createContext<
  | {
      readonly youthEnabled: boolean | null;
      readonly error: string | null;
    }
  | undefined
>(undefined);

export function WorkingTimeProvider({
  ports,
  children,
  base,
  ready,
  profileContext: ProfileContext,
}: PropsWithChildren<{
  readonly ports: PflegeShiftPorts;
  readonly base: PflegeShiftProfileValue;
  readonly entries: readonly CalendarEntry[];
  readonly ready: boolean;
  readonly profileContext: Context<PflegeShiftProfileValue | null>;
}>) {
  const history = useRemunerationData();
  const protection = useContext(WorkingTimeYouthProtectionContext);
  const youthEnabled = protection?.youthEnabled;
  const youthError = protection?.error;
  const [revision, setRevision] = useState(0);
  const refreshWorkingTimeTarget = useCallback(() => setRevision((value) => value + 1), []);
  const [loaded, setLoaded] = useState<{
    revision: number;
    snapshot: WorkingTimeTargetSnapshot | null;
    status: "ready" | "error";
  } | null>(null);
  const load = ports.repository.loadWorkingTimeTargetSettings;
  useEffect(() => {
    if (!ready || !load) return;
    let active = true;
    void load().then(
      (snapshot) => {
        if (active) setLoaded({ revision, snapshot, status: "ready" });
      },
      (error) => {
        ports.diagnostics.record("provider", "LOAD_WORKING_TIME_TARGET_FAILED", error);
        if (active) setLoaded({ revision, snapshot: null, status: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, [load, ports.diagnostics, ready, revision]);
  const value = useMemo<PflegeShiftProfileValue>(() => {
    const status =
      !ready || !loaded || loaded.revision !== revision || history.status === "loading"
        ? "loading"
        : loaded.status === "error" || history.status === "error"
          ? "error"
          : "ready";
    return {
      ...base,
      ...(base.profile &&
      history.status === "ready" &&
      history.profiles.some((item) => item.employment)
        ? {
            profile: employmentProfileAt(
              { ...base.profile, employmentTimeline: history.profiles },
              Temporal.Now.plainDateISO(base.profile.timeZone).toString(),
            ),
          }
        : {}),
      refreshWorkingTimeTarget,
      calculationProfile:
        base.profile && load
          ? createWorkingTimeCalculationProfile(
              base.profile,
              loaded?.snapshot ?? null,
              history.profiles,
              status,
              [],
              youthEnabled ?? null,
              youthEnabled === null ? (youthError ? "error" : "loading") : "ready",
            )
          : base.profile,
    };
  }, [
    base,
    history.profiles,
    history.status,
    load,
    loaded,
    ready,
    refreshWorkingTimeTarget,
    revision,
    youthEnabled,
    youthError,
  ]);
  return <ProfileContext value={value}>{children}</ProfileContext>;
}
