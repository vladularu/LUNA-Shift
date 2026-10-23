import { validateWorkingTimeTargetContext } from "@/domain/saved-working-time-target";
import { useState, type PropsWithChildren } from "react";
import { View } from "react-native";
import { holidayRegionsForState, defaultHolidayRegion } from "@/domain/employment-profile";
import { userFacingErrorMessage } from "@/domain/errors";
import {
  FEDERAL_STATES,
  FEDERAL_STATE_LABELS,
  HOLIDAY_REGION_LABELS,
  type FederalState,
  type HolidayRegion,
  type UserProfile,
} from "@/domain/types";
import type {
  TargetDayFact,
  TargetProfilePeriod,
  TargetWorkModel,
  WorkingTimeTargetContext,
} from "@/domain/working-time-target";
import { WorkingTimeTargetError } from "@/domain/working-time-target-validation";
import { TVOED_K_TARGET_REVIEW } from "@/engine/working-time-target-rules";
import { SPACING } from "@/theme/tokens";
import { CardSeparator, SectionHeader, SurfaceCard, InlineNotice } from "@/ui/design-system";
import { Field, PrimaryButton, SecondaryButton } from "@/ui/form-controls";
import { FormStatus } from "@/ui/form-layout";
import { ProfileChoice } from "./profile-selection";
import { parseTargetMinutes, targetMinutesText } from "./working-time-target-form-model";

const ANSWERS = [
  { value: "UNKNOWN", label: "Noch nicht geklärt" },
  { value: "YES", label: "Ja, bestätigt" },
  { value: "NO", label: "Nein" },
] as const;
const answer = (value: boolean | null | undefined) =>
  value == null ? "UNKNOWN" : value ? "YES" : "NO";
const boolean = (value: string) => (value === "UNKNOWN" ? null : value === "YES");
const WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
function Inputs({ children }: PropsWithChildren) {
  return <View style={{ padding: SPACING.md, gap: SPACING.sm }}>{children}</View>;
}

