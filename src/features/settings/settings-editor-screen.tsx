import { TVAL_WORKPLACE_OPTIONS, tvalWorkplaceFields } from "./tval-workplace-choice";
import {
  useEmploymentSaveFlow,
  EmploymentSaveDialog,
  EmploymentSaveFeedback,
  type EmploymentSaveFlow,
} from "./profile-validity";
import {
  EmploymentModelFields,
  employmentModelDraft,
  employmentModelInput,
} from "./employment-model-fields";
import { Text, TextInput } from "@/ui/text";
import { SelectionGroup } from "@/ui/selection-group";
import { getTvalPflegeFullTimeMinutes } from "@/engine/simple-tval-pflege-pay";
import {
  TVH_KR_GROUPS,
  tvhKrLevelsForGroup,
  type TvhKrGroup,
  type TvhKrPayLevel,
} from "@/domain/tvh-kr-tariff";
import {
  TVUK_NURSING_GROUPS,
  tvUkLevelsForGroup,
  type TvUkNursingGroup,
  type TvUkPayLevel,
} from "@/domain/tvuk-nursing-tariff";
import {
  TVL_KR_GROUPS,
  tvlKrLevelsForGroup,
  type TvlKrGroup,
  type TvlKrUniversityRegion,
} from "@/domain/tvl-kr-tariff";
import { getTvlKrUniversityFullTimeMinutes } from "@/engine/simple-tvl-kr-pay";
import { VKA_E_GROUPS, ePayLevels } from "@/domain/vka-e-tariff";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Children, Fragment, isValidElement, useEffect, useRef, useState } from "react";
import { View, useWindowDimensions } from "react-native";

import { usePflegeShiftProfile, usePflegeShiftStatus } from "@/application/pflegeshift-provider";
import {
  FEDERAL_STATES,
  FEDERAL_STATE_LABELS,
  HOLIDAY_REGION_LABELS,
  INDUSTRIES,
  INDUSTRY_LABELS,
  PAY_GROUPS,
  payLevelsForGroup,
  TARIFF_REGION_LABELS,
  type FederalState,
  type HolidayRegion,
  type PayGroup,
  type PayLevel,
  type TariffRegion,
  type TariffSector,
  type UserProfile,
  type SaveProfileInput,
  type VkaETariff,
} from "@/domain/types";
import {
  defaultHolidayRegion,
  holidayRegionsForState,
  tariffFullTimeWeeklyMinutes,
} from "@/domain/employment-profile";
import { userFacingErrorMessage } from "@/domain/errors";
import { parseWeeklyHours } from "@/features/onboarding/onboarding-screen";
import { resolveSalaryUpdate } from "@/features/settings/profile-update";
import {
  manualMonthlyGrossFieldError,
  parseManualMonthlyGrossCents,
  settingsFormValues,
  settingsFormValuesForSalaryMode,
  type IndustryFormValue,
  type SalaryMode,
} from "@/features/settings/settings-form-values";
import { parseEnumRouteParam, type RouteParam } from "@/navigation/route-params";
import { usePalette } from "@/theme/palette";
import { SALARY_BASIS_OPTIONS } from "@/features/settings/salary-basis-options";
import { Field, PrimaryButton, SecondaryButton } from "@/ui/form-controls";
import { FormStatus, HeaderSaveAction } from "@/ui/form-layout";
import { LoadFailureView, LoadingView } from "@/ui/loading-view";
import { focusInvalidField, weeklyHoursFieldError } from "@/ui/form-validation";
import { ProfileChoice, ProfileEditorBusyContext, useProfileSelection } from "./profile-selection";
import { useProfileLeaveGuard } from "./use-profile-leave-guard";
import { ProfilePage } from "./profile-page";
import { requireProfileText, ValidationError } from "@/domain/validation";
import {
  CardSeparator,
  SectionHeader,
  SegmentedControl,
  SurfaceCard,
  RowButton,
} from "@/ui/design-system";
import { SPACING } from "@/theme/tokens";
import { TYPOGRAPHY, TEXT_MAX_SCALE } from "@/theme/typography";
import type { PropsWithChildren } from "react";

type SettingsSection = "WORK" | "TARIFF" | "PERSONAL" | "EMPLOYER" | "EMPLOYMENT" | "MODEL";

export function SettingsEditorScreen({
  sectionOverride,
}: { readonly sectionOverride?: SettingsSection } = {}) {
  const params = useLocalSearchParams<{ section?: RouteParam; origin?: RouteParam }>();
  const parsedSection = sectionOverride
    ? { status: "valid" as const, value: sectionOverride }
    : parseEnumRouteParam(params.section, [
        "WORK",
        "TARIFF",
        "PERSONAL",
        "EMPLOYER",
        "EMPLOYMENT",
        "MODEL",
      ] as const);
  const section: SettingsSection = parsedSection.status === "valid" ? parsedSection.value : "WORK";
  const origin = parseEnumRouteParam(params.origin, ["settings"] as const);
  const { ready, error: dataError, reload } = usePflegeShiftStatus();
  const { profile } = usePflegeShiftProfile();

  if (parsedSection.status !== "valid" || origin.status === "invalid") {
    return (
      <LoadFailureView
        actionLabel="Schließen"
        message="Der Link zu den Einstellungen enthält einen unbekannten Bereich."
        onRetry={() => router.back()}
        title="Einstellungen können nicht geöffnet werden"
      />
    );
  }
  if (ready && dataError) {
    return <LoadFailureView message={dataError} onRetry={() => void reload()} />;
  }
  if (!ready || profile === null) return <LoadingView />;

  return (
    <SettingsEditorSession
      key={`${section}-${profile.createdAt}`}
      profile={profile}
      section={section}
      fromMore={origin.status === "valid"}
    />
  );
}

