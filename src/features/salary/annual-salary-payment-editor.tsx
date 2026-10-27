import { useState } from "react";
import { View } from "react-native";
import type { MonthlyNetPaySettings } from "@/domain/net-pay-profile";
import { validateMonthlyNetPaySettings } from "@/domain/net-pay-profile";
import { annualPayoutMonths, salaryAnnualFamily } from "@/domain/salary-annual-schedule";
import {
  validateAnnualSalaryPayments,
  type AnnualPaymentNetBasis,
  type AnnualSalaryPayment,
} from "@/domain/annual-salary-payment";
import type { UserProfile } from "@/domain/types";
import { Field } from "@/ui/form-controls";
import { FormStatus } from "@/ui/form-layout";
import { NetPayCheck } from "./net-pay-controls";
import { decimalFormValue, parseNetPayDecimal } from "./net-pay-form-values";
import {
  NetPayWorkflowAction,
  NetPayWorkflowSelect,
  NetPayWorkflowText,
  NetPayWorkflowLink,
} from "./net-pay-workflow-controls";
import { SalarySectionCard, SalaryNavigationRow } from "./salary-ui";
import { NetPaySheet } from "./net-pay-sheet";
import { netPayEuro } from "./net-pay-format";
import { formatMonthTitle } from "@/engine/calendar";
import type { AnnualSalaryProposal } from "./annual-salary-proposal";
import { SPACING } from "@/theme/tokens";

function payrollValues(basis: AnnualPaymentNetBasis | null | undefined) {
  return {
    annualTaxableGross:
      basis?.kind === "PAYROLL" ? decimalFormValue(basis.annualTaxableGrossCents) : "",
    healthAssessed: basis?.kind === "PAYROLL" ? decimalFormValue(basis.healthAssessedCents) : "",
    pensionAssessed: basis?.kind === "PAYROLL" ? decimalFormValue(basis.pensionAssessedCents) : "",
    socialInsuranceDays: basis?.kind === "PAYROLL" ? String(basis.socialInsuranceDays) : "",
  };
}