export function TargetPeriodForm({
  initial,
  profile,
  employment,
  busy,
  onDirty,
  onSave,
}: {
  readonly initial?: TargetProfilePeriod;
  readonly profile: UserProfile;
  readonly employment?: WorkingTimeTargetContext["employment"];
  readonly busy: boolean;
  readonly onDirty: () => void;
  readonly onSave: (
    value: TargetProfilePeriod,
    employment: WorkingTimeTargetContext["employment"],
  ) => Promise<void>;
}) {
  const [from, setFrom] = useState(initial?.validFrom ?? ""),
    [through, setThrough] = useState(initial?.validTo ?? "");
  const [weekly, setWeekly] = useState(
    targetMinutesText(initial?.weeklyMinutes ?? profile.weeklyMinutes),
  );
  const [state, setState] = useState<FederalState>(initial?.federalState ?? profile.federalState),
    [region, setRegion] = useState<HolidayRegion>(initial?.holidayRegion ?? profile.holidayRegion);
  const [model, setModel] = useState<TargetWorkModel["kind"]>(initial?.model.kind ?? "UNKNOWN");
  const [weekdays, setWeekdays] = useState(
    initial?.model.kind === "FIXED_WEEK"
      ? initial.model.weekdayMinutes.map(targetMinutesText)
      : WEEKDAYS.map(() => "0:00"),
  );
  const [reference, setReference] = useState(
    initial?.model.kind === "ROTATING_FIVE_IN_SEVEN" ? "WEEKDAYS_ONE_FIFTH" : "UNKNOWN",
  );
  const [sevenDays, setSevenDays] = useState(
    answer(
      initial?.model.kind === "ROTATING_FIVE_IN_SEVEN"
        ? initial.model.sevenDayShiftPlanConfirmed
        : null,
    ),
  );
  const [tariff, setTariff] = useState(initial?.tariff.kind ?? "UNVERIFIED");
  const tariffVersion =
    initial?.tariff.kind === "TVOED_K" ? initial.tariff.version : TVOED_K_TARGET_REVIEW.version;
  const tariffReviewed = tariffVersion === TVOED_K_TARGET_REVIEW.version;
  const [scope, setScope] = useState(
    answer(initial?.tariff.kind === "TVOED_K" ? initial.tariff.scopeConfirmed : null),
  );
  const [employmentFrom, setEmploymentFrom] = useState(employment?.from ?? ""),
    [employmentTo, setEmploymentTo] = useState(employment?.to ?? "");
  const [error, setError] = useState<string | null>(null);
  function change<T>(setter: (value: T) => void, value: T) {
    setter(value);
    onDirty();
    setError(null);
  }
  async function submit() {
    try {
      if (model === "ROTATING_FIVE_IN_SEVEN" && reference !== "WEEKDAYS_ONE_FIFTH")
        throw new WorkingTimeTargetError(
          "Bitte die betriebliche Monatsbasis klären. Eine wechselnde 5-Tage-Woche belegt keine Montag-bis-Freitag-Berechnung.",
        );
      if (employmentTo && !employmentFrom)
        throw new WorkingTimeTargetError("Bitte auch den Beschäftigungsbeginn angeben.");
      const value: TargetProfilePeriod = {
        validFrom: from.trim(),
        validTo: through.trim() || null,
        weeklyMinutes: parseTargetMinutes(weekly),
        federalState: state,
        holidayRegion: region,
        model:
          model === "FIXED_WEEK"
            ? {
                kind: model,
                weekdayMinutes: weekdays.map((value) => parseTargetMinutes(value, 1440)) as [
                  number,
                  number,
                  number,
                  number,
                  number,
                  number,
                  number,
                ],
              }
            : model === "ROTATING_FIVE_IN_SEVEN"
              ? {
                  kind: model,
                  monthlyReference: "WEEKDAYS_ONE_FIFTH",
                  sevenDayShiftPlanConfirmed: boolean(sevenDays),
                }
              : { kind: "UNKNOWN" },
        tariff:
          tariff === "TVOED_K"
            ? {
                kind: tariff,
                version: tariffVersion,
                scopeConfirmed: boolean(scope),
              }
            : tariff === "CUSTOM"
              ? { kind: tariff }
              : {
                  kind: "UNVERIFIED",
                  id: initial?.tariff.kind === "UNVERIFIED" ? initial.tariff.id : "UNCONFIRMED",
                },
      };
      const bounds = employmentFrom.trim()
        ? { from: employmentFrom.trim(), to: employmentTo.trim() || null }
        : undefined;
      validateWorkingTimeTargetContext({
        periods: [value],
        days: [],
        ...(bounds ? { employment: bounds } : {}),
      });
      await onSave(value, bounds);
    } catch (error) {
      setError(userFacingErrorMessage(error, "Bitte die Zeiträume und Arbeitszeitangaben prüfen."));
    }
  }
  return (
    <View style={{ gap: SPACING.sm }}>
      <SectionHeader
        title={initial ? "Zeitraum bearbeiten" : "Arbeitszeitmodell festhalten"}
        caption="Der Gehaltstarif bestätigt diese Angaben nicht automatisch."
      />
      <SurfaceCard>
        <Inputs>
          <Field
            label="Gültig ab (JJJJ-MM-TT)"
            value={from}
            editable={!busy && !initial}
            onChangeText={(value) => change(setFrom, value)}
            placeholder="2026-12-01"
          />
          <Field
            label="Gültig bis (optional)"
            value={through}
            editable={!busy}
            onChangeText={(value) => change(setThrough, value)}
            placeholder="JJJJ-MM-TT"
          />
          <Field
            label="Wochenarbeitszeit (Std:Min)"
            value={weekly}
            editable={!busy}
            onChangeText={(value) => change(setWeekly, value)}
            placeholder="38:30"
          />
        </Inputs>
        <ProfileChoice
          label="Arbeitsort im Zeitraum"
          value={state}
          options={FEDERAL_STATES.map((value) => ({ value, label: FEDERAL_STATE_LABELS[value] }))}
          onChange={(value) => {
            change(setState, value);
            setRegion(defaultHolidayRegion(value));
          }}
        />
        {holidayRegionsForState(state).length > 1 ? (
          <ProfileChoice
            label="Feiertagsregion im Zeitraum"
            value={region}
            options={holidayRegionsForState(state).map((value) => ({
              value,
              label: HOLIDAY_REGION_LABELS[value],
            }))}
            onChange={(value) => change(setRegion, value)}
          />
        ) : null}
        <CardSeparator />
        <ProfileChoice
          label="Verteilung der Arbeitszeit"
          value={model}
          options={[
            { value: "UNKNOWN", label: "Noch nicht geklärt" },
            { value: "FIXED_WEEK", label: "Feste Wochentage" },
            { value: "ROTATING_FIVE_IN_SEVEN", label: "Wechselnde 5 Tage im 7-Tage-Betrieb" },
          ]}
          onChange={(value) => change(setModel, value)}
        />
        {model === "FIXED_WEEK" ? (
          <Inputs>
            {WEEKDAYS.map((label, index) => (
              <Field
                key={label}
                label={`${label} (Std:Min)`}
                value={weekdays[index]}
                editable={!busy}
                onChangeText={(value) => {
                  const next = [...weekdays];
                  next[index] = value;
                  change(setWeekdays, next);
                }}
              />
            ))}
            <SecondaryButton
              disabled={busy}
              onPress={() => {
                try {
                  const minutes = parseTargetMinutes(weekly);
                  const days = Array.from({ length: 7 }, (_, index) =>
                    index >= 5 ? 0 : Math.floor(minutes / 5) + (index < minutes % 5 ? 1 : 0),
                  );
                  change(setWeekdays, days.map(targetMinutesText));
                } catch (error) {
                  setError(userFacingErrorMessage(error, "Bitte die Wochenzeit prüfen."));
                }
              }}
            >
              Gleichmäßig auf Mo–Fr verteilen
            </SecondaryButton>
          </Inputs>
        ) : model === "ROTATING_FIVE_IN_SEVEN" ? (
          <>
            <ProfileChoice
              label="Betriebliche Monatsbasis"
              value={reference}
              options={[
                { value: "UNKNOWN", label: "Noch nicht geklärt" },
                { value: "WEEKDAYS_ONE_FIFTH", label: "Bestätigt: Mo–Fr × 1/5 der Wochenzeit" },
              ]}
              onChange={(value) => change(setReference, value)}
            />
            <ProfileChoice
              label="Dienstplan umfasst alle sieben Wochentage"
              value={sevenDays}
              options={ANSWERS}
              onChange={(value) => change(setSevenDays, value)}
            />
          </>
        ) : null}
        <CardSeparator />
        <ProfileChoice
          label="Tarifliche Arbeitszeitregel"
          value={tariff}
          options={[
            { value: "UNVERIFIED", label: "Anderer Tarif / noch nicht geprüft" },
            { value: "TVOED_K", label: "TVöD-K / BT-K" },
            { value: "CUSTOM", label: "Eigene Arbeitszeit ohne Tarifansprüche" },
          ]}
          onChange={(value) => change(setTariff, value)}
        />
        {tariff === "TVOED_K" ? (
          <>
            <ProfileChoice
              label="BT-K gilt für mein Arbeitsverhältnis"
              value={scope}
              options={ANSWERS}
              onChange={(value) => change(setScope, value)}
            />
            <Inputs>
              <InlineNotice
                tone={tariffReviewed ? "info" : "warning"}
                message={
                  tariffReviewed
                    ? `Geprüfte Tarifregel: Fassung ${tariffVersion}, geprüft vom ${TVOED_K_TARGET_REVIEW.from} bis ${TVOED_K_TARGET_REVIEW.to}. Einzelne Ansprüche benötigen passende Dienstplanangaben.`
                    : `Die gespeicherte Tariffassung ${tariffVersion} ist für die Sollzeit noch nicht geprüft. Daraus werden keine bestätigten Tarifabzüge abgeleitet.`
                }
              />
            </Inputs>
          </>
        ) : null}
        <Inputs>
          <Field
            label="Beschäftigungsbeginn (optional)"
            placeholder="JJJJ-MM-TT"
            value={employmentFrom}
            editable={!busy}
            onChangeText={(value) => change(setEmploymentFrom, value)}
          />
          <Field
            label="Beschäftigungsende (optional)"
            placeholder="JJJJ-MM-TT"
            value={employmentTo}
            editable={!busy}
            onChangeText={(value) => change(setEmploymentTo, value)}
          />
        </Inputs>
      </SurfaceCard>
      <FormStatus error={error} />
      <PrimaryButton busy={busy} disabled={busy} onPress={() => void submit()}>
        Zeitraum speichern
      </PrimaryButton>
    </View>
  );
}

