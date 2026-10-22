import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from "react";
import { startupPresentation } from "@/infrastructure/startup-presentation";
import type { SharingStartupCache } from "@/application/sharing-startup-cache";
import { Alert, AppState } from "react-native";
import * as Crypto from "expo-crypto";
import Constants from "expo-constants";
import { useSQLiteContext } from "expo-sqlite";
import {
  usePflegeShiftEntries,
  usePflegeShiftProfile,
  usePflegeShiftStatus,
  usePflegeShiftTestData,
} from "@/application/pflegeshift-provider";
import {
  createCalendarSharingRuntime,
  type CalendarSharingRuntimeOptions,
} from "@/application/calendar-sharing-runtime";
import { createSharingInviteUrl } from "@/application/calendar-sharing-invite-url";
import { SharedCalendarsContext } from "@/application/shared-calendars-context";
import { SharingUiProvider } from "@/features/sharing/sharing-ui-provider";
import {
  createSharingAuthPort,
  forgetSharingAuthProfile,
  getSharingSupabaseClient,
  isSharingAppleSignInAvailable,
  prepareAppleAccountDeletion,
} from "@/infrastructure/auth/sharing-auth";
import { createCloudSharingClient } from "@/infrastructure/sharing/cloud-sharing-client";
import * as local from "@/infrastructure/database/calendar-sharing-repository";
import { listCalendarEntries } from "@/infrastructure/database/calendar-entry-repository";
import type { SharingRevocationStatus } from "@/domain/calendar-sharing-ports";
import { watchSharingChanges } from "@/infrastructure/sharing/sharing-realtime";
import { deliverSharingInvitation } from "@/infrastructure/sharing/invitation-delivery";