function SettingsEditorSession({
  profile,
  section,
  fromMore,
}: {
  readonly profile: UserProfile;
  readonly section: SettingsSection;
  readonly fromMore: boolean;
}) {
  const flow = useEmploymentSaveFlow(profile);
  return (
    <>
      <SettingsEditorForm
        key={flow.revision}
        profile={flow.base}
        section={section}
        fromMore={fromMore}
        flow={flow}
      />
      <EmploymentSaveDialog flow={flow} />
    </>
  );
}

function SettingsEditorForm({
  profile,
  section,
  fromMore,
  flow,
}: {
  readonly profile: UserProfile;
  readonly section: SettingsSection;
  readonly fromMore: boolean;
  readonly flow: EmploymentSaveFlow;
}) {
  const palette = usePalette();
  const { width, fontScale } = useWindowDimensions();
  const compactHeader = width < 390 || fontScale > 1.15;
  const editWork = section === "WORK" || section === "EMPLOYMENT";
  const editTariff = section === "TARIFF" || section === "EMPLOYMENT";
  const editModel = section === "MODEL" || section === "WORK" || section === "EMPLOYMENT";
  const employment = section !== "PERSONAL" && section !== "EMPLOYER";
  const pageTitle =
    section === "EMPLOYMENT"
      ? "Arbeit & Gehalt"
      : section === "MODEL"
        ? "Arbeitsmodell"
        : section === "WORK"
          ? fromMore
            ? "Arbeitszeit & Ort"
            : "Arbeitszeit"
          : section === "EMPLOYER"
            ? "Arbeitgeber"
            : section === "PERSONAL"
              ? "Persönliche Angaben"
              : "Tarif & Gehalt";
  const { updateProfile } = usePflegeShiftProfile();
  const { clear: clearSelection } = useProfileSelection();
  useEffect(() => () => clearSelection(), [clearSelection]);
  const [initialValues] = useState(() => settingsFormValues(profile, flow.referenceDate));
  const [displayName, setDisplayName] = useState(profile.displayName ?? "");
  const [employerName, setEmployerName] = useState(profile.employerName ?? "");
  const [confirmedGroups, setConfirmedGroups] = useState<readonly SalaryMode[]>(() => {
    const bases = profile.salaryBasisConflict ?? profile;
    return (
      [
        ["TVOED_P", bases.tariff],
        ["TVOED_E", bases.vkaETariff],
        ["TVL_KR", bases.tvlKrTariff],
        ["TVH_KR", bases.tvhKrTariff],
        ["TVUK_NURSING", bases.tvUkNursingTariff],
      ] as const
    )
      .filter((entry) => entry[1] != null)
      .map((entry) => entry[0]);
  });
  const [lastTariffMode, setLastTariffMode] = useState<SalaryMode>(
    initialValues.salaryMode === "MANUAL" ? "UNSET" : initialValues.salaryMode,
  );
  const [pFullTimeOverride, setPFullTimeOverride] = useState<number | null>(
    profile.tariff?.fullTimeWeeklyMinutes ?? null,
  );
  const [federalState, setFederalState] = useState<FederalState>(initialValues.federalState);
  const [holidayRegion, setHolidayRegion] = useState<HolidayRegion>(initialValues.holidayRegion);
  const [weeklyHours, setWeeklyHours] = useState(initialValues.weeklyHours);
  const [industry, setIndustry] = useState<IndustryFormValue>(initialValues.industry);
  const [salaryMode, setSalaryMode] = useState<SalaryMode>(initialValues.salaryMode);
  const [trainingYear, setTrainingYear] = useState<1 | 2 | 3 | "UNSET">(initialValues.trainingYear);
  const [tvalWorkplace, setTvalWorkplace] = useState(initialValues.tvalWorkplace);
  const [manualMonthlyGross, setManualMonthlyGross] = useState(initialValues.manualMonthlyGross);
  const [tvhPayGroup, setTvhPayGroup] = useState<TvhKrGroup>(initialValues.tvhPayGroup);
  const [tvhPayLevel, setTvhPayLevel] = useState<TvhKrPayLevel | "UNSET">(
    initialValues.tvhPayLevel,
  );
  const [tvhFullTimeWeeklyMinutes, setTvhFullTimeWeeklyMinutes] = useState<2310 | 2400>(
    initialValues.tvhFullTimeWeeklyMinutes,
  );
  const [tvUkPayGroup, setTvUkPayGroup] = useState<TvUkNursingGroup>(initialValues.tvUkPayGroup);
  const [tvUkPayLevel, setTvUkPayLevel] = useState<TvUkPayLevel | "UNSET">(
    initialValues.tvUkPayLevel,
  );
  const [krPayGroup, setKrPayGroup] = useState<TvlKrGroup>(initialValues.krPayGroup);
  const [tvlUniversityRegion, setTvlUniversityRegion] = useState<TvlKrUniversityRegion>(
    initialValues.tvlUniversityRegion,
  );
  const [ePayGroup, setEPayGroup] = useState<VkaETariff["payGroup"]>(initialValues.ePayGroup);
  const [payGroup, setPayGroup] = useState<PayGroup>(initialValues.payGroup);
  const [payLevel, setPayLevel] = useState<PayLevel | "UNSET">(initialValues.payLevel);
  const [sector, setSector] = useState<TariffSector>(initialValues.sector);
  const [tariffRegion, setTariffRegion] = useState<TariffRegion>(initialValues.tariffRegion);
  const [weeklyHoursError, setWeeklyHoursError] = useState<string | null>(null);
  const [manualMonthlyGrossError, setManualMonthlyGrossError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [identitySaving, setSaving] = useState(false);
  const saving = identitySaving || flow.saving;
  const [model, setModel] = useState(() => employmentModelDraft(profile));
  const weeklyHoursRef = useRef<TextInput>(null);
  const manualMonthlyGrossRef = useRef<TextInput>(null);
  const fullTimeForDate = (referenceDate: string) => {
    const derivedFullTimeWeeklyMinutes =
      salaryMode === "TVAL_PFLEGE"
        ? (getTvalPflegeFullTimeMinutes(referenceDate, tvlUniversityRegion) ?? 0)
        : salaryMode === "TVH_KR"
          ? tvhFullTimeWeeklyMinutes
          : salaryMode === "TVUK_NURSING"
            ? 2310
            : salaryMode === "TVL_KR"
              ? (getTvlKrUniversityFullTimeMinutes(referenceDate, tvlUniversityRegion) ?? 0)
              : salaryMode === "TVAOED_PFLEGE"
                ? sector === "BT_K"
                  ? 2310
                  : 2340
                : tariffFullTimeWeeklyMinutes(sector, tariffRegion);
    return salaryMode === "TVOED_P"
      ? (pFullTimeOverride ?? derivedFullTimeWeeklyMinutes)
      : derivedFullTimeWeeklyMinutes;
  };
  const fullTimeWeeklyMinutes = fullTimeForDate(flow.referenceDate);
  const fullTimeHours = String(fullTimeWeeklyMinutes / 60).replace(".", ",");
  const selectedLevels =
    salaryMode === "TVL_KR"
      ? tvlKrLevelsForGroup(krPayGroup)
      : salaryMode === "TVOED_E"
        ? ePayLevels(ePayGroup)
        : payLevelsForGroup(payGroup);
  const busyRef = useRef(false);
  const tariffDraft = [
    industry,
    salaryMode,
    trainingYear,
    manualMonthlyGross,
    tvhPayGroup,
    tvhPayLevel,
    tvhFullTimeWeeklyMinutes,
    tvUkPayGroup,
    tvUkPayLevel,
    krPayGroup,
    tvlUniversityRegion,
    tvalWorkplace,
    ePayGroup,
    payGroup,
    payLevel,
    sector,
    tariffRegion,
    pFullTimeOverride,
    confirmedGroups,
  ];
  const [tariffSnapshot] = useState(() => JSON.stringify(tariffDraft));
  const tariffTouched = editTariff && JSON.stringify(tariffDraft) !== tariffSnapshot;
  const draft =
    section === "EMPLOYER"
      ? [employerName]
      : section === "PERSONAL"
        ? [displayName, employerName]
        : [
            ...(editWork ? [federalState, holidayRegion, weeklyHours] : []),
            ...(editTariff ? tariffDraft : []),
            ...(editModel ? [model] : []),
          ];
  const [snapshot] = useState(() => JSON.stringify(draft));
  const dirty = JSON.stringify(draft) !== snapshot;
  const leave = useProfileLeaveGuard(dirty, saving);
  const isTraining = salaryMode === "TVAOED_PFLEGE" || salaryMode === "TVAL_PFLEGE";
  const activeGroup =
    salaryMode === "TVH_KR"
      ? tvhPayGroup
      : salaryMode === "TVUK_NURSING"
        ? tvUkPayGroup
        : salaryMode === "TVL_KR"
          ? krPayGroup
          : salaryMode === "TVOED_E"
            ? ePayGroup
            : payGroup;
  const groupValues =
    salaryMode === "TVH_KR"
      ? TVH_KR_GROUPS
      : salaryMode === "TVUK_NURSING"
        ? TVUK_NURSING_GROUPS
        : salaryMode === "TVL_KR"
          ? TVL_KR_GROUPS
          : salaryMode === "TVOED_E"
            ? VKA_E_GROUPS
            : PAY_GROUPS;
  const activeLevels =
    salaryMode === "TVH_KR"
      ? tvhKrLevelsForGroup(tvhPayGroup)
      : salaryMode === "TVUK_NURSING"
        ? tvUkLevelsForGroup(tvUkPayGroup)
        : selectedLevels;
  const activeLevel =
    salaryMode === "TVH_KR" ? tvhPayLevel : salaryMode === "TVUK_NURSING" ? tvUkPayLevel : payLevel;
  function selectGroup(group: string) {
    if (!groupValues.some((value) => value === group)) return;
    setConfirmedGroups((current) =>
      current.includes(salaryMode) ? current : [...current, salaryMode],
    );
    if (salaryMode === "TVH_KR") {
      const next = group as TvhKrGroup;
      setTvhPayGroup(next);
      if (tvhPayLevel !== "UNSET" && !tvhKrLevelsForGroup(next).includes(tvhPayLevel))
        setTvhPayLevel("UNSET");
    } else if (salaryMode === "TVUK_NURSING") {
      const next = group as TvUkNursingGroup;
      setTvUkPayGroup(next);
      if (tvUkPayLevel !== "UNSET" && !tvUkLevelsForGroup(next).includes(tvUkPayLevel))
        setTvUkPayLevel("UNSET");
    } else {
      const levels =
        salaryMode === "TVL_KR"
          ? tvlKrLevelsForGroup(group as TvlKrGroup)
          : salaryMode === "TVOED_E"
            ? ePayLevels(group as VkaETariff["payGroup"])
            : payLevelsForGroup(group as PayGroup);
      if (salaryMode === "TVL_KR") setKrPayGroup(group as TvlKrGroup);
      else if (salaryMode === "TVOED_E") setEPayGroup(group as VkaETariff["payGroup"]);
      else setPayGroup(group as PayGroup);
      if (payLevel !== "UNSET" && !levels.includes(payLevel)) setPayLevel("UNSET");
    }
  }
  const salaryDraft = {
    trainingYear,
    manualMonthlyGross,
    payGroup,
    payLevel,
    sector,
    tariffRegion,
    ePayGroup,
    krPayGroup,
    tvlUniversityRegion,
    tvalWorkplace,
    tvhPayGroup,
    tvhPayLevel,
    tvhFullTimeWeeklyMinutes,
    tvUkPayGroup,
    tvUkPayLevel,
    pFullTimeOverride,
  };
  const salaryDrafts = useRef(new Map<SalaryMode, typeof salaryDraft>());
  function changeSalaryMode(value: SalaryMode) {
    if (value === salaryMode) return;
    salaryDrafts.current.set(salaryMode, salaryDraft);
    const cached = salaryDrafts.current.get(value);
    const restored =
      cached ??
      (profile.salaryBasisConflict
        ? settingsFormValuesForSalaryMode(profile, value, flow.referenceDate)
        : {
            ...settingsFormValuesForSalaryMode(profile, value, flow.referenceDate),
            sector,
            tariffRegion,
            tvlUniversityRegion,
          });
    setSalaryMode(value);
    if (value !== "MANUAL") setLastTariffMode(value);
    setManualMonthlyGross(restored.manualMonthlyGross);
    setTrainingYear(restored.trainingYear);
    setPayGroup(restored.payGroup);
    setPayLevel(restored.payLevel);
    setSector(restored.sector);
    setTariffRegion(restored.tariffRegion);
    setEPayGroup(restored.ePayGroup);
    setKrPayGroup(restored.krPayGroup);
    setTvlUniversityRegion(restored.tvlUniversityRegion);
    setTvalWorkplace(restored.tvalWorkplace);
    setTvhPayGroup(restored.tvhPayGroup);
    setTvhPayLevel(restored.tvhPayLevel);
    setTvhFullTimeWeeklyMinutes(restored.tvhFullTimeWeeklyMinutes);
    setTvUkPayGroup(restored.tvUkPayGroup);
    setTvUkPayLevel(restored.tvUkPayLevel);
    const bases = profile.salaryBasisConflict ?? profile;
    setPFullTimeOverride(
      cached ? cached.pFullTimeOverride : (bases.tariff?.fullTimeWeeklyMinutes ?? null),
    );
    if (!cached && !confirmedGroups.includes(value) && value !== "MANUAL") {
      if (value === "TVH_KR") setTvhPayLevel("UNSET");
      else if (value === "TVUK_NURSING") setTvUkPayLevel("UNSET");
      else setPayLevel("UNSET");
    }
    if (
      !cached &&
      ((value === "TVAOED_PFLEGE" && !bases.nursingTrainingTariff) ||
        (value === "TVAL_PFLEGE" && !bases.tvalPflegeTariff))
    )
      setTrainingYear("UNSET");
  }

  async function submit(onSaved?: () => void) {
    if (busyRef.current) return;
    if (section === "PERSONAL" || section === "EMPLOYER") {
      try {
        const name =
          section === "PERSONAL"
            ? requireProfileText(displayName, "Name", 80)
            : profile.displayName;
        const employer = requireProfileText(employerName, "Arbeitgeber", 160);
        busyRef.current = true;
        setSaving(true);
        setError(null);
        await updateProfile({ ...profile, displayName: name, employerName: employer });
        leave.saved(onSaved);
      } catch (submitError) {
        busyRef.current = false;
        setError(userFacingErrorMessage(submitError, "Profil konnte nicht gespeichert werden."));
      } finally {
        setSaving(false);
      }
      return;
    }
    if (
      tariffTouched &&
      salaryMode !== "MANUAL" &&
      salaryMode !== "UNSET" &&
      !isTraining &&
      !confirmedGroups.includes(salaryMode)
    ) {
      setError(
        "Bitte eine gültige Entgeltgruppe für den gewählten Tarif wählen. Gruppe und Stufe werden nicht automatisch ersetzt.",
      );
      return;
    }
    if (
      tariffTouched &&
      !isTraining &&
      salaryMode !== "MANUAL" &&
      salaryMode !== "UNSET" &&
      activeLevel !== "UNSET" &&
      !(activeLevels as readonly (string | number)[]).includes(activeLevel)
    ) {
      setError("Bitte eine gültige Stufe für die gewählte Gruppe wählen.");
      return;
    }
    const fieldError = editWork ? weeklyHoursFieldError(weeklyHours) : null;
    const salaryModeError =
      section === "TARIFF" && salaryMode === "UNSET" ? "Bitte eine Gehaltsgrundlage wählen." : null;
    const salaryFieldError =
      tariffTouched && salaryMode === "MANUAL"
        ? manualMonthlyGrossFieldError(manualMonthlyGross)
        : null;
    setWeeklyHoursError(fieldError);
    setManualMonthlyGrossError(salaryFieldError);
    if (fieldError) {
      setError(fieldError);
      setMessage(null);
      focusInvalidField(weeklyHoursRef, fieldError);
      return;
    }
    if (salaryModeError) {
      setError(salaryModeError);
      setMessage(null);
      return;
    }
    if (salaryFieldError) {
      setError(salaryFieldError);
      setMessage(null);
      focusInvalidField(manualMonthlyGrossRef, salaryFieldError);
      return;
    }
    if (
      tariffTouched &&
      (salaryMode === "TVOED_P" || salaryMode === "TVOED_E" || salaryMode === "TVL_KR") &&
      payLevel === "UNSET"
    ) {
      setError("Bitte eine gültige Stufe für die gewählte Gruppe wählen.");
      setMessage(null);
      return;
    }
    if (tariffTouched && salaryMode === "TVH_KR" && tvhPayLevel === "UNSET") {
      setError("Bitte eine gültige Stufe für die gewählte Gruppe wählen.");
      setMessage(null);
      return;
    }
    if (tariffTouched && salaryMode === "TVUK_NURSING" && tvUkPayLevel === "UNSET") {
      setError("Bitte eine gültige Stufe für die gewählte Gruppe wählen.");
      setMessage(null);
      return;
    }
    if (
      tariffTouched &&
      (salaryMode === "TVAOED_PFLEGE" || salaryMode === "TVAL_PFLEGE") &&
      trainingYear === "UNSET"
    ) {
      setError("Bitte das Ausbildungsjahr wählen.");
      setMessage(null);
      return;
    }
    try {
      setError(null);
      setMessage(null);
      flow.request((referenceDate, final): SaveProfileInput => {
        const fullTimeWeeklyMinutes = fullTimeForDate(referenceDate);
        if (
          final &&
          (tariffTouched ||
            (editWork && parseWeeklyHours(weeklyHours) !== profile.weeklyMinutes)) &&
          ["TVAOED_PFLEGE", "TVAL_PFLEGE", "TVL_KR", "TVUK_NURSING", "TVH_KR"].includes(
            salaryMode,
          ) &&
          parseWeeklyHours(weeklyHours) > fullTimeWeeklyMinutes
        )
          throw new ValidationError(
            "Deine Wochenstunden liegen über der tariflichen Vollzeit. Bitte deine Angaben prüfen.",
          );
        const salaryUpdate = resolveSalaryUpdate(
          tariffTouched ? "TARIFF" : "WORK",
          profile.tariff,
          profile.manualMonthlyGrossCents ?? null,
          salaryMode,
          {
            payGroup,
            payLevel: payLevel === "UNSET" ? initialValues.payLevel : payLevel,
            sector,
            tariffRegion,
            fullTimeWeeklyMinutes,
          },
          parseManualMonthlyGrossCents(manualMonthlyGross),
        );
        return {
          ...profile,
          federalState,
          holidayRegion,
          weeklyMinutes: parseWeeklyHours(weeklyHours),
          timeZone: profile.timeZone,
          industry: industry === "UNKNOWN" ? null : industry,
          manualMonthlyGrossCents: salaryUpdate.manualMonthlyGrossCents,
          ...(editModel ? employmentModelInput(profile, model) : {}),
          tariff: salaryUpdate.tariff,
          vkaETariff: !tariffTouched
            ? (profile.vkaETariff ?? null)
            : salaryMode === "TVOED_E" && payLevel !== "UNSET"
              ? { payGroup: ePayGroup, payLevel, sector, tariffRegion }
              : null,
          tvhKrTariff: !tariffTouched
            ? (profile.tvhKrTariff ?? null)
            : salaryMode === "TVH_KR" && tvhPayLevel !== "UNSET"
              ? {
                  payGroup: tvhPayGroup,
                  payLevel: tvhPayLevel,
                  fullTimeWeeklyMinutes: tvhFullTimeWeeklyMinutes,
                }
              : null,
          tvUkNursingTariff: !tariffTouched
            ? (profile.tvUkNursingTariff ?? null)
            : salaryMode === "TVUK_NURSING" && tvUkPayLevel !== "UNSET"
              ? { payGroup: tvUkPayGroup, payLevel: tvUkPayLevel }
              : null,
          tvlKrTariff: !tariffTouched
            ? (profile.tvlKrTariff ?? null)
            : salaryMode === "TVL_KR" && payLevel !== "UNSET"
              ? { payGroup: krPayGroup, payLevel, universityRegion: tvlUniversityRegion }
              : null,
          tvalPflegeTariff: !tariffTouched
            ? (profile.tvalPflegeTariff ?? null)
            : salaryMode === "TVAL_PFLEGE" && trainingYear !== "UNSET"
              ? {
                  trainingYear,
                  universityRegion: tvlUniversityRegion,
                  ...tvalWorkplaceFields(
                    tvalWorkplace,
                    profile.tvalPflegeTariff,
                    tvalWorkplace !== initialValues.tvalWorkplace,
                  ),
                }
              : null,
          nursingTrainingTariff: !tariffTouched
            ? (profile.nursingTrainingTariff ?? null)
            : salaryMode === "TVAOED_PFLEGE" && trainingYear !== "UNSET"
              ? { trainingYear, sector, tariffRegion }
              : null,
        };
      });
    } catch (submitError) {
      setError(userFacingErrorMessage(submitError, "Speichern fehlgeschlagen."));
    }
  }

  const tariffIndustry = (
    <ProfileChoice
      label="Berufsbereich"
      value={industry}
      options={[
        { value: "UNKNOWN", label: "Noch nicht angegeben" },
        ...INDUSTRIES.map((value) => ({ value, label: INDUSTRY_LABELS[value] })),
      ]}
      onChange={setIndustry}
    />
  );
  const tariffChoice = (
    <ProfileChoice
      label={fromMore ? "Tarif" : "Tarifvertrag"}
      value={salaryMode}
      options={SALARY_BASIS_OPTIONS.filter((option) => fromMore || option.value !== "MANUAL")}
      onChange={changeSalaryMode}
    />
  );
  const tariffContext = (
    <>
      {salaryMode === "TVH_KR" || salaryMode === "TVUK_NURSING" ? (
        <InputInset>
          <Hint>
            {salaryMode === "TVH_KR" ? "TV-H Pflege · Hessen" : "TV-UK Pflege · Baden-Württemberg"}
          </Hint>
        </InputInset>
      ) : null}
      {salaryMode === "TVL_KR" || salaryMode === "TVAL_PFLEGE" ? (
        <ProfileChoice
          label="Tarifregion"
          value={tvlUniversityRegion}
          options={[
            { value: "WEST", label: "West" },
            { value: "EAST", label: "Ost" },
          ]}
          onChange={setTvlUniversityRegion}
        />
      ) : null}
      {salaryMode === "TVAL_PFLEGE" ? (
        <ProfileChoice
          label="Arbeitsbereich"
          value={tvalWorkplace}
          options={TVAL_WORKPLACE_OPTIONS}
          onChange={setTvalWorkplace}
        />
      ) : null}
      {salaryMode === "TVOED_P" || salaryMode === "TVOED_E" || salaryMode === "TVAOED_PFLEGE" ? (
        <>
          <ProfileChoice
            label="Einrichtung"
            value={sector}
            options={[
              { value: "BT_K", label: "Krankenhaus (BT-K)" },
              { value: "BT_B", label: "Pflegeeinrichtung (BT-B)" },
            ]}
            onChange={(value) => {
              setSector(value);
              setPFullTimeOverride(null);
            }}
          />
          {salaryMode === "TVOED_P" || sector === "BT_K" ? (
            <ProfileChoice
              label="Tarifregion"
              value={tariffRegion}
              options={[
                { value: "KAV_BW", label: TARIFF_REGION_LABELS.KAV_BW },
                { value: "OTHER", label: TARIFF_REGION_LABELS.OTHER },
              ]}
              onChange={(value) => {
                setTariffRegion(value);
                setPFullTimeOverride(null);
              }}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
  const tariffGrade = (
    <>
      {isTraining ? (
        <ProfileChoice
          label="Ausbildungsjahr"
          value={trainingYear}
          options={[1, 2, 3].map((value) => ({
            value: value as 1 | 2 | 3,
            label: `${value}. Ausbildungsjahr`,
          }))}
          onChange={setTrainingYear}
        />
      ) : (
        <>
          <ProfileChoice
            label="Entgeltgruppe"
            value={confirmedGroups.includes(salaryMode) ? activeGroup : "UNSET"}
            options={groupValues.map((value) => ({
              value,
              label: value.replace("PUK", "P-UK"),
            }))}
            onChange={selectGroup}
          />
          <ProfileChoice
            label="Stufe"
            disabled={!confirmedGroups.includes(salaryMode)}
            value={activeLevel}
            options={activeLevels.map((value) => ({
              value,
              label: `Stufe ${value}`,
            }))}
            onChange={(value) => {
              if (salaryMode === "TVH_KR") setTvhPayLevel(value as TvhKrPayLevel);
              else if (salaryMode === "TVUK_NURSING") setTvUkPayLevel(value as TvUkPayLevel);
              else setPayLevel(value as PayLevel);
            }}
          />
          {!confirmedGroups.includes(salaryMode) || activeLevel === "UNSET" ? (
            <InputInset>
              <Hint>
                Bitte wähle eine gültige Gruppe und Stufe für diesen Tarif. Es werden keine
                Ersatzwerte gespeichert.
              </Hint>
            </InputInset>
          ) : null}
        </>
      )}
    </>
  );
  const tariffTime = (
    <ProfileGroup title="Arbeitszeitbasis">
      <RowButton title="Deine Wochenstunden" subtitle={`${initialValues.weeklyHours} Std.`} />
      {salaryMode === "TVH_KR" ? (
        <ProfileChoice
          label="Vollzeit laut Tarif"
          value={tvhFullTimeWeeklyMinutes}
          options={[
            { value: 2310, label: "38,5 Std." },
            { value: 2400, label: "40 Std." },
          ]}
          onChange={setTvhFullTimeWeeklyMinutes}
        />
      ) : (
        <RowButton title="Vollzeit laut Tarif" subtitle={`${fullTimeHours} Std.`} />
      )}
    </ProfileGroup>
  );
  return (
    <ProfileEditorBusyContext.Provider value={saving}>
      <ProfilePage
        title={pageTitle}
        backLabel={fromMore ? "Zurück zu Mehr" : employment ? "Zurück" : "Zurück zum Arbeitsprofil"}
        onBack={() => {
          if (!busyRef.current) router.back();
        }}
        backDisabled={saving}
        testID="profile-editor-content"
      >
        <Stack.Screen
          options={{
            title: pageTitle,
            headerTitle: compactHeader ? "" : pageTitle,
            presentation: "card",
            headerBackVisible: true,
            headerLeft: undefined,
            headerRight: fromMore
              ? undefined
              : () => (
                  <HeaderSaveAction
                    closes={!employment}
                    busy={saving}
                    label="Speichern"
                    onPress={() => void submit()}
                  />
                ),
            headerStyle: { backgroundColor: palette.background },
            headerTintColor: palette.text,
            headerTitleStyle: { color: palette.text },
            statusBarStyle: palette.dark ? "light" : "dark",
          }}
        />
        {compactHeader ? <SectionHeader title={pageTitle} /> : null}
        {flow.editingFrom ? (
          <SectionHeader
            title={`Angaben ab ${flow.editingFrom.split("-").reverse().join(".")} berichtigen`}
          />
        ) : null}
        {section === "EMPLOYER" ? (
          <ProfileGroup title="Arbeitgeber">
            <InputInset>
              <Field
                label="Arbeitgeber"
                value={employerName}
                onChangeText={setEmployerName}
                maxLength={160}
                editable={!saving}
                autoCapitalize="words"
              />
            </InputInset>
          </ProfileGroup>
        ) : section === "PERSONAL" ? (
          <ProfileGroup title="Persönliche Angaben">
            <InputInset>
              <Field
                label="Name"
                value={displayName}
                onChangeText={setDisplayName}
                maxLength={80}
                editable={!saving}
                autoCapitalize="words"
                textContentType="name"
              />
            </InputInset>
            <InputInset>
              <Field
                label="Arbeitgeber"
                value={employerName}
                onChangeText={setEmployerName}
                maxLength={160}
                editable={!saving}
                autoCapitalize="words"
              />
            </InputInset>
          </ProfileGroup>
        ) : null}
        {editWork ? (
          <>
            <ProfileGroup title="Vertrag">
              <InputInset>
                <Field
                  inputRef={weeklyHoursRef}
                  error={weeklyHoursError}
                  keyboardType="decimal-pad"
                  label="Deine Wochenstunden (Std.)"
                  editable={!saving}
                  value={weeklyHours}
                  onChangeText={(value) => {
                    setWeeklyHours(value);
                    setWeeklyHoursError(null);
                  }}
                />
              </InputInset>
            </ProfileGroup>
            <ProfileGroup
              title="Arbeitsort"
              caption="Feiertage richten sich nach deinem Arbeitsort."
            >
              <ProfileChoice
                label="Bundesland"
                value={federalState}
                options={FEDERAL_STATES.map((value) => ({
                  value,
                  label: FEDERAL_STATE_LABELS[value],
                }))}
                onChange={(value) => {
                  setFederalState(value);
                  if (value !== federalState) setHolidayRegion(defaultHolidayRegion(value));
                }}
              />
              {holidayRegionsForState(federalState).length > 1 || holidayRegion === "UNKNOWN" ? (
                <ProfileChoice
                  label="Regionale Feiertage"
                  value={holidayRegion}
                  options={holidayRegionsForState(federalState).map((value) => ({
                    value,
                    label: HOLIDAY_REGION_LABELS[value],
                  }))}
                  onChange={setHolidayRegion}
                />
              ) : null}
            </ProfileGroup>
          </>
        ) : null}
        {editTariff ? (
          <>
            {!fromMore || salaryMode === "MANUAL" || profile.salaryBasisConflict ? (
              <SelectionGroup title="Gehaltsgrundlage">
                <SegmentedControl
                  accessibilityLabel="Gehaltsgrundlage"
                  testID="salary-basis-selection"
                  disabled={saving}
                  value={salaryMode === "MANUAL" ? "MANUAL" : "TARIFF"}
                  items={[
                    { value: "TARIFF", label: "Nach Tarif" },
                    { value: "MANUAL", label: "Eigenes Brutto" },
                  ]}
                  onChange={(value) => {
                    if (!saving) changeSalaryMode(value === "MANUAL" ? "MANUAL" : lastTariffMode);
                  }}
                />

                {profile.salaryBasisConflict ? (
                  <Hint>
                    Mehrere Gehaltsgrundlagen sind gespeichert. Bitte eine wählen; die übrigen
                    werden erst beim Speichern abgelöst.
                  </Hint>
                ) : null}
              </SelectionGroup>
            ) : null}
            {salaryMode === "MANUAL" ? (
              <ProfileGroup title="Eigenes Brutto">
                <InputInset>
                  <Field
                    inputRef={manualMonthlyGrossRef}
                    error={manualMonthlyGrossError}
                    editable={!saving}
                    keyboardType="decimal-pad"
                    label="Monatliches Brutto in Euro"
                    value={manualMonthlyGross}
                    onChangeText={(value) => {
                      setManualMonthlyGross(value);
                      setManualMonthlyGrossError(null);
                    }}
                  />
                </InputInset>
              </ProfileGroup>
            ) : (
              <>
                {fromMore ? (
                  <>
                    <ProfileGroup title="Dein Tarif">
                      {tariffChoice}
                      {salaryMode !== "UNSET" ? tariffGrade : null}
                    </ProfileGroup>
                    <ProfileGroup title="Arbeitsbereich">
                      {tariffIndustry}
                      {tariffContext}
                    </ProfileGroup>
                    {salaryMode === "TVH_KR" ? tariffTime : null}
                  </>
                ) : (
                  <>
                    <ProfileGroup title="Tarif">
                      {tariffIndustry}
                      {tariffChoice}
                      {tariffContext}
                    </ProfileGroup>
                    {salaryMode !== "UNSET" ? (
                      <ProfileGroup title={isTraining ? "Ausbildung" : "Eingruppierung"}>
                        {tariffGrade}
                      </ProfileGroup>
                    ) : null}
                    {salaryMode !== "UNSET" ? tariffTime : null}
                  </>
                )}
              </>
            )}
          </>
        ) : null}
        {editModel ? <EmploymentModelFields value={model} onChange={setModel} /> : null}
        {fromMore || employment ? (
          <PrimaryButton busy={saving} disabled={saving || !dirty} onPress={() => void submit()}>
            {employment ? "Änderungen speichern" : "Speichern"}
          </PrimaryButton>
        ) : null}
        {employment && dirty ? (
          <SecondaryButton disabled={saving} onPress={flow.discard}>
            Änderungen verwerfen
          </SecondaryButton>
        ) : null}
        <FormStatus message={message} error={error} />
        {employment ? <EmploymentSaveFeedback flow={flow} dirty={dirty} /> : null}
      </ProfilePage>
    </ProfileEditorBusyContext.Provider>
  );
}
function ProfileGroup({
  title,
  caption,
  children,
}: PropsWithChildren<{ readonly title: string; readonly caption?: string }>) {
  const rows = flattenRows(children);
  return (
    <View style={{ gap: SPACING.sm }}>
      <SectionHeader title={title} caption={caption} />
      <SurfaceCard>
        {rows.map((child, index) => (
          <Fragment key={index}>
            {index ? <CardSeparator /> : null}
            {child}
          </Fragment>
        ))}
      </SurfaceCard>
    </View>
  );
}
function InputInset({ children }: PropsWithChildren) {
  return <View style={{ padding: SPACING.md }}>{children}</View>;
}
function Hint({ children }: PropsWithChildren) {
  const palette = usePalette();
  return (
    <Text
      maxFontSizeMultiplier={TEXT_MAX_SCALE}
      style={{ color: palette.textMuted, ...TYPOGRAPHY.footnote }}
    >
      {children}
    </Text>
  );
}

function flattenRows(children: import("react").ReactNode): import("react").ReactNode[] {
  return Children.toArray(children).flatMap((child) =>
    isValidElement<PropsWithChildren>(child) && child.type === Fragment
      ? flattenRows(child.props.children)
      : [child],
  );
}
