import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, View } from "react-native";
import { usePflegeShiftProfile, usePflegeShiftStatus } from "@/application/pflegeshift-provider";
import {
  SALARY_PAYMENT_GROUPS,
  resolveSalaryPaymentPeriod,
  salaryPaymentSources,
  setSalaryPaymentLag,
} from "@/domain/salary-payment";
import { employmentProfileAt } from "@/domain/employment-history";
import { formatMonthTitle } from "@/engine/calendar";
import { parseMonthRouteParam } from "@/navigation/route-params";
import { SPACING } from "@/theme/tokens";
import { InlineNotice } from "@/ui/design-system";
import {
  NetPayWorkflowLink,
  NetPayWorkflowSelect,
  NetPayWorkflowText,
} from "./net-pay-workflow-controls";
import { NetPaySetupForm } from "./net-pay-setup-form";
import { useSalaryPaymentPreferences } from "./salary-payment-preferences";
import { useNetPayProfile } from "./use-net-pay-profile";

type LagChoice = "0" | "1" | "2";
const OPTIONS = [
  { value: "0", label: "Im selben Monat" },
  { value: "1", label: "Im Folgemonat" },
  { value: "2", label: "Im übernächsten Monat" },
] as const;

export function SalaryPayrollSettings({
  month,
  blocked,
  onChanged,
  netRequestMonth,
  onNetRequestHandled,
  onDirtyChange,
  onBusyChange,
  timingOnly = false,
}: {
  readonly month: string;
  readonly blocked: boolean;
  readonly onChanged?: () => void;
  readonly netRequestMonth?: string | null;
  readonly onNetRequestHandled?: () => void;
  readonly onDirtyChange?: (dirty: boolean) => void;
  readonly onBusyChange?: (busy: boolean) => void;
  readonly timingOnly?: boolean;
}) {
  const payment = useSalaryPaymentPreferences();
  const { profile } = usePflegeShiftProfile();
  const root = usePflegeShiftStatus();
  const [netMonth, setNetMonth] = useState(month);
  const [netDirty, setNetDirty] = useState(false);
  const [timingBusy, setTimingBusy] = useState(false);
  const [timingError, setTimingError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const timingWriting = useRef(false);
  const handledRequest = useRef<string | null>(null);
  const net = useNetPayProfile(netMonth, !timingOnly && !blocked && root.ready && !!profile);
  const work = profile ? employmentProfileAt(profile, `${netMonth}-01`) : null;
  const period = resolveSalaryPaymentPeriod(payment.preferences, month);
  const configuredLag = period ? period.delays.PREMIUMS : 0;
  const lag =
    configuredLag !== null &&
    (!period || SALARY_PAYMENT_GROUPS.every((group) => period.delays[group] === configuredLag))
      ? configuredLag
      : null;
  const choice = !payment.ready || lag === null ? null : (String(lag) as LagChoice);
  const sourcePlans = SALARY_PAYMENT_GROUPS.map((group) =>
    salaryPaymentSources(payment.preferences, month, group),
  );
  const sourceMonths = [...new Set(sourcePlans.flatMap((plan) => plan.months))].sort();
  const sourceCaption = sourcePlans.some((plan) => plan.unresolvedMonths.length > 0)
    ? "Zulagenmonat noch offen"
    : sourceMonths.length
      ? `${sourceMonths.length === 1 ? "Zulagenmonat" : "Zulagenmonate"}: ${sourceMonths.map(formatMonthTitle).join(" und ")}`
      : "In diesem Monat keine Zulagen zugeordnet.";
  const locked = blocked || !payment.ready || payment.saving || timingBusy || net.busy;
  const writing = timingBusy || payment.saving || net.busy;
  useEffect(() => onDirtyChange?.(netDirty), [netDirty, onDirtyChange]);
  useEffect(() => onBusyChange?.(writing), [writing, onBusyChange]);

  useEffect(() => {
    setNetMonth(month);
    setSavedNotice(null);
  }, [month]);
  useEffect(() => {
    if (!netRequestMonth) {
      handledRequest.current = null;
      return;
    }
    if (handledRequest.current === netRequestMonth) return;
    handledRequest.current = netRequestMonth;
    const parsed = parseMonthRouteParam(netRequestMonth);
    if (parsed.status === "valid") {
      const open = () => {
        setNetMonth(parsed.value);
        setSavedNotice(null);
      };
      if (netDirty && parsed.value !== netMonth)
        Alert.alert("Änderungen verwerfen?", "Deine Netto-Angaben sind noch nicht gespeichert.", [
          { text: "Weiter bearbeiten", style: "cancel" },
          { text: "Änderungen verwerfen", style: "destructive", onPress: open },
        ]);
      else open();
    }
    onNetRequestHandled?.();
  }, [netRequestMonth, onNetRequestHandled, netDirty, netMonth]);

  async function saveTiming(value: LagChoice) {
    if (locked || timingWriting.current) return;
    timingWriting.current = true;
    setTimingBusy(true);
    setTimingError(null);
    try {
      await payment.save(
        setSalaryPaymentLag(payment.preferences, month, Number(value) as 0 | 1 | 2),
      );
      onChanged?.();
    } catch {
      setTimingError(
        "Der Auszahlungsmonat wurde nicht gespeichert. Bitte erneut laden und versuchen.",
      );
    } finally {
      timingWriting.current = false;
      setTimingBusy(false);
    }
  }

  return (
    <View style={{ gap: SPACING.lg }}>
      <View style={{ gap: SPACING.sm }}>
        <NetPayWorkflowSelect<LagChoice>
          label="Zulagen werden ausgezahlt"
          value={choice}
          options={OPTIONS}
          disabled={locked}
          onChange={(value) => void saveTiming(value)}
        />
        <NetPayWorkflowText>
          {payment.ready ? sourceCaption : "Auszahlungsmonat wird geladen …"}
        </NetPayWorkflowText>
        {timingBusy || payment.saving ? (
          <ActivityIndicator accessibilityLabel="Auszahlungsmonat wird gespeichert" />
        ) : null}
        {timingError || payment.error ? (
          <>
            <InlineNotice message={timingError ?? payment.error!} />
            <NetPayWorkflowLink
              disabled={timingBusy || payment.saving}
              onPress={() => {
                setTimingError(null);
                void payment.reload();
              }}
            >
              Erneut laden
            </NetPayWorkflowLink>
          </>
        ) : null}
      </View>
      {timingOnly ? null : blocked ? (
        <InlineNotice message="Für Testdaten werden keine Abrechnungsangaben gespeichert." />
      ) : !root.ready || !profile || net.status === "loading" ? (
        <ActivityIndicator accessibilityLabel="Netto-Angaben werden geladen" />
      ) : net.status === "error" ? (
        <>
          <InlineNotice message={net.error ?? "Die Netto-Angaben konnten nicht geladen werden."} />
          <NetPayWorkflowLink onPress={net.reload}>Netto-Angaben erneut laden</NetPayWorkflowLink>
        </>
      ) : (
        <>
          {netMonth !== month ? (
            <NetPayWorkflowText>Netto-Angaben für {formatMonthTitle(netMonth)}</NetPayWorkflowText>
          ) : null}
          <NetPaySetupForm
            key={netMonth}
            inline
            month={netMonth}
            initial={net.saved?.settings ?? null}
            firstSetup={net.timeline.length === 0}
            worksInSaxony={work?.federalState === "SN"}
            churchTaxDefaultPercent={
              work?.federalState === "BY" || work?.federalState === "BW" ? 8 : 9
            }
            busy={locked}
            onSave={net.save}
            onDirtyChange={setNetDirty}
            onSaved={() => {
              setSavedNotice("Netto-Angaben gespeichert.");
              onChanged?.();
              if (netMonth !== month) setNetMonth(month);
            }}
          />
          {savedNotice ? <NetPayWorkflowText>{savedNotice}</NetPayWorkflowText> : null}
        </>
      )}
    </View>
  );
}
