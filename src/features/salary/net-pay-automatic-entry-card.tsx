import { useState } from "react";
import { router } from "expo-router";
import { Text } from "@/ui/text";
import { View } from "react-native";
import { usePflegeShiftEntries, usePflegeShiftProfile } from "@/application/pflegeshift-provider";
import { premiumDetailsRoute, settingsEditorRoute } from "@/navigation/routes";
import { SPACING } from "@/theme/tokens";
import { usePalette } from "@/theme/palette";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { SurfaceCard } from "@/ui/design-system";
import { SecondaryButton } from "@/ui/form-controls";
import { FormStatus } from "@/ui/form-layout";
import { NetPayText } from "./net-pay-controls";
import {
  NetPaySalarySummary,
  NetPaySummaryMetric,
  NetPayDetailAmount,
  NetPayDeductionDetails,
} from "./net-pay-salary-summary";
import { NetPaySheet } from "./net-pay-sheet";
import { NetPaySetupForm } from "./net-pay-setup-form";
import { NetPayPremiumDetails } from "./net-pay-premium-details";
import { NetPayServiceDetails } from "./net-pay-service-details";
import { NetPayAmountRow } from "./net-pay-amount-row";
import { useNetPayProfile } from "./use-net-pay-profile";
import { useAutomaticNetPay } from "./use-automatic-net-pay";
import {
  NetPayWorkflowAction,
  NetPayWorkflowLink,
  NetPayWorkflowRow,
  NetPayWorkflowText,
} from "./net-pay-workflow-controls";

type Dialog = "setup" | "settings";
const TITLES: Record<Dialog, string> = {
  setup: "Netto einrichten",
  settings: "Meine Netto-Angaben",
};

