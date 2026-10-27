import { TVAL_WORKPLACE_OPTIONS } from "@/features/settings/tval-workplace-choice";
import { Text, View } from "react-native";
import { TARIFF_REGION_LABELS, type FederalState } from "@/domain/types";
import { SALARY_BASIS_OPTIONS } from "@/features/settings/salary-basis-options";
import { SPACING } from "@/theme/tokens";
import { ONBOARDING_TYPOGRAPHY, useOnboardingPalette } from "@/theme/onboarding";
import { SelectField, FieldError } from "./onboarding-controls";
import {
  EMPTY_TARIFF_SELECTION,
  isTrainingTariff,
  onboardingTariffGroups,
  onboardingTariffLevels,
  onboardingTariffRegionMismatch,
  type OnboardingTariffErrors,
  type OnboardingTariffMode,
  type OnboardingTariffSelection,
} from "./onboarding-tariff-values";

export function OnboardingTariffFields({
  selection,
  onChange,
  errors,
  federalState,
  showTariffSelector = true,
}: {
  readonly selection: OnboardingTariffSelection;
  readonly onChange: (value: OnboardingTariffSelection) => void;
  readonly errors: OnboardingTariffErrors;
  readonly federalState: FederalState | null;
  readonly showTariffSelector?: boolean;
}) {
  const p = useOnboardingPalette();
  const set = <K extends keyof OnboardingTariffSelection>(
    key: K,
    value: OnboardingTariffSelection[K],
  ) => onChange({ ...selection, [key]: value });
  const modes = SALARY_BASIS_OPTIONS.filter(
    (option) => option.value !== "UNSET" && option.value !== "MANUAL",
  ).map((option) => ({
    value: option.value as OnboardingTariffMode,
    label: "selectionLabel" in option ? option.selectionLabel : option.label,
  }));
  const mismatch = onboardingTariffRegionMismatch(selection.mode, federalState);
  return (
    <View style={{ gap: SPACING.lg }}>
      {showTariffSelector ? (
        <SelectField
          label="Tarifvertrag"
          value={selection.mode}
          options={modes}
          error={errors.tariff}
          onChange={(mode) => onChange({ ...EMPTY_TARIFF_SELECTION, mode })}
        />
      ) : null}
      {selection.mode ? (
        <>
          {isTrainingTariff(selection.mode) ? (
            <SelectField
              label="Ausbildungsjahr"
              value={selection.trainingYear}
              options={([1, 2, 3] as const).map((value) => ({
                value,
                label: `${value}. Ausbildungsjahr`,
              }))}
              error={errors.year}
              onChange={(value) => set("trainingYear", value)}
            />
          ) : (
            <>
              <SelectField
                label="Entgeltgruppe"
                value={selection.group}
                options={onboardingTariffGroups(selection.mode).map((value) => ({
                  value,
                  label: value,
                }))}
                error={errors.group}
                onChange={(group) =>
                  onChange({
                    ...selection,
                    group,
                    level:
                      selection.level !== null &&
                      onboardingTariffLevels(selection.mode, group).includes(selection.level)
                        ? selection.level
                        : null,
                  })
                }
              />
              <SelectField
                label="Stufe"
                value={selection.level}
                options={onboardingTariffLevels(selection.mode, selection.group).map((value) => ({
                  value,
                  label: `Stufe ${value}`,
                }))}
                error={errors.level}
                onChange={(value) => set("level", value)}
              />
            </>
          )}
          {["TVOED_P", "TVOED_E", "TVAOED_PFLEGE"].includes(selection.mode) ? (
            <>
              <SelectField
                label="Tarifbereich"
                value={selection.sector}
                options={
                  [
                    { value: "BT_K", label: "Krankenhäuser · BT-K" },
                    { value: "BT_B", label: "Pflege und Betreuung · BT-B" },
                  ] as const
                }
                error={errors.sector}
                onChange={(value) => set("sector", value)}
              />
              <SelectField
                label="Tarifgebiet"
                value={selection.tariffRegion}
                options={(["OTHER", "KAV_BW"] as const).map((value) => ({
                  value,
                  label: TARIFF_REGION_LABELS[value],
                }))}
                error={errors.tariffRegion}
                onChange={(value) => set("tariffRegion", value)}
              />
            </>
          ) : null}
          {["TVL_KR", "TVAL_PFLEGE"].includes(selection.mode) ? (
            <SelectField
              label="Tarifgebiet"
              value={selection.universityRegion}
              options={
                [
                  { value: "WEST", label: "West" },
                  { value: "EAST", label: "Ost" },
                ] as const
              }
              error={errors.region}
              onChange={(value) => set("universityRegion", value)}
            />
          ) : null}
          {selection.mode === "TVAL_PFLEGE" ? (
            <SelectField
              label="Arbeitsbereich"
              value={selection.tvalEmployerScope ?? "UNKNOWN"}
              options={TVAL_WORKPLACE_OPTIONS}
              onChange={(value) => set("tvalEmployerScope", value === "UNKNOWN" ? null : value)}
            />
          ) : null}
          {selection.mode === "TVH_KR" ? (
            <SelectField
              label="Tarifliche Vollzeit"
              value={selection.fullTime}
              options={
                [
                  { value: 2310, label: "38,5 h" },
                  { value: 2400, label: "40 h" },
                ] as const
              }
              error={errors.fulltime}
              onChange={(value) => set("fullTime", value)}
            />
          ) : null}
          {mismatch ? (
            <Text style={{ color: p.muted, ...ONBOARDING_TYPOGRAPHY.caption }}>{mismatch}</Text>
          ) : null}
          <FieldError message={errors.hours} />
        </>
      ) : null}
    </View>
  );
}
