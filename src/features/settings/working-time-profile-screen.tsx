import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { usePflegeShiftProfile, usePflegeShiftStatus } from "@/application/pflegeshift-provider";
import { userFacingErrorMessage } from "@/domain/errors";
import type { WorkingTimeTargetSnapshot } from "@/domain/saved-working-time-target";
import type { TargetDayFact, TargetProfilePeriod } from "@/domain/working-time-target";
import { usePalette } from "@/theme/palette";
import { SPACING } from "@/theme/tokens";
import {
  CardSeparator,
  InlineNotice,
  RowButton,
  SectionHeader,
  SurfaceCard,
} from "@/ui/design-system";
import { SecondaryButton } from "@/ui/form-controls";
import { FormStatus } from "@/ui/form-layout";
import { LoadingView, LoadFailureView } from "@/ui/loading-view";
import { ProfilePage } from "./profile-page";
import { ProfileEditorBusyContext } from "./profile-selection";
import { useProfileLeaveGuard } from "./use-profile-leave-guard";
import { useWorkingTimeTargetSettings } from "./use-working-time-target-settings";
import { TargetPeriodForm, TargetDayForm } from "./working-time-target-editor";
import { putTargetPeriod } from "./working-time-target-form-model";

export function WorkingTimeProfileScreen() {
  const status = usePflegeShiftStatus(),
    { profile } = usePflegeShiftProfile();
  const settings = useWorkingTimeTargetSettings(status.ready && !status.error && profile !== null);
  if (status.ready && status.error)
    return <LoadFailureView message={status.error} onRetry={() => void status.reload()} />;
  if (settings.status === "error")
    return (
      <LoadFailureView
        message="Die Sollzeitangaben konnten nicht geladen werden."
        onRetry={settings.reload}
      />
    );
  if (!profile || !settings.snapshot || settings.status !== "ready") return <LoadingView />;
  return (
    <WorkingTimeProfileEditor
      key={`${settings.snapshot.saved?.revision ?? 0}/${settings.snapshot.saved?.updatedAt ?? "new"}`}
      snapshot={settings.snapshot}
      settings={settings}
    />
  );
}

