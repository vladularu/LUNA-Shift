import type { RefObject } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text, TextInput } from "@/ui/text";
import type { FederalState } from "@/domain/types";
import { ONBOARDING_TYPOGRAPHY, useOnboardingPalette } from "@/theme/onboarding";
import { SPACING, RADII, CONTROL_HEIGHT } from "@/theme/tokens";
import { SALARY_BASIS_OPTIONS } from "@/features/settings/salary-basis-options";
import { BlueprintIcon, NumberField, type BlueprintIconName } from "./onboarding-controls";
import { OnboardingTariffFields } from "./onboarding-tariff-fields";
import {
  OnboardingTariffLogo,
  OnboardingTariffPicker,
  tariffProvider,
} from "./onboarding-tariff-picker";
import { OnboardingReveal } from "./onboarding-motion";
import type {
  OnboardingTariffSelection,
  OnboardingTariffErrors,
  OnboardingTariffMode,
} from "./onboarding-tariff-values";

export type OnboardingSalaryView = "choice" | "tariffs" | "details" | "manual";
export function OnboardingSalary({
  view,
  reduced,
  selection,
  onTariffChange,
  onSelectionChange,
  onModeChange,
  onTariffPicker,
  gross,
  onGrossChange,
  grossRef,
  errors,
  federalState,
}: {
  readonly view: OnboardingSalaryView;
  readonly reduced: boolean;
  readonly selection: OnboardingTariffSelection;
  readonly onTariffChange: (mode: OnboardingTariffMode) => void;
  readonly onSelectionChange: (value: OnboardingTariffSelection) => void;
  readonly onModeChange: (mode: "TARIFF" | "MANUAL") => void;
  readonly onTariffPicker: () => void;
  readonly gross: string;
  readonly onGrossChange: (value: string) => void;
  readonly grossRef: RefObject<TextInput | null>;
  readonly errors: OnboardingTariffErrors & { readonly gross?: string };
  readonly federalState: FederalState | null;
}) {
  const p = useOnboardingPalette();
  return (
    <OnboardingReveal reduced={reduced} appearance={view} style={s.root}>
      {view === "choice"
        ? (
            [
              {
                mode: "TARIFF",
                title: "Nach Tarif",
                caption: "Tarif und Eingruppierung",
                icon: "file-document-outline",
              },
              {
                mode: "MANUAL",
                title: "Brutto eingeben",
                caption: "Monatsbetrag selbst eintragen",
                icon: "cash-multiple",
              },
            ] as const
          ).map((option) => (
            <Pressable
              key={option.mode}
              accessibilityRole="button"
              accessibilityLabel={option.title}
              onPress={() => onModeChange(option.mode)}
              style={({ pressed }) => [
                s.method,
                { backgroundColor: p.surface, borderColor: p.control, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <BlueprintIcon name={option.icon as BlueprintIconName} />
              <View style={s.copy}>
                <Text style={[s.label, { color: p.text }]}>{option.title}</Text>
                <Text style={[s.caption, { color: p.muted }]}>{option.caption}</Text>
              </View>
              <Text accessibilityElementsHidden style={{ color: p.muted }}>
                →
              </Text>
            </Pressable>
          ))
        : null}
      {view === "tariffs" ? (
        <OnboardingTariffPicker selected={selection.mode} onChange={onTariffChange} />
      ) : null}
      {view === "details" && selection.mode ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tarif wechseln"
            onPress={onTariffPicker}
            style={[s.selected, { borderBottomColor: p.border }]}
          >
            <OnboardingTariffLogo mode={selection.mode} />
            <View style={s.copy}>
              <Text style={[s.label, { color: p.text }]}>
                {SALARY_BASIS_OPTIONS.find((option) => option.value === selection.mode)?.label}
              </Text>
              <Text style={[s.caption, { color: p.muted }]}>{tariffProvider(selection.mode)}</Text>
            </View>
            <Text accessibilityElementsHidden style={{ color: p.muted }}>
              ›
            </Text>
          </Pressable>
          <OnboardingTariffFields
            selection={selection}
            onChange={onSelectionChange}
            errors={errors}
            federalState={federalState}
            showTariffSelector={false}
          />
        </>
      ) : null}
      {view === "manual" ? (
        <>
          <NumberField
            label="Monatsbrutto in Euro"
            value={gross}
            onChangeText={onGrossChange}
            placeholder="3.450,50"
            inputRef={grossRef}
            error={errors.gross}
            testID="onboarding-manual-gross"
          />
          <Text style={[s.caption, { color: p.muted }]}>Ohne zusätzliche Zuschläge.</Text>
        </>
      ) : null}
    </OnboardingReveal>
  );
}
const s = StyleSheet.create({
  root: { gap: SPACING.lg },
  method: {
    minHeight: 88,
    borderWidth: 1,
    borderRadius: RADII.card,
    padding: SPACING.lg,
    gap: SPACING.md,
    flexDirection: "row",
    alignItems: "center",
  },
  copy: { flex: 1, gap: SPACING.xxs },
  label: ONBOARDING_TYPOGRAPHY.salaryLabel,
  caption: ONBOARDING_TYPOGRAPHY.smallCaption,
  selected: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
    paddingBottom: SPACING.lg,
    borderBottomWidth: 1,
    minHeight: CONTROL_HEIGHT.compact,
  },
});
