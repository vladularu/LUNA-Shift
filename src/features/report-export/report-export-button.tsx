import { useEffect, useRef, useState } from "react";
import { Alert, Platform, Pressable, View } from "react-native";
import { Text } from "@/ui/text";
import { useSQLiteContext } from "expo-sqlite";
import { Temporal } from "@js-temporal/polyfill";
import {
  usePflegeShiftEntries,
  usePflegeShiftProfile,
  usePflegeShiftStatus,
  usePflegeShiftTariff,
  usePflegeShiftTestData,
} from "@/application/pflegeshift-provider";
import { useRuleCatalogRuntime } from "@/application/rule-catalog-runtime-provider";
import { useCheckPreferences } from "@/features/settings/check-preferences";
import { usePalette } from "@/theme/palette";
import { SPACING, RADII, CONTROL_HEIGHT, CORNER_CURVE } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { scheduleIdleWork } from "@/ui/schedule-idle-work";
import type { ReportDocument } from "./report-document";
import { buildReportSteps } from "./report-data";
import { shareReport, type ReportFormat } from "./share-report";

export function ReportExportButton({ period }: { readonly period: string }) {
  const palette = usePalette();
  const db = useSQLiteContext();
  const { ready, error } = usePflegeShiftStatus();
  const { entries } = usePflegeShiftEntries();
  const { profile } = usePflegeShiftProfile();
  const { tariffDecisions, workPatternSettings } = usePflegeShiftTariff();
  const { testMonths } = usePflegeShiftTestData();
  const { resolver } = useRuleCatalogRuntime();
  const { youthEnabled = false } = useCheckPreferences();
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(true);
  const cancellation = useRef<(() => void) | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancellation.current?.();
    };
  }, []);
  const disabled = busy || !ready || error !== null || profile === null || youthEnabled === null;

  async function exportFormat(format: ReportFormat) {
    if (locked.current || !ready || error !== null || profile === null || youthEnabled === null)
      return;
    locked.current = true;
    setBusy(true);
    try {
      // Read persistence on demand, when the user starts an export.
      /* eslint-disable @typescript-eslint/no-require-imports */
      const { loadNetPayProfileTimeline } =
        require("@/infrastructure/database/net-pay-profile-repository") as typeof import("@/infrastructure/database/net-pay-profile-repository");
      /* eslint-enable @typescript-eslint/no-require-imports */
      const netPayTimeline = await loadNetPayProfileTimeline(db);
      if (!mounted.current) return;
      const createdAt = Temporal.Now.zonedDateTimeISO(profile.timeZone);
      const steps = buildReportSteps({
        period,
        entries,
        profile,
        tariffDecisions,
        workPatternSettings,
        ruleResolver: resolver,
        createdAt: createdAt.toString(),
        referenceDate: createdAt.toPlainDate().toString(),
        youthProtection: youthEnabled,
        testMonths,
        netPayTimeline,
      });
      const report = await new Promise<ReportDocument>((resolve, reject) => {
        const advance = () => {
          try {
            const deadline = performance.now() + 4;
            let step = steps.next();
            let count = 1;
            while (!step.done && count < 24 && performance.now() < deadline) {
              step = steps.next();
              count += 1;
            }
            if (step.done) {
              cancellation.current = null;
              resolve(step.value);
            } else {
              const cancel = scheduleIdleWork(advance);
              cancellation.current = () => {
                cancel();
                reject(new Error("Export abgebrochen."));
              };
            }
          } catch (failure) {
            cancellation.current = null;
            reject(failure);
          }
        };
        const cancel = scheduleIdleWork(advance);
        cancellation.current = () => {
          cancel();
          reject(new Error("Export abgebrochen."));
        };
      });
      if (mounted.current && report) await shareReport(report, format);
    } catch {
      if (mounted.current)
        Alert.alert(
          "Export nicht möglich",
          "Der Bericht konnte nicht erstellt oder geteilt werden. Bitte versuche es erneut.",
        );
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  if (Platform.OS !== "ios") return null;
  return (
    <View style={{ gap: SPACING.xs }}>
      <Text
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}
      >
        Vollständiger {period.length === 4 ? "Jahresbericht" : "Monatsbericht"} · inklusive
        Auswertung und Gehaltsprognose
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled, busy }}
        disabled={disabled}
        onPress={() =>
          Alert.alert(
            "Bericht exportieren",
            `Alle Daten für ${period}, einschließlich Termine, Notizen, Auswertung und Gehaltsprognose.`,
            [
              { text: "PDF", onPress: () => void exportFormat("PDF") },
              { text: "CSV", onPress: () => void exportFormat("CSV") },
              { text: "Abbrechen", style: "cancel" },
            ],
          )
        }
        style={({ pressed }) => ({
          minHeight: CONTROL_HEIGHT.regular,
          justifyContent: "center",
          alignItems: "center",
          padding: SPACING.sm,
          borderRadius: RADII.control,
          borderCurve: CORNER_CURVE,
          backgroundColor: palette.surfaceMuted,
          opacity: disabled || pressed ? 0.5 : 1,
        })}
      >
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{ color: palette.primary, ...TYPOGRAPHY.button }}
        >
          {busy ? "Bericht wird erstellt …" : "Bericht exportieren"}
        </Text>
      </Pressable>
    </View>
  );
}