export function NetPayAutomaticEntryCard({
  month,
  proposedGrossCents,
  blocked,
  caption,
  grossItems,
  showPremiumDetails = false,
  nightCompensatoryMinutes = 0,
}: {
  readonly month: string;
  readonly proposedGrossCents: number | null;
  readonly blocked: boolean;
  readonly caption?: string;
  readonly grossItems?: readonly {
    readonly label: string;
    readonly value: string;
    readonly onPress?: () => void;
  }[];
  readonly showPremiumDetails?: boolean;
  readonly nightCompensatoryMinutes?: number;
}) {
  const palette = usePalette();
  const { profile } = usePflegeShiftProfile();
  const { entries } = usePflegeShiftEntries();
  const data = useNetPayProfile(month, !blocked);
  const settings = data.saved?.settings ?? null;
  const configured = settings?.version === 2;
  const forecast = useAutomaticNetPay(
    month,
    settings,
    configured && !blocked && data.status === "ready",
  );
  const available = forecast?.result.status === "available" ? forecast.result : null;
  const [dialog, setDialog] = useState<{ month: string; view: Dialog } | null>(null);
  const [detail, setDetail] = useState<{ month: string; view: "gross" | "deductions" } | null>(
    null,
  );
  const [premiumMonth, setPremiumMonth] = useState<string | null>(null);
  const [servicesMonth, setServicesMonth] = useState<string | null>(null);
  const grossExpanded = detail?.month === month && detail.view === "gross";
  const deductionsExpanded = detail?.month === month && detail.view === "deductions";
  function toggleDetail(next: "gross" | "deductions") {
    setDetail((current) =>
      current?.month === month && current.view === next ? null : { month, view: next },
    );
  }
  const view = dialog?.month === month && !blocked && data.status === "ready" ? dialog.view : null;
  function open(next: Dialog) {
    setDialog({ month, view: next });
  }
  function close() {
    if (!data.busy) setDialog(null);
  }
  function openGross() {
    if (proposedGrossCents !== null || available) toggleDetail("gross");
    else router.push(settingsEditorRoute("TARIFF"));
  }
  const grossDetails = grossExpanded ? (
    <View
      testID="net-pay-gross-composition"
      style={{ borderTopWidth: 1, borderTopColor: palette.separator, paddingTop: SPACING.sm }}
    >
      {grossItems?.map((item) => (
        <NetPayAmountRow
          key={item.label}
          label={item.label}
          value={item.value}
          onPress={item.onPress}
        />
      ))}
      {!grossItems?.length ? (
        <NetPayWorkflowText>Aus deiner Gehaltsauswertung übernommen.</NetPayWorkflowText>
      ) : null}
      {(settings?.automation?.additionalRecurringGrossCents ?? 0) > 0 ? (
        <NetPayDetailAmount
          label="Weitere feste monatliche Zulage"
          cents={settings!.automation!.additionalRecurringGrossCents}
        />
      ) : null}
      {nightCompensatoryMinutes > 0 ? (
        <NetPayWorkflowText>
          Zusätzlich{" "}
          {new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(
            nightCompensatoryMinutes,
          )}{" "}
          Min. Freizeitausgleich für Nachtarbeit.
        </NetPayWorkflowText>
      ) : null}
    </View>
  ) : null;
  return (
    <>
      <View
        accessibilityElementsHidden={view !== null}
        importantForAccessibility={view !== null ? "no-hide-descendants" : "auto"}
        style={{ gap: SPACING.md }}
      >
        {!available && caption ? (
          <Text
            maxFontSizeMultiplier={TEXT_MAX_SCALE}
            style={{ color: palette.textMuted, ...TYPOGRAPHY.caption, textAlign: "center" }}
          >
            {caption}
          </Text>
        ) : null}
        {available ? (
          <NetPaySalarySummary
            pay={available.pay}
            pensionOmitted={forecast!.pensionOmitted ?? false}
            premiums={available.classification}
            caption={caption}
            onGross={openGross}
            onDeductions={() => toggleDetail("deductions")}
            deductionsExpanded={deductionsExpanded}
            deductionDetails={
              deductionsExpanded ? (
                <View
                  testID="net-pay-deduction-details"
                  style={{
                    borderTopWidth: 1,
                    borderTopColor: palette.separator,
                    paddingTop: SPACING.md,
                  }}
                >
                  <NetPayDeductionDetails
                    pay={available.pay}
                    month={month}
                    pensionOmitted={forecast!.pensionOmitted ?? false}
                    compact
                  />
                </View>
              ) : null
            }
            onPremiums={() => setPremiumMonth(premiumMonth === month ? null : month)}
            premiumsExpanded={premiumMonth === month}
            premiumDetails={
              premiumMonth === month ? (
                <NetPayPremiumDetails
                  key={`premiums:${month}`}
                  classification={available.classification}
                  compact
                />
              ) : null
            }
            onServices={() => setServicesMonth(servicesMonth === month ? null : month)}
            servicesExpanded={servicesMonth === month}
            serviceDetails={
              servicesMonth === month ? (
                <NetPayServiceDetails
                  key={`services:${month}`}
                  classification={available.classification}
                  shifts={entries.filter((entry) => entry.kind === "SHIFT")}
                />
              ) : null
            }
            grossExpanded={grossExpanded}
            grossDetails={grossDetails}
          />
        ) : (
          <SurfaceCard style={{ padding: SPACING.lg, gap: SPACING.md }}>
            {proposedGrossCents !== null ? (
              <NetPaySummaryMetric
                label="Gesamtbrutto"
                cents={proposedGrossCents}
                onPress={openGross}
                expanded={grossExpanded}
                large
              />
            ) : null}
            {grossDetails}
            {showPremiumDetails ? (
              <NetPayWorkflowLink onPress={() => router.push(premiumDetailsRoute(month))}>
                Zuschläge nach Diensten
              </NetPayWorkflowLink>
            ) : null}
            {blocked ? (
              <NetPayText>
                In einem aktiven Testmonat ist die persönliche Netto-Prognose gesperrt.
              </NetPayText>
            ) : data.status === "loading" ? (
              <NetPayText>Netto-Angaben werden geladen …</NetPayText>
            ) : data.status === "error" ? (
              <>
                <FormStatus error={data.error} />
                <SecondaryButton onPress={data.reload}>Erneut laden</SecondaryButton>
              </>
            ) : !configured ? (
              <>
                <NetPayWorkflowText>
                  Gehalt und Dienste sind übernommen. Richte dein Netto einmalig ein.
                </NetPayWorkflowText>
                <NetPayWorkflowAction onPress={() => open("setup")} disabled={data.busy}>
                  Netto einmal einrichten
                </NetPayWorkflowAction>
                <NetPayWorkflowText>Drei kurze Schritte – danach automatisch.</NetPayWorkflowText>
              </>
            ) : (
              <>
                <NetPayText>
                  {forecast?.result.status === "unavailable"
                    ? forecast.result.reason
                    : "Netto wird berechnet …"}
                </NetPayText>
                {forecast?.result.status === "unavailable" ? (
                  <SecondaryButton
                    onPress={
                      forecast?.result.status === "unavailable" &&
                      forecast.result.stage === "net-pay"
                        ? () => open("settings")
                        : () => router.push(settingsEditorRoute("TARIFF"))
                    }
                  >
                    {forecast?.result.status === "unavailable" &&
                    forecast.result.stage === "net-pay"
                      ? "Netto-Angaben prüfen"
                      : "Gehaltsgrundlage ansehen"}
                  </SecondaryButton>
                ) : null}
              </>
            )}
          </SurfaceCard>
        )}
        {!blocked && configured && data.status === "ready" ? (
          <NetPayWorkflowRow
            title="Meine Netto-Angaben"
            icon="options-outline"
            subtitle={`Klasse ${settings.profile.taxClass} · ${settings.profile.churchTaxRatePercent ? "mit" : "ohne"} Kirchensteuer${forecast?.pensionOmitted ? " · ZVK offen" : ""}`}
            onPress={() => open("settings")}
            disabled={data.busy}
          />
        ) : null}
        <Text
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{ textAlign: "center", color: palette.textMuted, ...TYPOGRAPHY.footnote }}
        >
          Prognose aus Gehalt und geplanten Diensten.
        </Text>
      </View>
      {view ? (
        <NetPaySetupForm
          key={`${month}:${view}`}
          month={month}
          initial={settings}
          allowSectionSwitch={view === "settings"}
          worksInSaxony={profile?.federalState === "SN"}
          churchTaxDefaultPercent={
            profile?.federalState === "BY" || profile?.federalState === "BW" ? 8 : 9
          }
          busy={data.busy}
          renderLayout={({ content, footer, onBack, locked, editing, page }) => (
            <NetPaySheet
              title={editing ? "Angaben ändern" : TITLES[view]}
              visible
              busy={locked}
              onClose={close}
              onBack={onBack}
              backLabel={
                view === "settings" ? "Zurück zur Angaben-Übersicht" : "Vorheriger Schritt"
              }
              footer={footer}
              contentKey={`${view}:${page}`}
            >
              {settings?.version === 1 && view === "setup" ? (
                <NetPayText>
                  Deine bisherigen Angaben gelten nur für diesen Monat. Nach dem Speichern werden
                  sie auch für folgende Monate übernommen.
                </NetPayText>
              ) : null}
              {content}
            </NetPaySheet>
          )}
          onSave={async (value) => {
            await data.save(value);
            if (view === "setup")
              setDialog((current) => (current?.month === value.month ? null : current));
          }}
        />
      ) : null}
    </>
  );
}