export { useVisibleSharedCalendars } from "@/application/shared-calendars-context";
function confirmManualAppleDeletion(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      "Apple-Verknüpfung selbst entfernen",
      "Dein LUNA-Konto kann gelöscht werden. Die Apple-Verknüpfung musst du danach unter Einstellungen → dein Name → Mit Apple anmelden → LUNA → Löschen entfernen. Trotzdem fortfahren?",
      [
        { text: "Abbrechen", style: "cancel", onPress: () => resolve(false) },
        { text: "Konto löschen", style: "destructive", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
function notifyDeletion(status: SharingRevocationStatus) {
  const instructions =
    status === "manual_required" || status === "unconfirmed"
      ? " Entferne die Apple-Verknüpfung zusätzlich unter Einstellungen → dein Name → Mit Apple anmelden → LUNA → Löschen. Der Apple-Widerruf konnte nicht bestätigt werden."
      : "";
  Alert.alert(
    "Konto gelöscht",
    `Deine lokalen Dienste und Einstellungen bleiben auf diesem Gerät.${instructions}`,
  );
}

/** Native adapters live in composition; the serial application worker stays framework independent. */
export function SharingRuntimeProvider({
  children,
  startup,
}: PropsWithChildren<{ startup?: SharingStartupCache }>) {
  const db = useSQLiteContext();
  const { ready, error } = usePflegeShiftStatus();
  const { profile } = usePflegeShiftProfile();
  const { entries } = usePflegeShiftEntries();
  const { testMonths } = usePflegeShiftTestData();
  const hasProfile = profile !== null;
  const [initializedDatabase, setInitializedDatabase] = useState<typeof db | null>(null);
  useEffect(() => {
    if (ready && hasProfile) setInitializedDatabase(db);
    else if (!hasProfile) setInitializedDatabase(null);
  }, [db, hasProfile, ready]);
  // ready describes the requested calendar range, not the lifetime of this database.
  const active = hasProfile && (ready || initializedDatabase === db);
  const runtime = useMemo(() => {
    const auth = createSharingAuthPort();
    const client = getSharingSupabaseClient();
    const options: CalendarSharingRuntimeOptions = {
      auth,
      cloud: client ? createCloudSharingClient(client) : null,
      local: {
        // The secure provider's migrateDatabase already installs sharing schema 33.
        initialize: async () => {},
        setActiveAccount: (accountId) => local.setSharingActiveAccount(db, accountId),
        listBindings: (accountId) => local.listSharingBindings(db, accountId),
        stagePublication: (binding, timeZone, makeId) =>
          local.stageSharingPublication(db, binding, timeZone, makeId),
        configureContent: (accountId, calendarId, content) =>
          local.configureSharingContent(db, accountId, calendarId, content),
        rememberInvitation: (accountId, invitation) =>
          local.rememberSharingInvitation(db, accountId, invitation),
        listInvitations: (accountId) => local.listSharingInvitations(db, accountId),
        stageConfirmedPublication: (binding, timeZone, makeId, confirmation) =>
          local.stageConfirmedSharingPublication(db, binding, timeZone, makeId, confirmation),
        acknowledgePublication: (publication, revision) =>
          local.acknowledgeSharingPublication(db, publication, revision),
        resumePublication: (accountId, calendarId) =>
          local.resumeSharingPublication(db, accountId, calendarId),
        clearConflict: (accountId, calendarId, revision) =>
          local.clearSharingPublicationConflict(db, accountId, calendarId, revision),
        listCaches: (accountId) => local.listCachedSharingCalendars(db, accountId),
        cacheSnapshot: (accountId, snapshot) => local.cacheSharingSnapshot(db, accountId, snapshot),
        removeCalendar: (accountId, calendarId) =>
          local.removeSharingCalendar(db, accountId, calendarId),
        setColor: (accountId, calendarId, color) =>
          local.setSharingCalendarColor(db, accountId, calendarId, color),
        setVisible: (accountId, calendarId, visible) =>
          local.setSharingCalendarVisible(db, accountId, calendarId, visible),
        forgetAccount: (accountId) => local.forgetSharingAccount(db, accountId),
        readEntries: () => listCalendarEntries(db),
        bindCalendar: (accountId, calendar, secret, selected) =>
          local.bindSharingCalendar(db, accountId, calendar, secret, selected),
      },
      getInput: () => ({ timeZone: "Europe/Berlin", testLabActive: !active }),
      now: Date.now,
      makeId: Crypto.randomUUID,
      makeSecret: () =>
        Array.from(Crypto.getRandomValues(new Uint8Array(32)), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join(""),
      appleAvailable: false,
      shareUrl: deliverSharingInvitation,
      inviteUrl: (token) =>
        createSharingInviteUrl(
          token,
          process.env.EXPO_PUBLIC_SHARING_INVITE_URL,
          typeof Constants.expoConfig?.extra?.appVariant === "string"
            ? Constants.expoConfig.extra.appVariant
            : "production",
        ),
      async isAppleUser() {
        if (!client) throw new Error("SHARE_UNAUTHENTICATED");
        const result = await client.auth.getUser();
        if (result.error)
          throw new Error(
            result.error.status === 401 || result.error.status === 403
              ? "SHARE_SESSION_INVALID"
              : "SHARE_NETWORK_FAILED",
          );
        if (!result.data.user) throw new Error("SHARE_SESSION_INVALID");
        return (
          result.data.user.identities?.some((identity) => identity.provider === "apple") ?? false
        );
      },
      prepareAppleDeletion: prepareAppleAccountDeletion,
      confirmManualAppleDeletion,
      notifyDeletion,
      forgetAuthProfile: forgetSharingAuthProfile,
      beforeInitialRefresh: startupPresentation.wait,
      readInitialDisplay: startup?.take,
    };
    return createCalendarSharingRuntime(options);
    // Calendar range loading must not recreate an initialized sharing session.
  }, [db, active, startup]);
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const previousInputRuntime = useRef<typeof runtime | null>(null);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    void runtime.start().catch(() => {});
    void isSharingAppleSignInAvailable().then(
      (available) => {
        if (!disposed) {
          runtime.setAppleAvailable(available);
        }
      },
      () => {},
    );
    let appState = AppState.currentState;
    const client = getSharingSupabaseClient();
    const stopRealtime = client
      ? watchSharingChanges(client, () => {
          if (appState === "active") void runtime.backgroundRefresh().catch(() => {});
        })
      : () => {};
    const subscription = AppState.addEventListener("change", (state) => {
      appState = state;
      if (state === "active") void runtime.backgroundRefresh().catch(() => {});
    });
    const timer = setInterval(() => {
      if (appState === "active") void runtime.backgroundRefresh().catch(() => {});
    }, 15000);
    return () => {
      disposed = true;
      stopRealtime();
      clearInterval(timer);
      subscription.remove();
      runtime.stop();
    };
  }, [active, runtime]);
  useEffect(() => {
    const alreadyStarted = previousInputRuntime.current === runtime;
    previousInputRuntime.current = runtime;
    runtime.updateInput({
      timeZone: profile?.timeZone ?? "Europe/Berlin",
      testLabActive: !active || testMonths.length > 0,
    });
    // start() already restores and refreshes this input once.
    if (active && alreadyStarted) void runtime.backgroundRefresh().catch(() => {});
  }, [active, entries, profile?.timeZone, runtime, testMonths]);
  return (
    <SharingUiProvider controller={snapshot.controller}>
      <SharedCalendarsContext value={snapshot.visibleCalendars}>
        {(ready || initializedDatabase === db || error) && (!active || snapshot.localReady)
          ? children
          : null}
      </SharedCalendarsContext>
    </SharingUiProvider>
  );
}
