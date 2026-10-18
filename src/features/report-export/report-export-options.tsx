import { Pressable, View } from "react-native";
import { Text } from "@/ui/text";
import { SegmentedControl, SurfaceCard } from "@/ui/design-system";
import { LabeledSwitch } from "@/ui/labeled-switch";
import { usePalette } from "@/theme/palette";
import { CONTROL_HEIGHT, CORNER_CURVE, RADII, SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { REPORT_CHECK_SCOPE, type ReportOptions } from "./report-document";
import type { ReportFormat } from "./share-report";

export function ReportExportOptions({
  annual,
  format,
  options,
  onFormatChange,
  onOptionsChange,
  onExport,
}: {
  readonly annual: boolean;
  readonly format: ReportFormat;
  readonly options: ReportOptions;
  readonly onFormatChange: (value: ReportFormat) => void;
  readonly onOptionsChange: (value: ReportOptions) => void;
  readonly onExport: () => void;
}) {
  const palette = usePalette();
  const caption = { ...TYPOGRAPHY.caption, color: palette.textMuted };
  return (
    <View style={{ padding: SPACING.md, gap: SPACING.md }}>
      <SegmentedControl
        accessibilityLabel="Dateiformat"
        value={format}
        items={[
          { value: "PDF", label: "PDF" },
          { value: "CSV", label: "CSV" },
        ]}
        onChange={(value) => onFormatChange(value === "CSV" ? "CSV" : "PDF")}
      />
      {format === "PDF" ? (
        <>
          <Text
            maxFontSizeMultiplier={TEXT_MAX_SCALE}
            style={{ ...TYPOGRAPHY.sectionTitle, color: palette.text }}
          >
            Berichtsumfang
          </Text>
          <SegmentedControl
            accessibilityLabel="Berichtsumfang"
            value={options.layout}
            items={[
              { value: "standard", label: "Standard" },
              { value: "compact", label: "Kompakt" },
            ]}
            onChange={(value) =>
              onOptionsChange({ ...options, layout: value === "compact" ? "compact" : "standard" })
            }
          />
          <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={caption}>
            {options.layout === "compact"
              ? annual
                ? "1 Seite: Jahresübersicht mit zwölf Monatszeilen."
                : "1 Seite: Monatskalender und wichtigste Summen."
              : annual
                ? "2 Seiten: Zusammenfassung und zwölf Monatszeilen."
                : "2–3 Seiten: Zusammenfassung und Dienstliste."}
          </Text>
          <SurfaceCard>
            <View
              style={{
                padding: SPACING.md,
                flexDirection: "row",
                alignItems: "center",
                gap: SPACING.sm,
              }}
            >
              <Text
                maxFontSizeMultiplier={TEXT_MAX_SCALE}
                style={{ ...TYPOGRAPHY.body, color: palette.text, flex: 1 }}
              >
                Gehaltsprognose einfügen
              </Text>
              <LabeledSwitch
                label="Gehaltsprognose einfügen"
                value={options.includeSalary}
                onValueChange={(includeSalary) => onOptionsChange({ ...options, includeSalary })}
              />
            </View>
          </SurfaceCard>
          {options.includeSalary ? (
            <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={caption}>
              Brutto und Netto sind Schätzungen, keine Lohnabrechnung.
            </Text>
          ) : null}
          <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={caption}>
            Prüfung im PDF: {REPORT_CHECK_SCOPE}
          </Text>
        </>
      ) : (
        <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={caption}>
          Für Excel: eine Zeile pro Dienst, Abwesenheit oder Termin mit Datum, Zeiten, Pause und
          Zeitgutschrift.
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${format} erstellen und teilen`}
        onPress={onExport}
        style={({ pressed }) => ({
          minHeight: CONTROL_HEIGHT.regular,
          alignItems: "center",
          justifyContent: "center",
          padding: SPACING.sm,
          borderRadius: RADII.control,
          borderCurve: CORNER_CURVE,
          backgroundColor: palette.primary,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{ ...TYPOGRAPHY.button, color: palette.onPrimary }}
        >
          {format} erstellen und teilen
        </Text>
      </Pressable>
    </View>
  );
}