export function AnnualSalaryPaymentEditor({
  month,
  profile,
  settings,
  busy,
  onSave,
  forecastPayments = [],
  proposal,
  automatic = false,
  onResetAutomatic,
}: {
  readonly month: string;
  readonly profile: UserProfile;
  readonly settings: MonthlyNetPaySettings;
  readonly busy: boolean;
  readonly onSave: (settings: MonthlyNetPaySettings) => Promise<void>;
  readonly forecastPayments?: readonly AnnualSalaryPayment[];
  readonly proposal?: AnnualSalaryProposal | null;
  readonly automatic?: boolean;
  readonly onResetAutomatic?: () => Promise<void>;
}) {
  const year = month.slice(0, 4);
  const payments = settings.automation?.annualPayments ?? [];
  const visible = forecastPayments.length ? forecastPayments : payments;
  const initial =
    visible.find((p) => p.payoutMonth === month) ??
    visible.find((p) => p.payoutMonth.startsWith(`${year}-`));
  const initialPayout =
    initial?.payoutMonth ??
    annualPayoutMonths(salaryAnnualFamily(profile), Number(year))[0] ??
    month;
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState(false);
  const [payout, setPayout] = useState(initialPayout);
  const [gross, setGross] = useState("");
  const [forecast, setForecast] = useState(true);
  const [payroll, setPayroll] = useState(false);
  const [yearValues, setYearValues] = useState(() => payrollValues(null));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const locked = busy || saving;
  function edit() {
    setPayout(initialPayout);
    setGross(initial ? decimalFormValue(initial.grossCents) : "");
    setForecast(initial ? initial.netBasis?.kind === "CONSTANT_PAY" : true);
    setPayroll(initial?.netBasis?.kind === "PAYROLL");
    setYearValues(payrollValues(initial?.netBasis));
    setDetails(false);
    setError(null);
    setOpen(true);
  }
  async function save() {
    if (locked || !settings.automation) return;
    setError(null);
    try {
      if (!gross.trim())
        throw new Error("Bitte einen Bruttobetrag eintragen. Keine Zahlung? Trage 0 ein.");
      if (payroll && Object.values(yearValues).some((value) => !value.trim()))
        throw new Error("Bitte die Jahreswerte vollständig eintragen. Nullwerte als 0 eingeben.");
      const grossCents = parseNetPayDecimal(gross, 100, "die Sonderzahlung");
      if (
        automatic &&
        initial &&
        payout === initial.payoutMonth &&
        grossCents === initial.grossCents &&
        !payroll &&
        forecast
      ) {
        setOpen(false);
        return;
      }
      const previous = payments.find((p) => p.payoutMonth === payout);
      const moved = payments.find(
        (p) => p.payoutMonth === initialPayout && payout !== initialPayout,
      );
      const next = validateAnnualSalaryPayments([
        ...payments.filter((p) => p.payoutMonth !== payout && p !== moved),
        ...(moved ? [{ ...moved, revision: moved.revision + 1, grossCents: 0 }] : []),
        {
          revision: (previous?.revision ?? 0) + 1,
          payoutMonth: payout,
          grossCents,
          netBasis: payroll
            ? {
                kind: "PAYROLL",
                annualTaxableGrossCents: parseNetPayDecimal(
                  yearValues.annualTaxableGross,
                  100,
                  "das Jahressteuerbrutto",
                ),
                healthAssessedCents: parseNetPayDecimal(
                  yearValues.healthAssessed,
                  100,
                  "die bisherige KV-/PV-Beitragsgrundlage",
                ),
                pensionAssessedCents: parseNetPayDecimal(
                  yearValues.pensionAssessed,
                  100,
                  "die bisherige RV-/AV-Beitragsgrundlage",
                ),
                socialInsuranceDays: Number(yearValues.socialInsuranceDays),
              }
            : forecast
              ? { kind: "CONSTANT_PAY" }
              : null,
        },
      ]);
      const value = validateMonthlyNetPaySettings({
        ...settings,
        month,
        specialCases: settings.specialCases.filter((v) => v !== "ONE_OFF_PAYMENT"),
        automation: { ...settings.automation, annualPayments: next },
      });
      setSaving(true);
      await onSave(value);
      setOpen(false);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Die Änderung konnte nicht gespeichert werden.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function resetAutomatic() {
    if (locked || !onResetAutomatic || !proposal) return;
    setError(null);
    setSaving(true);
    try {
      await onResetAutomatic();
      setOpen(false);
    } catch {
      setError(
        "Die automatische Berechnung konnte nicht übernommen werden. Bitte erneut versuchen.",
      );
    } finally {
      setSaving(false);
    }
  }
  const movedAway =
    initial?.grossCents === 0 &&
    visible.some((payment) => payment.payoutMonth.startsWith(`${year}-`) && payment.grossCents > 0);
  if (initialPayout !== month || movedAway) return null;
  return (
    <>
      <View
        accessibilityElementsHidden={open}
        importantForAccessibility={open ? "no-hide-descendants" : "auto"}
      >
        <SalarySectionCard
          title="Weihnachtsgeld"
          amount={initial ? netPayEuro(initial.grossCents) : undefined}
        >
          <SalaryNavigationRow
            title={initial ? "Anpassen" : "Betrag ergänzen"}
            subtitle={`${automatic ? "Automatisch nach Tarif" : initial ? "Eigener Betrag" : "Keine Tarifprognose"} · ${formatMonthTitle(initialPayout)}`}
            onPress={edit}
            disabled={locked}
          />
          {!automatic &&
          proposal &&
          onResetAutomatic &&
          payments.some((payment) => payment.payoutMonth.startsWith(`${year}-`)) ? (
            <SalaryNavigationRow
              title="Automatisch nach Tarif berechnen"
              subtitle={`${netPayEuro(proposal.grossCents)} · eigener Betrag wird ersetzt`}
              onPress={() => void resetAutomatic()}
              disabled={locked}
            />
          ) : null}
          {error && !open ? <FormStatus error={error} /> : null}
        </SalarySectionCard>
      </View>
      <NetPaySheet
        title="Weihnachtsgeld anpassen"
        visible={open}
        busy={locked}
        onClose={() => {
          if (!locked) setOpen(false);
        }}
        footer={
          <NetPayWorkflowAction onPress={() => void save()} disabled={locked} busy={saving}>
            Änderungen speichern
          </NetPayWorkflowAction>
        }
      >
        <Field
          label="Weihnachtsgeld brutto (€)"
          value={gross}
          onChangeText={setGross}
          keyboardType="decimal-pad"
          editable={!locked}
        />
        <NetPayWorkflowText>
          {formatMonthTitle(payout)} · 0 € bedeutet keine Zahlung.
        </NetPayWorkflowText>
        <NetPayWorkflowLink
          onPress={() => setDetails(!details)}
          expanded={details}
          disabled={locked}
        >
          Weitere Angaben
        </NetPayWorkflowLink>
        {details ? (
          <View style={{ gap: SPACING.md }}>
            <NetPayWorkflowSelect
              label="Auszahlungsmonat"
              value={payout}
              disabled={locked}
              options={Array.from({ length: 12 }, (_, i) => {
                const value = `${year}-${String(i + 1).padStart(2, "0")}`;
                return { value, label: formatMonthTitle(value) };
              })}
              onChange={setPayout}
            />
            {proposal ? (
              <NetPayWorkflowText>
                {decimalFormValue(proposal.rateBasisPoints)} % aus{" "}
                {proposal.referenceMonths.map(formatMonthTitle).join(", ")} · voller Jahresanspruch.
              </NetPayWorkflowText>
            ) : null}
            <NetPayWorkflowText>
              Netto wird mit gleichbleibendem laufendem Entgelt und durchgehender Sozialversicherung
              seit Januar geschätzt. Bei Abweichungen kannst du Jahreswerte verwenden.
            </NetPayWorkflowText>
            <NetPayCheck
              label="Jahreswerte aus Abrechnung verwenden"
              checked={payroll}
              disabled={locked}
              onChange={setPayroll}
            />
            {payroll ? (
              <>
                <NetPayWorkflowText>
                  Jahressteuerbrutto einschließlich früherer Sonderzahlungen, ohne diese Zahlung.
                  SV-Grundlagen bis einschließlich Auszahlungsmonat, ohne diese Zahlung.
                </NetPayWorkflowText>
                {(
                  [
                    ["annualTaxableGross", "Voraussichtliches Jahressteuerbrutto (€)"],
                    ["healthAssessed", "Bereits verbeitragt KV/PV (€)"],
                    ["pensionAssessed", "Bereits verbeitragt RV/AV (€)"],
                    ["socialInsuranceDays", "SV-Tage bis zum Auszahlungsmonat"],
                  ] as const
                ).map(([key, label]) => (
                  <Field
                    key={key}
                    label={label}
                    value={yearValues[key]}
                    keyboardType={key === "socialInsuranceDays" ? "number-pad" : "decimal-pad"}
                    editable={!locked}
                    onChangeText={(value) => setYearValues((prior) => ({ ...prior, [key]: value }))}
                  />
                ))}
              </>
            ) : (
              <NetPayCheck
                label="Netto mitschätzen"
                checked={forecast}
                disabled={locked}
                onChange={setForecast}
              />
            )}
            <NetPayWorkflowText>
              Zusatzversorgung der Sonderzahlung ist noch nicht enthalten. Anspruch und Kürzungen
              kannst du über den Bruttobetrag anpassen.
            </NetPayWorkflowText>
          </View>
        ) : null}
        <FormStatus error={error} />
      </NetPaySheet>
    </>
  );
}
