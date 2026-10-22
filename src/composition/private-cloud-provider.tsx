import { reloadAppAsync } from "expo";
import { startupPresentation } from "@/infrastructure/startup-presentation";
import * as Crypto from "expo-crypto";
import { useSegments } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from "react";
import { AppState, Platform } from "react-native";
import { usePflegeShiftStatus, usePflegeShiftTestData } from "@/application/pflegeshift-provider";
import { createPrivateCloudRuntime } from "@/application/private-cloud-runtime";
import {
  createSharingAuthPort,
  getSharingSupabaseClient,
  type SharingAuthUser,
} from "@/infrastructure/auth/sharing-auth";
import {
  migratePrivateCloud,
  createPrivateCloudLocal,
} from "@/infrastructure/database/private-cloud-repository";
import { loadCurrentDatabaseSchemaVersion } from "@/infrastructure/database/local-backup-validation";
import { listCalendarEntries, loadProfile } from "@/infrastructure/database/repository";
import {
  cancelAllEntryNotifications,
  syncEntryNotifications,
} from "@/infrastructure/notifications/entry-notifications";
import { createPrivateCloudClient } from "@/infrastructure/private-cloud/cloud-client";
import { validatePrivateCloudDocument } from "@/infrastructure/private-cloud/cloud-document";
import {
  readCloudPresentation,
  prepareCloudPresentation,
} from "@/features/private-cloud/cloud-media";
import { PrivateCloudContext } from "@/features/private-cloud/private-cloud-context";
import { saveAccountName } from "@/application/save-account-name";
import { createCloudSharingClient } from "@/infrastructure/sharing/cloud-sharing-client";
import { UserFacingError } from "@/domain/errors";

const sha256 = (value: string) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);

export function PrivateCloudProvider({ children }: PropsWithChildren) {
  const db = useSQLiteContext();
  const { ready } = usePflegeShiftStatus();
  const { testMonths } = usePflegeShiftTestData();
  const segments = useSegments();
  const allowed =
    ready &&
    testMonths.length === 0 &&
    Platform.OS === "ios" &&
    [
      "(tabs)",
      "private-cloud",
      "account",
      "account-name",
      "calendar-sharing",
      "sharing-invite",
    ].includes(segments[0] ?? "");
  const [user, setUser] = useState<SharingAuthUser | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [accountReady, setAccountReady] = useState(false);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const accountEpoch = useRef(0);
  const auth = useMemo(() => createSharingAuthPort(), []);
  const runtime = useMemo(() => {
    const validate = async (value: unknown) =>
      (
        await validatePrivateCloudDocument(
          value,
          await loadCurrentDatabaseSchemaVersion(db),
          sha256,
        )
      ).document;
    const client = getSharingSupabaseClient();
    return createPrivateCloudRuntime({
      makeId: Crypto.randomUUID,
      canSynchronize: () => AppState.currentState === "active",
      validate: async (document) => {
        await validate(document);
      },
      local: createPrivateCloudLocal(db, {
        sha256,
        readPresentation: readCloudPresentation,
        preparePresentation: (presentation) => prepareCloudPresentation(db, presentation),
        beforeReplace: cancelAllEntryNotifications,
        async recoverNotifications() {
          const profile = await loadProfile(db);
          const entries = await listCalendarEntries(db);
          await Promise.all(
            entries.map((entry) =>
              syncEntryNotifications(db, entry, profile?.timeZone ?? "Europe/Berlin"),
            ),
          );
        },
      }),
      remote: client ? createPrivateCloudClient(client, validate) : null,
      onApplied: () => reloadAppAsync("private-cloud-updated"),
    });
  }, [db]);
  useLayoutEffect(() => {
    runtime.setAllowed(allowed);
  }, [runtime, allowed]);
  const status = useSyncExternalStore(runtime.subscribe, runtime.snapshot, runtime.snapshot);
  async function refreshAccount() {
    const epoch = accountEpoch.current;
    const value = await auth.getSession();
    if (epoch !== accountEpoch.current) return;
    setUser(value);
    runtime.setAccount(value?.id ?? null);
    setAccountReady(true);
  }
  useEffect(() => {
    let active = true;
    const stop = auth.subscribe((value) => {
      if (!active) return;
      accountEpoch.current++;
      setUser(value);
      runtime.setAccount(value?.id ?? null);
      setAccountReady(true);
    });
    const cancelInitialization = startupPresentation.after(() => {
      void migratePrivateCloud(db)
        .then(async () => {
          if (!active) return;
          setInitialized(true);
          const epoch = accountEpoch.current;
          try {
            const value = await auth.getSession();
            if (!active || epoch !== accountEpoch.current) return;
            setUser(value);
            runtime.setAccount(value?.id ?? null);
          } catch {
            // An offline session restore does not prevent an explicit later sign-in.
          } finally {
            if (active) setAccountReady(true);
          }
        })
        .catch(() => {
          if (active)
            setInitializationError(
              "Dein Cloud-Konto konnte auf diesem Gerät nicht vorbereitet werden. Bitte starte LUNA Shift neu.",
            );
        });
    });
    return () => {
      cancelInitialization();
      active = false;
      stop();
      runtime.setAccount(null);
    };
  }, [auth, db, runtime]);
  useEffect(() => {
    if (!initialized) return;
    const cancelStartup = startupPresentation.after(() => {
      void runtime.synchronize();
    });
    const interval = setInterval(() => {
      if (startupPresentation.isReady()) void runtime.synchronize();
    }, 30000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && startupPresentation.isReady()) void runtime.synchronize();
    });
    return () => {
      cancelStartup();
      clearInterval(interval);
      subscription.remove();
    };
  }, [initialized, runtime, user, ready, segments, testMonths.length]);
  return (
    <PrivateCloudContext.Provider
      value={{
        user,
        status,
        runtime,
        refreshAccount,
        saveName: async (expectedAccountId, givenName, familyName) => {
          const client = getSharingSupabaseClient();
          if (!client) throw new UserFacingError("Dein Konto ist gerade nicht erreichbar.");
          await saveAccountName(
            {
              isCurrentAccount: runtime.isCurrentAccount,
              updateName: auth.updateName,
              saveSharingName: createCloudSharingClient(client).saveProfile,
              refreshAccount,
            },
            expectedAccountId,
            givenName,
            familyName,
          );
        },
        ready: initialized && accountReady,
        initializationError,
      }}
    >
      {children}
    </PrivateCloudContext.Provider>
  );
}
