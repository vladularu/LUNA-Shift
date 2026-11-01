import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { View } from "react-native";
import {
  usePflegeShiftProfile,
  usePflegeShiftStatus,
  usePflegeShiftTestData,
} from "@/application/pflegeshift-provider";
import {
  SALARY_PAYMENT_GROUPS,
  resolveSalaryPaymentPeriod,
  setSalaryPaymentLag,
  type SalaryPaymentPreferences,
} from "@/domain/salary-payment";
import { useProfileLeaveGuard } from "@/features/settings/use-profile-leave-guard";
import { parseMonthRouteParam, type RouteParam } from "@/navigation/route-params";
import { netPaySettingsRoute } from "@/navigation/routes";
import { SPACING } from "@/theme/tokens";
import { InlineNotice } from "@/ui/design-system";
import { PrimaryButton } from "@/ui/form-controls";
import { LoadFailureView, LoadingView } from "@/ui/loading-view";
import { NetPayWorkflowSelect, NetPayWorkflowText } from "./net-pay-workflow-controls";
import { useSalaryPaymentPreferences } from "./salary-payment-preferences";
import { SalaryPage } from "./salary-ui";

type LagChoice = "0" | "1" | "2";
const LAG_OPTIONS = [
  { value: "0", label: "Im selben Monat" },
  { value: "1", label: "Im Folgemonat" },
  { value: "2", label: "Im übernächsten Monat" },
] as const;

export function SalaryPaymentSettingsScreen() {
  const params = useLocalSearchParams<{ month?: RouteParam }>();
  const parsed = parseMonthRouteParam(params.month);
  const { profile } = usePflegeShiftProfile();
  const status = usePflegeShiftStatus();
  const { testMonths } = usePflegeShiftTestData();
  const data = useSalaryPaymentPreferences();
  const month = parsed.status === "valid" ? parsed.value : "2000-01";
  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace(netPaySettingsRoute(month));
  };
  let content;
  if (parsed.status !== "valid")
    content = (
      <LoadFailureView
        message="Der Link enthält keinen gültigen Monat."
        actionLabel="Zurück"
        onRetry={back}
      />
    );
  else if (status.error)
    content = <LoadFailureView message={status.error} onRetry={() => void status.reload()} />;
  else if (!data.ready && data.error)
    content = <LoadFailureView message={data.error} onRetry={() => void data.reload()} />;
  else if (testMonths.length > 0)
    content = <InlineNotice message="Schließe zuerst den offenen Testlauf ab." />;
  else if (!status.ready || !profile || !data.ready) content = <LoadingView />;
  else
    content = (
      <SalaryPaymentSettingsForm
        key={month}
        month={month}
        initial={data.preferences}
        saving={data.saving}
        onSave={data.save}
        onSaved={back}
      />
    );
  return (
    <SalaryPage title="Auszahlung der Zulagen" backLabel="Zurück zu den Netto-Einstellungen">
      {content}
    </SalaryPage>
  );
}

export function SalaryPaymentSettingsForm({
  month,
  initial,
  saving,
  onSave,
  onSaved,
}: {
  readonly month: string;
  readonly initial: SalaryPaymentPreferences;
  readonly saving: boolean;
  readonly onSave: (value: SalaryPaymentPreferences) => Promise<void>;
  readonly onSaved: () => void;
}) {
  const [choice, setChoice] = useState<LagChoice | null>(() => {
    const period = resolveSalaryPaymentPeriod(initial, month);
    if (!period) return "0";
    const lag = period.delays.PREMIUMS;
    return lag !== null && SALARY_PAYMENT_GROUPS.every((group) => period.delays[group] === lag)
      ? (String(lag) as LagChoice)
      : null;
  });
  const [baseline] = useState(choice);
  const [error, setError] = useState<string | null>(null);
  const [localSaving, setLocalSaving] = useState(false);
  const submitting = useRef(false);
  const locked = saving || localSaving;
  const leave = useProfileLeaveGuard(choice !== baseline, locked);

  async function save() {
    if (locked || submitting.current) return;
    if (choice === null) {
      setError("Bitte wähle den Auszahlungsmonat aus.");
      return;
    }
    submitting.current = true;
    setLocalSaving(true);
    setError(null);
    try {
      await onSave(setSalaryPaymentLag(initial, month, Number(choice) as 0 | 1 | 2));
      leave.saved(onSaved);
    } catch {
      setError(
        "Nicht gespeichert. Deine bisherige Einstellung bleibt erhalten. Bitte erneut laden und versuchen.",
      );
    } finally {
      submitting.current = false;
      setLocalSaving(false);
    }
  }
  return (
    <View style={{ gap: SPACING.lg }}>
      <NetPayWorkflowSelect<LagChoice>
        label="Zulagen werden ausgezahlt"
        value={choice}
        options={LAG_OPTIONS}
        disabled={locked}
        onChange={(value) => {
          setChoice(value);
          setError(null);
        }}
      />
      <NetPayWorkflowText>Gilt ab dieser Auszahlung.</NetPayWorkflowText>
      {error ? <InlineNotice message={error} /> : null}
      <PrimaryButton disabled={locked} busy={locked} onPress={() => void save()}>
        Speichern
      </PrimaryButton>
    </View>
  );
}
