import { Text, TextInput } from "@/ui/text";
import { useOnboardingPalette } from "@/theme/onboarding";
import { CONTROL_HEIGHT, SPACING } from "@/theme/tokens";
import { s } from "./onboarding-screen.styles";
import { router } from "expo-router";
import { useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { usePflegeShiftProfile } from "@/application/pflegeshift-provider";
import { defaultHolidayRegion, holidayRegionsForState } from "@/domain/employment-profile";
import { userFacingErrorMessage } from "@/domain/errors";
import {
  FEDERAL_STATES,
  FEDERAL_STATE_LABELS,
  HOLIDAY_REGION_LABELS,
  INDUSTRY_LABELS,
  type FederalState,
  type HolidayRegion,
  type Industry,
} from "@/domain/types";
import {
  manualMonthlyGrossFieldError,
  parseManualMonthlyGrossCents,
} from "@/features/settings/settings-form-values";
import { focusInvalidField, weeklyHoursFieldError } from "@/ui/form-validation";
import {
  BlueprintIcon,
  type BlueprintIconName,
  FieldError,
  SelectField,
} from "./onboarding-controls";
import { OnboardingWorkTime } from "./onboarding-work-time";
import { SALARY_BASIS_OPTIONS } from "@/features/settings/salary-basis-options";
import { OnboardingSalary, type OnboardingSalaryView } from "./onboarding-salary";
import { OnboardingBrand } from "./onboarding-brand";
import { OnboardingCheck, OnboardingIndustry } from "./onboarding-industry";
import { OnboardingReveal, useOnboardingReducedMotion } from "./onboarding-motion";
import {
  EMPTY_TARIFF_SELECTION,
  onboardingTariffErrors,
  onboardingTariffProfile,
  isTrainingTariff,
  type OnboardingTariffSelection,
} from "./onboarding-tariff-values";

type Step = 2 | 3 | 4 | 5;
type SalaryMode = "MANUAL" | "TARIFF" | "LATER";
const STEP_ORDER = [2, 4, 3, 5] as const;
type Errors = Partial<
  Record<
    | "industry"
    | "salary"
    | "gross"
    | "group"
    | "level"
    | "sector"
    | "hours"
    | "state"
    | "region"
    | "tariff"
    | "tariffRegion"
    | "year"
    | "fulltime",
    string
  >
>;

/** Shared settings conversion, retaining decimal-comma and decimal-point compatibility. */
export function parseWeeklyHours(value: string): number {
  const hours = Number(value.trim().replace(",", "."));
  if (!Number.isFinite(hours)) throw new Error("Bitte gültige Wochenstunden angeben.");
  return Math.round(hours * 60);
}
/** Normalize correctly grouped German thousands before using the existing salary parser. */
export function normalizeOnboardingGross(value: string): string {
  const trimmed = value.trim();
  return /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(trimmed) ? trimmed.replace(/\./g, "") : trimmed;
}
export function OnboardingScreen({ preview = false }: { readonly preview?: boolean }) {
  const p = useOnboardingPalette();
  const reduced = useOnboardingReducedMotion();
  const { profile, updateProfile } = usePflegeShiftProfile();
  const testMode = preview || profile != null;
  const [step, setStep] = useState<Step>(STEP_ORDER[0]);
  const [industry, setIndustry] = useState<Industry | null>(null);
  const [salaryMode, setSalaryMode] = useState<SalaryMode | null>(null);
  const [salaryView, setSalaryView] = useState<OnboardingSalaryView>("choice");
  const [gross, setGross] = useState("");
  const [tariffSelection, setTariffSelection] =
    useState<OnboardingTariffSelection>(EMPTY_TARIFF_SELECTION);
  const [weeklyHours, setWeeklyHours] = useState("38,5");
  const [percentageBasis, setPercentageBasis] = useState(38.5);
  const [adjustingPercentage, setAdjustingPercentage] = useState(false);
  const [federalState, setFederalState] = useState<FederalState | null>(null);
  const [holidayRegion, setHolidayRegion] = useState<HolidayRegion>("UNKNOWN");
  const [errors, setErrors] = useState<Errors>({});
  const [saveError, setSaveError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const grossRef = useRef<TextInput>(null);
  const hoursRef = useRef<TextInput>(null);
  const [editingSummary, setEditingSummary] = useState(false);
  function draft() {
    return {
      industry,
      salaryMode,
      salaryView,
      gross,
      tariffSelection,
      weeklyHours,
      percentageBasis,
      federalState,
      holidayRegion,
    };
  }
  const editSnapshot = useRef<ReturnType<typeof draft> | null>(null);
  const displayStep = STEP_ORDER.indexOf(step) + 1;
  function moveTo(next: Step) {
    if (savingRef.current) return;
    setErrors({});
    setSaveError(undefined);
    setAdjustingPercentage(false);
    if (next === 3)
      setSalaryView(
        salaryMode === "MANUAL"
          ? "manual"
          : salaryMode === "TARIFF"
            ? tariffSelection.mode
              ? "details"
              : "tariffs"
            : "choice",
      );
    setStep(next);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }
  function clearError(key: keyof Errors) {
    setErrors((previous) => ({ ...previous, [key]: undefined }));
  }
  function moveSalary(view: OnboardingSalaryView) {
    if (savingRef.current) return;
    setSalaryView(view);
    setErrors({});
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }
  function skipSalary() {
    if (savingRef.current) return;
    setSalaryMode("LATER");
    setSalaryView("choice");
    setEditingSummary(false);
    editSnapshot.current = null;
    moveTo(5);
  }
  function edit(target: Step) {
    if (savingRef.current) return;
    editSnapshot.current = draft();
    setEditingSummary(true);
    moveTo(target);
  }
  function back() {
    if (savingRef.current) return;
    if (step === 3 && salaryView !== "choice") {
      moveSalary(salaryView === "details" ? "tariffs" : "choice");
      return;
    }
    if (editingSummary) {
      const previous = editSnapshot.current;
      if (previous) {
        setIndustry(previous.industry);
        setSalaryMode(previous.salaryMode);
        setSalaryView(previous.salaryView);
        setGross(previous.gross);
        setTariffSelection(previous.tariffSelection);
        setWeeklyHours(previous.weeklyHours);
        setPercentageBasis(previous.percentageBasis);
        setFederalState(previous.federalState);
        setHolidayRegion(previous.holidayRegion);
      }
      editSnapshot.current = null;
      setEditingSummary(false);
      moveTo(5);
    } else moveTo(STEP_ORDER[Math.max(0, displayStep - 2)]);
  }
  function advance() {
    if (savingRef.current) return;
    const nextErrors: Errors = {};
    if (step === 2 && !industry) nextErrors.industry = "Bitte wähle deinen Berufsbereich aus.";
    if (step === 3) {
      if (!salaryMode) nextErrors.salary = "Bitte wähle eine Gehaltsgrundlage aus.";
      if (salaryMode === "MANUAL")
        nextErrors.gross =
          manualMonthlyGrossFieldError(normalizeOnboardingGross(gross)) ?? undefined;
      if (salaryMode === "TARIFF")
        Object.assign(
          nextErrors,
          onboardingTariffErrors(tariffSelection, parseWeeklyHours(weeklyHours)),
        );
    }
    if (step === 4) {
      nextErrors.hours = /^\d+(?:[,.]\d{1,2})?$/.test(weeklyHours.trim())
        ? (weeklyHoursFieldError(weeklyHours.trim()) ?? undefined)
        : "Bitte gültige Wochenstunden angeben.";
      const numericHours = Number(weeklyHours.trim().replace(",", "."));
      if (!nextErrors.hours && (numericHours < 1 || numericHours > 80))
        nextErrors.hours = "Die Wochenarbeitszeit muss zwischen 1 und 80 Stunden liegen.";
      if (!federalState) nextErrors.state = "Bitte wähle das Bundesland deines Arbeitsorts.";
      if (federalState && holidayRegion === "UNKNOWN")
        nextErrors.region = "Bitte die Feiertagsregion am Arbeitsort auswählen.";
    }
    setErrors(nextErrors);
    const firstError = Object.values(nextErrors).find(Boolean);
    if (firstError) {
      if (nextErrors.gross) focusInvalidField(grossRef, nextErrors.gross);
      else if (nextErrors.hours) focusInvalidField(hoursRef, nextErrors.hours);
      else AccessibilityInfo.announceForAccessibility(firstError);
      return;
    }
    if (editingSummary) {
      editSnapshot.current = null;
      setEditingSummary(false);
      moveTo(5);
    } else {
      const next = STEP_ORDER[displayStep];
      if (next) moveTo(next);
    }
  }
  async function finish() {
    if (savingRef.current) return;
    if (testMode) {
      savingRef.current = true;
      router.back();
      return;
    }
    if (!industry || !salaryMode || !federalState || holidayRegion === "UNKNOWN") return;
    if (salaryMode === "TARIFF") {
      const tariffErrors = onboardingTariffErrors(tariffSelection, parseWeeklyHours(weeklyHours));
      if (Object.values(tariffErrors).some(Boolean)) {
        editSnapshot.current = draft();
        setSalaryView("details");
        setErrors(tariffErrors);
        setEditingSummary(true);
        setStep(3);
        return;
      }
    }
    savingRef.current = true;
    setSaving(true);
    setSaveError(undefined);
    try {
      await updateProfile({
        industry,
        federalState,
        holidayRegion,
        weeklyMinutes: parseWeeklyHours(weeklyHours),
        timeZone: "Europe/Berlin",
        ...(salaryMode === "TARIFF"
          ? onboardingTariffProfile(tariffSelection, parseWeeklyHours(weeklyHours))
          : {
              tariff: null,
              manualMonthlyGrossCents:
                salaryMode === "MANUAL"
                  ? parseManualMonthlyGrossCents(normalizeOnboardingGross(gross))
                  : null,
            }),
      });
      router.replace("/");
    } catch (error) {
      savingRef.current = false;
      setSaveError(
        userFacingErrorMessage(error, "Einrichtung fehlgeschlagen. Bitte erneut versuchen."),
      );
    } finally {
      setSaving(false);
    }
  }
  const titles: Record<Step, string> = {
    2: "Wo arbeitest du?",
    3: {
      choice: "Wie möchtest du dein Gehalt einrichten?",
      tariffs: "Welcher Tarif gilt für dich?",
      details: "Deine Tarifangaben",
      manual: "Wie hoch ist dein Monatsbrutto?",
    }[salaryView],
    4: "Wie viel arbeitest du?",
    5: "Passt alles?",
  };
  const copies: Record<Step, string> = {
    2: "",
    3: salaryView === "choice" ? "Für deine Gehaltsprognose." : "",
    4: "",
    5: "Du kannst deine Angaben jederzeit ändern.",
  };
  const grossCents = parseManualMonthlyGrossCents(normalizeOnboardingGross(gross));
  const salaryLabel =
    salaryMode === "LATER"
      ? "Später einrichten"
      : salaryMode === "MANUAL"
        ? `${((grossCents ?? 0) / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € brutto / Monat`
        : `${SALARY_BASIS_OPTIONS.find((option) => option.value === tariffSelection.mode)?.label ?? "Tarif"} · ${isTrainingTariff(tariffSelection.mode) ? `${tariffSelection.trainingYear}. Ausbildungsjahr` : `${tariffSelection.group} · Stufe ${tariffSelection.level}`}`;
  return (
    <SafeAreaView style={[s.safe, { backgroundColor: p.canvas }]}>
      <KeyboardAvoidingView style={s.safe} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={s.progressHeader}>
          <Pressable
            accessibilityLabel="Zurück"
            accessibilityRole="button"
            disabled={saving || (step === STEP_ORDER[0] && !editingSummary)}
            onPress={back}
            style={[
              s.back,
              { opacity: step === STEP_ORDER[0] && !editingSummary ? 0 : saving ? 0.5 : 1 },
            ]}
          >
            <Text style={[s.label, { color: p.text }]}>‹</Text>
          </Pressable>
          <View style={s.progressRight}>
            {testMode ? (
              <Pressable
                accessibilityLabel="Testmodus schließen"
                accessibilityRole="button"
                disabled={saving}
                onPress={() => void finish()}
                style={s.back}
              >
                <Text style={[s.caption, { color: p.muted }]} testID="onboarding-preview-hint">
                  Schließen
                </Text>
              </Pressable>
            ) : null}
            <View
              accessible
              accessibilityLabel={`Schritt ${displayStep} von ${STEP_ORDER.length}`}
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 1, max: STEP_ORDER.length, now: displayStep }}
              style={s.progressDots}
            >
              <Text style={[s.caption, { color: p.text }]}>
                {displayStep} / {STEP_ORDER.length}
              </Text>
            </View>
            <Text style={[s.caption, { color: p.text, fontWeight: "600" }]}>LUNA Shift</Text>
          </View>
        </View>
        <View accessibilityElementsHidden style={s.track}>
          {STEP_ORDER.map((value, index) => (
            <View
              key={value}
              style={[s.segment, { backgroundColor: index < displayStep ? p.accent : p.control }]}
            />
          ))}
        </View>
        <ScrollView
          testID="onboarding-scroll-content"
          style={s.scrollViewport}
          scrollEnabled={!adjustingPercentage}
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          contentContainerStyle={s.scroll}
        >
          <View pointerEvents={saving ? "none" : "auto"}>
            <OnboardingReveal reduced={reduced} appearance={step} style={s.content}>
              {step === STEP_ORDER[0] ? <OnboardingBrand reduced={reduced} /> : null}
              <View style={s.titleGroup}>
                {step === 3 && salaryView !== "choice" ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Gehaltsgrundlage"
                    onPress={() => moveSalary("choice")}
                    style={s.back}
                  >
                    <Text style={[s.caption, { color: p.muted }]}>‹ Gehaltsgrundlage</Text>
                  </Pressable>
                ) : null}
                {step === 5 ? (
                  <View
                    accessibilityElementsHidden
                    style={[s.complete, { backgroundColor: p.highlight }]}
                  >
                    <OnboardingCheck color={p.onHighlight} size={24} />
                  </View>
                ) : null}
                {step === 2 ? (
                  <Text style={[s.caption, { color: p.muted }]}>Dein Bereich</Text>
                ) : null}
                <Text accessibilityRole="header" style={[s.title, { color: p.text }]}>
                  {titles[step]}
                </Text>
                {copies[step] ? (
                  <Text style={[s.body, { color: p.muted }]}>{copies[step]}</Text>
                ) : null}
              </View>
              {step === 2 ? (
                <OnboardingIndustry
                  value={industry}
                  onChange={(value) => {
                    setIndustry(value);
                    clearError("industry");
                  }}
                  error={errors.industry}
                  reduced={reduced}
                />
              ) : null}
              {step === 3 ? (
                <OnboardingSalary
                  view={salaryView}
                  reduced={reduced}
                  selection={tariffSelection}
                  errors={errors}
                  federalState={federalState}
                  gross={gross}
                  grossRef={grossRef}
                  onGrossChange={(value) => {
                    setGross(value);
                    clearError("gross");
                  }}
                  onSelectionChange={(value) => {
                    setTariffSelection(value);
                    setErrors({});
                  }}
                  onModeChange={(mode) => {
                    setSalaryMode(mode);
                    moveSalary(
                      mode === "MANUAL" ? "manual" : tariffSelection.mode ? "details" : "tariffs",
                    );
                  }}
                  onTariffChange={(mode) => {
                    if (tariffSelection.mode !== mode)
                      setTariffSelection({ ...EMPTY_TARIFF_SELECTION, mode });
                    moveSalary("details");
                  }}
                  onTariffPicker={() => moveSalary("tariffs")}
                />
              ) : null}
              {step === 4 ? (
                <View style={s.fields}>
                  <View style={s.list}>
                    <OnboardingWorkTime
                      hours={weeklyHours}
                      basis={percentageBasis}
                      onBasisChange={setPercentageBasis}
                      onHoursChange={(value) => {
                        setWeeklyHours(value);
                        clearError("hours");
                      }}
                      onInteractionChange={setAdjustingPercentage}
                      inputRef={hoursRef}
                      error={errors.hours}
                    />
                  </View>
                  <SelectField
                    label="Bundesland deines Arbeitsorts"
                    icon="map-marker-outline"
                    value={federalState}
                    options={FEDERAL_STATES.map((value) => ({
                      value,
                      label: FEDERAL_STATE_LABELS[value],
                    }))}
                    error={errors.state}
                    onChange={(value) => {
                      setFederalState(value);
                      setHolidayRegion(defaultHolidayRegion(value));
                      setErrors((previous) => ({
                        ...previous,
                        state: undefined,
                        region: undefined,
                      }));
                    }}
                  />
                  {federalState && holidayRegionsForState(federalState).length > 1 ? (
                    <SelectField
                      label="Regionale Feiertage am Arbeitsort"
                      value={holidayRegion === "UNKNOWN" ? null : holidayRegion}
                      options={holidayRegionsForState(federalState)
                        .filter((value) => value !== "UNKNOWN")
                        .map((value) => ({ value, label: HOLIDAY_REGION_LABELS[value] }))}
                      error={errors.region}
                      onChange={(value) => {
                        setHolidayRegion(value);
                        clearError("region");
                      }}
                    />
                  ) : null}
                </View>
              ) : null}
              {step === 5 ? (
                <View>
                  <View style={[s.summaryCard, { backgroundColor: p.canvas }]}>
                    {[
                      {
                        label: "Berufsbereich",
                        icon: "heart-pulse",
                        value: industry ? INDUSTRY_LABELS[industry] : "",
                        target: 2,
                      },
                      {
                        label: "Arbeitszeit",
                        value: `${weeklyHours} h / Woche`,
                        target: 4,
                        icon: "clock-outline",
                      },
                      {
                        label: "Arbeitsort",
                        icon: "map-marker-outline",
                        value: federalState
                          ? `${FEDERAL_STATE_LABELS[federalState]}${holidayRegionsForState(federalState).length > 1 ? ` · ${HOLIDAY_REGION_LABELS[holidayRegion]}` : ""}`
                          : "",
                        target: 4,
                      },
                      { label: "Gehalt", value: salaryLabel, target: 3, icon: "database" },
                    ].map((row) => (
                      <Pressable
                        key={row.label}
                        accessibilityRole="button"
                        accessibilityLabel={`${row.label} bearbeiten`}
                        accessibilityHint={row.value}
                        disabled={saving}
                        onPress={() => edit(row.target as Step)}
                        style={[
                          s.summaryRow,
                          {
                            borderBottomColor: p.border,
                            borderBottomWidth: row.label === "Gehalt" ? 0 : 1,
                          },
                        ]}
                      >
                        <BlueprintIcon name={row.icon as BlueprintIconName} />
                        <View style={s.summaryCopy}>
                          <Text style={[s.caption, { color: p.muted }]}>{row.label}</Text>
                          <Text style={[s.body, { color: p.text }]}>{row.value}</Text>
                        </View>
                        <Text accessibilityElementsHidden style={[s.label, { color: p.muted }]}>
                          ↗
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={[s.caption, s.centered, { color: p.muted, marginTop: SPACING.xl }]}>
                    Ohne Konto. Auf deinem Gerät.
                  </Text>
                </View>
              ) : null}
            </OnboardingReveal>
          </View>
        </ScrollView>
        <View style={[s.footer, { backgroundColor: p.canvas }]} testID="onboarding-fixed-footer">
          <FieldError message={saveError} />
          {step !== 3 || salaryView !== "tariffs" ? (
            <Pressable
              hitSlop={2}
              accessibilityRole="button"
              accessibilityLabel={saving ? "LUNA Shift wird eingerichtet" : undefined}
              accessibilityState={{ busy: saving, disabled: saving || (step === 2 && !industry) }}
              disabled={saving || (step === 2 && !industry)}
              onPress={() => {
                if (step === 5) void finish();
                else if (step === 3 && salaryView === "choice") skipSalary();
                else advance();
              }}
              testID="onboarding-primary-action"
              style={[
                s.primary,
                {
                  backgroundColor: p.accent,
                  opacity: saving || (step === 2 && !industry) ? 0.4 : 1,
                },
              ]}
            >
              {saving ? (
                <ActivityIndicator color={p.onAccent} />
              ) : (
                <Text style={[s.buttonText, { color: p.onAccent }]}>
                  {step === 5
                    ? "Zum Kalender"
                    : step === 3 && salaryView === "choice"
                      ? "Später einrichten"
                      : editingSummary
                        ? "Übernehmen"
                        : "Weiter"}
                </Text>
              )}
            </Pressable>
          ) : null}
          {step === 3 && salaryView !== "choice" ? (
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={skipSalary}
              style={s.back}
            >
              <Text style={[s.caption, s.centered, { color: p.muted }]}>Später einrichten</Text>
            </Pressable>
          ) : null}
          {step === STEP_ORDER[0] && !preview && Platform.OS === "ios" ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/account")}
              style={{
                minHeight: CONTROL_HEIGHT.regular,
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <Text style={[s.caption, { color: p.text }]}>Schon ein Konto? Anmelden</Text>
            </Pressable>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