export function TargetDayForm({
  initial,
  busy,
  onDirty,
  onSave,
}: {
  readonly initial?: TargetDayFact;
  readonly busy: boolean;
  readonly onDirty: () => void;
  readonly onSave: (value: TargetDayFact) => Promise<void>;
}) {
  const [date, setDate] = useState(initial?.date ?? ""),
    [status, setStatus] = useState<TargetDayFact["rosterStatus"]>(initial?.rosterStatus ?? "DRAFT");
  const [disposition, setDisposition] = useState<TargetDayFact["disposition"]>(
    initial?.disposition ?? "UNKNOWN",
  );
  const [lost, setLost] = useState(
      initial?.lostMinutes == null ? "" : targetMinutesText(initial.lostMinutes),
    ),
    [elsewhere, setElsewhere] = useState(answer(initial?.mustWorkElsewhere));
  const [error, setError] = useState<string | null>(null);
  function change<T>(setter: (value: T) => void, value: T) {
    setter(value);
    onDirty();
    setError(null);
  }
  async function submit() {
    try {
      const value: TargetDayFact = {
        date: date.trim(),
        rosterStatus: status,
        disposition,
        lostMinutes:
          disposition === "WORK_REQUIRED" || disposition === "UNKNOWN" || !lost.trim()
            ? null
            : parseTargetMinutes(lost, 1440),
        mustWorkElsewhere: disposition === "ROSTER_FREE" ? boolean(elsewhere) : null,
      };
      validateWorkingTimeTargetContext({ periods: [], days: [value] });
      await onSave(value);
    } catch (error) {
      setError(userFacingErrorMessage(error, "Bitte Datum und Dienstplanangaben prüfen."));
    }
  }
  return (
    <View style={{ gap: SPACING.sm }}>
      <SectionHeader
        title="Dienstplantag"
        caption="Ein freier Kalendertag bestätigt keinen tariflichen Anspruch."
      />
      <SurfaceCard>
        <Inputs>
          <Field
            label="Datum des Dienstplantags"
            placeholder="JJJJ-MM-TT"
            value={date}
            editable={!busy && !initial}
            onChangeText={(value) => change(setDate, value)}
          />
        </Inputs>
        <ProfileChoice
          label="Dienstplanstatus"
          value={status}
          options={[
            { value: "DRAFT", label: "Vorläufig / noch offen" },
            { value: "FINAL", label: "Endgültig bestätigt" },
          ]}
          onChange={(value) => change(setStatus, value)}
        />
        <ProfileChoice
          label="Situation laut Dienstplan"
          value={disposition}
          options={[
            { value: "UNKNOWN", label: "Noch nicht geklärt" },
            { value: "WORK_REQUIRED", label: "Arbeitspflicht / Dienst" },
            { value: "ROSTER_FREE", label: "Dienstplanmäßig frei" },
            { value: "RELEASED", label: "Wegen Feiertag / Sondertag freigestellt" },
          ]}
          onChange={(value) => change(setDisposition, value)}
        />
        {disposition === "RELEASED" || disposition === "ROSTER_FREE" ? (
          <Inputs>
            <Field
              label="Bestätigte ausgefallene Arbeitszeit (Std:Min)"
              value={lost}
              editable={!busy}
              onChangeText={(value) => change(setLost, value)}
              placeholder="Unbekannt lassen, falls nicht geklärt"
            />
          </Inputs>
        ) : null}
        {disposition === "ROSTER_FREE" ? (
          <ProfileChoice
            label="Regelmäßige Arbeitszeit muss an anderen Tagen erbracht werden"
            value={elsewhere}
            options={ANSWERS}
            onChange={(value) => change(setElsewhere, value)}
          />
        ) : null}
      </SurfaceCard>
      <FormStatus error={error} />
      <PrimaryButton busy={busy} disabled={busy} onPress={() => void submit()}>
        {status === "FINAL" ? "Tag bestätigen und speichern" : "Tag vorläufig speichern"}
      </PrimaryButton>
    </View>
  );
}