function WorkingTimeProfileEditor({
  snapshot,
  settings,
}: {
  readonly snapshot: WorkingTimeTargetSnapshot;
  readonly settings: ReturnType<typeof useWorkingTimeTargetSettings>;
}) {
  const { profile } = usePflegeShiftProfile();
  const palette = usePalette();
  const { origin } = useLocalSearchParams<{ origin?: string }>();
  const context = snapshot.context ?? { periods: [], days: [] };
  // Keep evidence for other dates; only an explicit day action may rebind it.
  const persistedContext = snapshot.saved?.settings.context ?? context;
  const [mode, setMode] = useState<"PERIOD" | "DAY">("PERIOD");
  const [period, setPeriod] = useState<TargetProfilePeriod | undefined>();
  const [day, setDay] = useState<TargetDayFact | undefined>();
  const [sequence, setSequence] = useState(0),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState<string | null>(null);
  const guard = useProfileLeaveGuard(dirty, settings.busy);
  const disabled = dirty || settings.busy;
  if (!profile) return null;
  async function save(write: () => ReturnType<typeof settings.save>) {
    setError(null);
    try {
      await write();
    } catch (error) {
      setError(
        userFacingErrorMessage(
          error,
          "Die Sollzeitangaben konnten nicht gespeichert werden. Bitte erneut laden.",
        ),
      );
    }
  }
  return (
    <ProfileEditorBusyContext.Provider value={settings.busy}>
      <ProfilePage
        title="Sollzeitangaben"
        backLabel={origin === "settings" ? "Zurück zu Mehr" : "Zurück zum Arbeitsprofil"}
        onBack={() => router.back()}
        backDisabled={settings.busy}
      >
        <Stack.Screen
          options={{
            title: "Sollzeitangaben",
            headerStyle: { backgroundColor: palette.background },
            headerTintColor: palette.text,
            headerTitleStyle: { color: palette.text },
            statusBarStyle: palette.dark ? "light" : "dark",
          }}
        />
        <InlineNotice message="Hier bereitest du die datierten Grundlagen vor. Die Auswertungen verwenden diese Angaben derzeit noch nicht." />
        {snapshot.staleDates.length ? (
          <InlineNotice
            tone="warning"
            message={`Bitte diese Tage erneut prüfen: ${snapshot.staleDates.join(", ")}. Dienstplan oder Arbeitszeitangaben haben sich geändert.`}
          />
        ) : null}
        <View style={{ gap: SPACING.sm }}>
          <SectionHeader
            title="Gespeicherte Zeiträume"
            caption="Vor dem ersten bestätigten Datum bleibt die historische Arbeitszeit unbekannt."
          />
          <SurfaceCard>
            {context.periods.map((item) => (
              <RowButton
                key={item.validFrom}
                title={`Ab ${item.validFrom}`}
                subtitle={`${item.validTo ? `Bis ${item.validTo} · ` : ""}${item.model.kind === "FIXED_WEEK" ? "Feste Wochentage" : item.model.kind === "ROTATING_FIVE_IN_SEVEN" ? "Wechselnd im 7-Tage-Betrieb" : "Arbeitszeitmodell offen"}`}
                disabled={disabled}
                onPress={() => {
                  setPeriod(item);
                  setMode("PERIOD");
                  setSequence((value) => value + 1);
                }}
              />
            ))}
            <RowButton
              title="Neuen Zeitraum anlegen"
              disabled={disabled}
              onPress={() => {
                setPeriod(undefined);
                setMode("PERIOD");
                setSequence((value) => value + 1);
              }}
            />
            <CardSeparator />
            <RowButton
              title="Einzelnen Dienstplantag erfassen"
              disabled={disabled}
              onPress={() => {
                setDay(undefined);
                setMode("DAY");
                setSequence((value) => value + 1);
              }}
            />
            {context.days.map((item) => (
              <RowButton
                key={item.date}
                title={`Dienstplantag ${item.date}`}
                subtitle={item.rosterStatus === "FINAL" ? "Bestätigt" : "Vorläufig"}
                disabled={disabled}
                onPress={() => {
                  setDay(item);
                  setMode("DAY");
                  setSequence((value) => value + 1);
                }}
              />
            ))}
          </SurfaceCard>
        </View>
        {mode === "PERIOD" ? (
          <TargetPeriodForm
            key={`period/${sequence}`}
            initial={period}
            profile={profile}
            employment={context.employment}
            busy={settings.busy}
            onDirty={() => setDirty(true)}
            onSave={(value, employment) =>
              save(async () => {
                const result = putTargetPeriod(persistedContext, value);
                const { employment: _old, ...withoutEmployment } = result;
                await settings.save(
                  employment ? { ...withoutEmployment, employment } : withoutEmployment,
                );
              })
            }
          />
        ) : (
          <TargetDayForm
            key={`day/${sequence}`}
            initial={day}
            busy={settings.busy}
            onDirty={() => setDirty(true)}
            onSave={(value) =>
              save(() =>
                settings.save(
                  {
                    ...persistedContext,
                    days: [
                      ...persistedContext.days.filter((item) => item.date !== value.date),
                      value,
                    ].sort((a, b) => a.date.localeCompare(b.date)),
                  },
                  value.rosterStatus === "FINAL" ? [value.date] : [],
                ),
              )
            }
          />
        )}
        <FormStatus error={error} />
        {error ? (
          <SecondaryButton
            disabled={settings.busy}
            onPress={() => {
              guard.saved(settings.reload);
            }}
          >
            Änderungen verwerfen und neu laden
          </SecondaryButton>
        ) : dirty ? (
          <SecondaryButton
            disabled={settings.busy}
            onPress={() => {
              setDirty(false);
              setSequence((value) => value + 1);
            }}
          >
            Eingaben verwerfen
          </SecondaryButton>
        ) : null}
      </ProfilePage>
    </ProfileEditorBusyContext.Provider>
  );
}
