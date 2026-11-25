import { SoftScrollAnchor, SoftScrollScope, SoftScrollView } from "@/ui/soft-scroll-layout";
import { Text, TextInput } from "@/ui/text";
import { useOnboardingPalette } from "@/theme/onboarding";
import { CONTROL_HEIGHT, RADII, SPACING } from "@/theme/tokens";
import { s } from "./onboarding-screen.styles";
import { router } from "expo-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  type ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePflegeShiftProfile } from "@/application/pflegeshift-provider";
import { defaultHolidayRegion, holidayRegionsForState } from "@/domain/employment-profile";
import { userFacingErrorMessage } from "@/domain/errors";
import {
  FEDERAL_STATES,
  FEDERAL_STATE_LABELS,
  HOLIDAY_REGION_LABELS,
  type FederalState,
  type HolidayRegion,
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
import { OnboardingStart } from "./onboarding-start";
import { OnboardingHeader } from "./onboarding-header";
import { MOTION } from "@/theme/motion";
import { OnboardingCheck } from "./onboarding-check";
import { OnboardingReveal, useOnboardingReducedMotion } from "./onboarding-motion";
import { emptyWorkplaceData } from "@/domain/workplace-rules";
import { useWorkplaceData } from "@/features/workplace/store";
import type { OnboardingRulePage } from "@/features/workplace/rule-flow";
import { OnboardingWorkplace, type WorkplaceUpdate } from "./onboarding-workplace";
import {
  EMPTY_TARIFF_SELECTION,
  onboardingTariffErrors,
  onboardingTariffProfile,
  isTrainingTariff,
  type OnboardingTariffSelection,
} from "./onboarding-tariff-values";

type SalaryMode = "MANUAL" | "TARIFF" | "LATER";
const STEP_ORDER = [4, 3, "workplace", 5] as const;
type Step = (typeof STEP_ORDER)[number] | "plan" | "welcome" | "start";
type Errors = Partial<
  Record<
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
export function OnboardingScreen({
  preview = false,
  setupPlan = false,
}: {
  readonly preview?: boolean;
  readonly setupPlan?: boolean;
}) {
  const p = useOnboardingPalette();
  const reduced = useOnboardingReducedMotion();
  const insets = useSafeAreaInsets();
  const { profile, updateProfile } = usePflegeShiftProfile();
  const testMode = preview || profile != null;
  const workplace = useWorkplaceData();
  const workplaceError = testMode ? "" : workplace.error;
  const workplaceData = testMode ? emptyWorkplaceData : workplaceError ? null : workplace.data;
  const [workplaceUpdate, setWorkplaceUpdate] = useState<WorkplaceUpdate | null>(null);
  const workplaceComplete =
    !!workplaceUpdate || !!(workplaceData?.handled && workplaceData.history.length);
  const firstStep = setupPlan ? "welcome" : STEP_ORDER[0];
  const [step, setStep] = useState<Step>(firstStep);
  const [leavingSummary, setLeavingSummary] = useState(false);
  const [summaryOpacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!leavingSummary) return;
    function showStart() {
      setLeavingSummary(false);
      setStep("start");
    }
    if (reduced) {
      showStart();
      return;
    }
    const fade = Animated.timing(summaryOpacity, {
      toValue: 0,
      duration: MOTION.duration.instant,
      easing: MOTION.easing.navigation,
      useNativeDriver: true,
    });
    fade.start(({ finished }) => {
      if (finished) showStart();
    });
    return () => fade.stop();
  }, [leavingSummary, reduced, summaryOpacity]);
  const [workReady, setWorkReady] = useState(false);
  const [workplaceDeferred, setWorkplaceDeferred] = useState(false);
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
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [step, salaryView]);
  const grossRef = useRef<TextInput>(null);
  const hoursRef = useRef<TextInput>(null);
  const [returnPage, setReturnPage] = useState<"plan" | 5 | null>(null);
  function draft() {
    return {
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
  const atStart = step === firstStep && returnPage === null;
  const displayStep = STEP_ORDER.findIndex((item) => item === step) + 1;
  const salaryReady = salaryMode === "MANUAL" || salaryMode === "TARIFF";
  const completed = Number(workReady) + Number(salaryReady) + Number(workplaceComplete);
  const progress = setupPlan ? completed : displayStep;
  const progressMax = setupPlan ? 3 : STEP_ORDER.length;
  function moveTo(next: Step) {
    if (savingRef.current) return;
    if (next === 5) summaryOpacity.setValue(1);
    setLeavingSummary(false);
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
  }
  function clearError(key: keyof Errors) {
    setErrors((previous) => ({ ...previous, [key]: undefined }));
  }
  function moveSalary(view: OnboardingSalaryView) {
    if (savingRef.current) return;
    setSalaryView(view);
    setErrors({});
  }
  function skipSalary() {
    if (savingRef.current) return;
    setSalaryMode("LATER");
    setSalaryView("choice");
    const next = returnPage ?? "workplace";
    setReturnPage(null);
    editSnapshot.current = null;
    moveTo(next);
  }
  function edit(target: Step, from: "plan" | 5 = 5) {
    if (savingRef.current) return;
    editSnapshot.current = draft();
    setReturnPage(from);
    moveTo(target);
  }
  function back() {
    if (savingRef.current) return;
    if (step === 3 && salaryView !== "choice") {
      moveSalary(salaryView === "details" ? "tariffs" : "choice");
      return;
    }
    if (returnPage !== null) {
      const previous = editSnapshot.current;
      if (previous) {
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
      setReturnPage(null);
      moveTo(returnPage);
    } else if (step === "start") moveTo(5);
    else if (step === "plan") moveTo("welcome");
    else moveTo(setupPlan ? "plan" : STEP_ORDER[Math.max(0, displayStep - 2)]);
  }
  function advance() {
    if (savingRef.current) return;
    const nextErrors: Errors = {};
    if (step === 3) {
      if (!salaryMode) nextErrors.salary = "Bitte wähle eine Gehaltsgrundlage aus.";
      if (salaryMode === "MANUAL")
        nextErrors.gross =
          manualMonthlyGrossFieldError(normalizeOnboardingGross(gross)) ?? undefined;
      if (salaryMode === "TARIFF")
        Object.assign(
          nextErrors,
          onboardingTariffErrors(
            tariffSelection,
            setupPlan && !workReady ? 0 : parseWeeklyHours(weeklyHours),
          ),
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
    if (step === 4) setWorkReady(true);
    if (returnPage !== null) {
      editSnapshot.current = null;
      setReturnPage(null);
      moveTo(returnPage);
    } else {
      const next = STEP_ORDER[displayStep];
      if (next) moveTo(next);
    }
  }
  const nextSection = !workReady
    ? ({ target: 4, label: "Arbeitszeit einrichten" } as const)
    : salaryMode === null
      ? ({ target: 3, label: "Weiter zum Gehalt" } as const)
      : !workplaceComplete && !workplaceDeferred
        ? ({ target: "workplace", label: "Weiter zu den Sonderregelungen" } as const)
        : ({ target: 5, label: "Zur Zusammenfassung" } as const);
  function continuePlan() {
    if (nextSection.target !== 5) {
      edit(nextSection.target, "plan");
      return;
    }
    if (salaryMode === "TARIFF") {
      const invalid = onboardingTariffErrors(tariffSelection, parseWeeklyHours(weeklyHours));
      if (Object.values(invalid).some(Boolean)) {
        edit(3, "plan");
        setErrors(invalid);
        return;
      }
    }
    moveTo(5);
  }
  function leaveWorkplace(deferred = false) {
    if (deferred && !workplaceComplete) setWorkplaceDeferred(true);
    editSnapshot.current = null;
    setReturnPage(null);
    moveTo(returnPage ?? 5);
  }
  async function finish() {
    if (savingRef.current) return;
    if (testMode) {
      savingRef.current = true;
      router.back();
      return;
    }
    if (!salaryMode || !federalState || holidayRegion === "UNKNOWN") return;
    if (salaryMode === "TARIFF") {
      const tariffErrors = onboardingTariffErrors(tariffSelection, parseWeeklyHours(weeklyHours));
      if (Object.values(tariffErrors).some(Boolean)) {
        editSnapshot.current = draft();
        setSalaryView("details");
        setErrors(tariffErrors);
        setReturnPage(5);
        setStep(3);
        return;
      }
    }
    savingRef.current = true;
    setSaving(true);
    setSaveError(undefined);
    try {
      if (workplaceUpdate) {
        await workplace.save(workplaceUpdate);
        setWorkplaceUpdate(null);
      }
      await updateProfile({
        industry: "HEALTHCARE",
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
  if (step === "start") {
    return (
      <OnboardingStart
        testMode={testMode}
        preview={preview}
        reducedMotion={reduced}
        onBack={back}
        onFinish={finish}
        saveError={saveError}
      />
    );
  }
  const titles: Record<Exclude<Step, "start">, string> = {
    3: {
      choice: "Wie möchtest du dein Gehalt einrichten?",
      tariffs: "Welcher Tarif gilt für dich?",
      details: "Deine Tarifangaben",
      manual: "Wie hoch ist dein Monatsbrutto?",
    }[salaryView],
    4: "Wie viel arbeitest du?",
    plan: "Dein Einrichtungsplan",
    welcome: "Willkommen bei LUNA Shift",
    workplace: "Sonderregelungen in deinem Betrieb",
    5: "Passt alles?",
  };
  const copies: Record<Exclude<Step, "start">, string> = {
    3: salaryView === "choice" ? "Für deine Gehaltsprognose." : "",
    4: "",
    plan:
      workReady || salaryMode !== null || workplaceComplete || workplaceDeferred
        ? "Du kannst jeden Bereich noch einmal öffnen."
        : "Wähle, womit du anfangen möchtest.",
    welcome: "Dein Dienstplan. Deine Arbeitszeit. Dein Überblick.",
    workplace: workplaceComplete
      ? "Deine Angaben sind für den Dienstplan-Check erfasst."
      : "Wenn bei euch besondere Regeln für Dienste oder Ruhezeiten gelten, kannst du sie hier angeben. Du kannst die Fragen auch später im Dienstplan-Check beantworten.",
    5: "Du kannst deine Angaben jederzeit ändern.",
  };
  const grossCents = parseManualMonthlyGrossCents(normalizeOnboardingGross(gross));
  const salaryLabel =
    salaryMode === "LATER"
      ? "Später einrichten"
      : salaryMode === "MANUAL"
        ? `${((grossCents ?? 0) / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € brutto / Monat`
        : `${SALARY_BASIS_OPTIONS.find((option) => option.value === tariffSelection.mode)?.label ?? "Tarif"} · ${isTrainingTariff(tariffSelection.mode) ? `${tariffSelection.trainingYear}. Ausbildungsjahr` : `${tariffSelection.group} · Stufe ${tariffSelection.level}`}`;
  const workplaceStatus = workplaceComplete
    ? "Angaben erfasst"
    : workplaceDeferred
      ? "Später im Dienstplan-Check"
      : "Optional · für den Dienstplan-Check";
  const workplaceLoading = step === "workplace" && !workplaceData && !workplaceError;
  const page = (workplacePage?: OnboardingRulePage) => (
    <View
      style={[
        s.safe,
        {
          backgroundColor: p.canvas,
          paddingLeft: insets.left,
          paddingRight: insets.right,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      <KeyboardAvoidingView style={s.safe} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <SoftScrollScope>
          <SoftScrollAnchor>
            <OnboardingHeader
              onBack={workplacePage?.back ?? back}
              busy={saving || workplacePage?.busy || leavingSummary}
              atStart={atStart}
              onClose={testMode ? () => void finish() : undefined}
            >
              {step !== "welcome" && (
                <View
                  accessible
                  accessibilityLabel={
                    setupPlan
                      ? `${completed} von 3 Bereichen eingerichtet`
                      : `Schritt ${displayStep} von ${STEP_ORDER.length}`
                  }
                  accessibilityRole="progressbar"
                  accessibilityValue={{ min: setupPlan ? 0 : 1, max: progressMax, now: progress }}
                  style={s.progressDots}
                >
                  <Text style={[s.caption, { color: p.text }]}>
                    {progress} / {progressMax}
                  </Text>
                </View>
              )}
              {!setupPlan && (
                <Text style={[s.caption, { color: p.text, fontWeight: "600" }]}>LUNA Shift</Text>
              )}
            </OnboardingHeader>
            {step !== "welcome" && (
              <View accessibilityElementsHidden style={s.track}>
                {STEP_ORDER.slice(0, progressMax).map((value, index) => (
                  <View
                    key={value}
                    style={[
                      s.segment,
                      { backgroundColor: index < progress ? p.accent : p.control },
                    ]}
                  />
                ))}
              </View>
            )}
          </SoftScrollAnchor>
          <Animated.View
            style={[s.safe, { opacity: step === 5 && setupPlan ? summaryOpacity : 1 }]}
            pointerEvents={leavingSummary ? "none" : "auto"}
            accessibilityElementsHidden={leavingSummary}
            importantForAccessibility={leavingSummary ? "no-hide-descendants" : "auto"}
          >
            <SoftScrollView
              key={workplacePage?.pageKey}
              testID="onboarding-scroll-content"
              style={s.scrollViewport}
              scrollEnabled={!adjustingPercentage}
              ref={scrollRef}
              keyboardShouldPersistTaps="handled"
              contentInsetAdjustmentBehavior="never"
              automaticallyAdjustContentInsets={false}
              keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
              contentContainerStyle={[s.scroll, step === "welcome" && { justifyContent: "center" }]}
            >
              <View pointerEvents={saving ? "none" : "auto"}>
                <OnboardingReveal
                  reduced={reduced}
                  key={workplacePage?.pageKey ?? step}
                  variant="page"
                  style={s.content}
                >
                  {step === firstStep ? (
                    <OnboardingBrand reduced={reduced} welcome={step === "welcome"} />
                  ) : null}
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
                    <Text
                      accessibilityRole="header"
                      style={[s.title, step === "welcome" && s.centered, { color: p.text }]}
                    >
                      {workplacePage?.heading ?? titles[step]}
                    </Text>
                    {!workplacePage?.heading && copies[step] ? (
                      <Text style={[s.body, step === "welcome" && s.centered, { color: p.muted }]}>
                        {copies[step]}
                      </Text>
                    ) : null}
                  </View>
                  {step === "plan" && (
                    <View style={s.list}>
                      <View
                        style={{
                          backgroundColor: p.planProgressSurface,
                          borderRadius: RADII.card,
                          padding: SPACING.lg,
                        }}
                      >
                        <Text style={[s.title, { color: p.text, textAlign: "left" }]}>
                          {completed} / 3
                        </Text>
                        <Text style={[s.caption, { color: p.muted }]}>Bereiche eingerichtet</Text>
                      </View>
                      {(
                        [
                          {
                            target: 4,
                            icon: "clock-outline",
                            title: "Arbeitszeit & Arbeitsort",
                            value:
                              workReady && federalState
                                ? `${weeklyHours} h · ${FEDERAL_STATE_LABELS[federalState]}`
                                : "Für dein Wochen-Soll erforderlich",
                          },
                          {
                            target: 3,
                            icon: "database",
                            title: "Gehalt",
                            value:
                              salaryMode === null
                                ? "Optional · für die Gehaltsprognose"
                                : salaryLabel,
                          },
                          {
                            target: "workplace",
                            icon: "shield-outline",
                            title: "Sonderregelungen in deinem Betrieb",
                            value: workplaceStatus,
                          },
                        ] as const
                      ).map((row) => (
                        <Pressable
                          key={row.target}
                          accessibilityRole="button"
                          accessibilityLabel={row.title}
                          accessibilityHint={row.value}
                          onPress={() => edit(row.target, "plan")}
                          style={[
                            s.summaryRow,
                            {
                              backgroundColor: p.surface,
                              borderRadius: RADII.control,
                              borderBottomWidth: 0,
                              paddingHorizontal: SPACING.lg,
                            },
                          ]}
                        >
                          <BlueprintIcon name={row.icon} />
                          <View style={s.summaryCopy}>
                            <Text style={[s.label, { color: p.text }]}>{row.title}</Text>
                            <Text style={[s.caption, { color: p.muted }]}>{row.value}</Text>
                          </View>
                          <Text accessibilityElementsHidden style={[s.body, { color: p.muted }]}>
                            ›
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                  {workplacePage?.children && (
                    <View
                      pointerEvents={workplacePage.busy ? "none" : "auto"}
                      style={{ gap: SPACING.md }}
                    >
                      {workplacePage.children}
                    </View>
                  )}
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
                          mode === "MANUAL"
                            ? "manual"
                            : tariffSelection.mode
                              ? "details"
                              : "tariffs",
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
                          ...(setupPlan
                            ? [
                                {
                                  label: "Sonderregelungen in deinem Betrieb",
                                  value: workplaceStatus,
                                  target: "workplace",
                                  icon: "shield-outline",
                                },
                              ]
                            : []),
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
                                borderBottomWidth:
                                  row.label ===
                                  (setupPlan ? "Sonderregelungen in deinem Betrieb" : "Gehalt")
                                    ? 0
                                    : 1,
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
                      {!setupPlan && (
                        <Text
                          style={[s.caption, s.centered, { color: p.muted, marginTop: SPACING.xl }]}
                        >
                          Ohne Konto. Auf deinem Gerät.
                        </Text>
                      )}
                    </View>
                  ) : null}
                </OnboardingReveal>
              </View>
            </SoftScrollView>
            <View
              style={[s.footer, { backgroundColor: p.canvas }]}
              testID="onboarding-fixed-footer"
            >
              <FieldError
                message={
                  workplacePage?.error ||
                  saveError ||
                  (step === "workplace" ? workplaceError : undefined)
                }
              />
              {step !== 3 || salaryView !== "tariffs" ? (
                <Pressable
                  hitSlop={2}
                  accessibilityRole="button"
                  accessibilityLabel={saving ? "LUNA Shift wird eingerichtet" : undefined}
                  accessibilityState={{
                    busy: saving || workplaceLoading || workplacePage?.busy,
                    disabled: saving || workplaceLoading || workplacePage?.primary.disabled,
                  }}
                  disabled={saving || workplaceLoading || workplacePage?.primary.disabled}
                  onPress={() => {
                    if (workplacePage) workplacePage.primary.onPress();
                    else if (step === "workplace") {
                      if (workplaceError) workplace.retry();
                      else leaveWorkplace();
                    } else if (step === "welcome") moveTo("plan");
                    else if (step === "plan") continuePlan();
                    else if (step === 5 && setupPlan) {
                      if (reduced) moveTo("start");
                      else setLeavingSummary(true);
                    } else if (step === 5) void finish();
                    else if (step === 3 && salaryView === "choice") skipSalary();
                    else advance();
                  }}
                  testID="onboarding-primary-action"
                  style={[
                    s.primary,
                    {
                      backgroundColor: p.accent,
                      opacity:
                        saving || workplaceLoading || workplacePage?.primary.disabled ? 0.4 : 1,
                    },
                  ]}
                >
                  {saving ? (
                    <ActivityIndicator color={p.onAccent} />
                  ) : (
                    <Text style={[s.buttonText, { color: p.onAccent }]}>
                      {workplacePage
                        ? workplacePage.primary.label
                        : step === "workplace" && workplaceError
                          ? "Erneut laden"
                          : workplaceLoading
                            ? "Fragen starten"
                            : step === 5
                              ? setupPlan
                                ? "Weiter zur Startauswahl"
                                : "Zum Kalender"
                              : step === 3 && salaryView === "choice"
                                ? "Später einrichten"
                                : step === "plan"
                                  ? nextSection.label
                                  : step === "welcome"
                                    ? "Los geht’s"
                                    : returnPage !== null
                                      ? "Übernehmen"
                                      : "Weiter"}
                    </Text>
                  )}
                </Pressable>
              ) : null}
              {step === "workplace" && (workplacePage || !workplaceComplete) ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={workplacePage?.busy}
                  onPress={() => leaveWorkplace(true)}
                  style={s.back}
                >
                  <Text style={[s.caption, s.centered, { color: p.muted }]}>Überspringen</Text>
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
              {step === firstStep && !preview && Platform.OS === "ios" ? (
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
          </Animated.View>
        </SoftScrollScope>
      </KeyboardAvoidingView>
    </View>
  );
  if (step !== "workplace" || !workplaceData || (!setupPlan && workplaceComplete)) return page();
  return (
    <OnboardingWorkplace
      initial={workplaceUpdate ? workplaceUpdate(workplaceData) : workplaceData}
      complete={(update) => {
        setWorkplaceUpdate((previous: WorkplaceUpdate | null): WorkplaceUpdate =>
          previous ? (current) => update(previous(current)) : update,
        );
        leaveWorkplace();
      }}
      presentation={{
        back,
        hasTVoeD:
          salaryMode === "TARIFF" &&
          (tariffSelection.mode === "TVOED_P" || tariffSelection.mode === "TVOED_E"),
        renderPage: page,
      }}
    />
  );
}
