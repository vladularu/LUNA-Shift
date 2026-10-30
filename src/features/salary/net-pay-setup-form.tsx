import { useRef, useState, type PropsWithChildren, type ReactNode } from "react";
import { Keyboard, View } from "react-native";
import { Text } from "@/ui/text";
import type { MonthlyNetPaySettings } from "@/domain/net-pay-profile";
import type { NetPayPensionScheme } from "@/domain/net-pay-automation";
import { NET_PAY_PENSION_OPTIONS, netPayPensionMaxOwnRate } from "@/domain/net-pay-pension-schemes";
import { SPACING } from "@/theme/tokens";
import { usePalette } from "@/theme/palette";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { FormSection, FormStatus } from "@/ui/form-layout";
import { useProfileLeaveGuard } from "@/features/settings/use-profile-leave-guard";
import { NetPayValidity } from "./net-pay-validity";
import { NetPayCheck } from "./net-pay-controls";
import {
  NetPayWorkflowAction,
  NetPayWorkflowChoice as NetPayChoice,
  NetPayWorkflowField as Field,
  NetPayWorkflowLink,
  NetPayWorkflowSelect,
  NetPayWorkflowText as NetPayText,
} from "./net-pay-workflow-controls";
import {
  decimalFormValue,
  NET_PAY_SPECIAL_CASE_OPTIONS,
  type NetPayFormValues,
} from "./net-pay-form-values";
import {
  NET_PAY_HEALTH_FORECAST_RATE,
  netPaySetupSettings,
  netPaySetupValues,
} from "./net-pay-setup-values";

const YES_NO = [
  { value: true, label: "Ja" },
  { value: false, label: "Nein" },
] as const;
const EMPLOYMENT_CASES = new Set([
  "MINIJOB",
  "MIDIJOB",
  "MULTIPLE_EMPLOYMENTS",
  "PARTIAL_MONTH",
  "PENSIONER",
  "APPRENTICE",
]);

export function NetPaySetupForm({
  month,
  initial,
  worksInSaxony,
  churchTaxDefaultPercent,
  busy,
  onSave,
  firstSetup = initial === null,
  onSaved,
  onValidationFailure,
  renderLayout,
}: {
  readonly month: string;
  readonly initial: MonthlyNetPaySettings | null;
  readonly worksInSaxony: boolean;
  readonly churchTaxDefaultPercent: 8 | 9;
  readonly busy: boolean;
  readonly onSave: (settings: MonthlyNetPaySettings, effectiveMonth?: string) => Promise<void>;
  readonly firstSetup?: boolean;
  readonly onSaved?: () => void;
  readonly onValidationFailure?: () => void;
  readonly renderLayout?: (layout: {
    readonly content: ReactNode;
    readonly footer: ReactNode;
    readonly locked: boolean;
  }) => ReactNode;
}) {
  const [form, setForm] = useState(() => netPaySetupValues(initial, worksInSaxony));
  const [effectiveMonth, setEffectiveMonth] = useState(month);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [churchRate, setChurchRate] = useState<8 | 9>(
    initial?.profile.churchTaxRatePercent || churchTaxDefaultPercent,
  );
  const [customHealth, setCustomHealth] = useState(
    !!initial && initial.profile.healthAdditionalRateBps !== 290,
  );
  const [pensionScheme, setPensionScheme] = useState<NetPayPensionScheme | null>(
    initial?.automation?.pensionScheme ?? null,
  );
  const [pensionEmployeeRate, setPensionEmployeeRate] = useState(
    initial?.automation?.pensionEmployeeRateBps == null
      ? ""
      : decimalFormValue(initial.automation.pensionEmployeeRateBps),
  );
  const needsOwnPensionRate =
    pensionScheme !== null && netPayPensionMaxOwnRate(pensionScheme) !== null;
  const [additionalGross, setAdditionalGross] = useState(
    decimalFormValue(initial?.automation?.additionalRecurringGrossCents ?? 0),
  );
  const [additionalNet, setAdditionalNet] = useState(
    decimalFormValue(initial?.automation?.additionalNetDeductionCents ?? 0),
  );
  const locked = busy || saving;
  const employmentCases = (form.specialCases ?? []).filter((value) => EMPLOYMENT_CASES.has(value));
  const [familyHelp, setFamilyHelp] = useState(false);
  const [insuranceHelp, setInsuranceHelp] = useState(false);
  const submitting = useRef(false);
  const draft = JSON.stringify({
    form,
    effectiveMonth,
    pensionScheme,
    pensionEmployeeRate,
    additionalGross,
    additionalNet,
  });
  const [baseline] = useState(draft);
  const leave = useProfileLeaveGuard(draft !== baseline, locked);
  const specialInsurance =
    form.specialCases?.includes("PRIVATE_INSURANCE") ||
    form.specialCases?.includes("OTHER_INSURANCE_STATUS");
  function change<K extends keyof NetPayFormValues>(key: K, value: NetPayFormValues[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setError(null);
  }
  async function save() {
    if (locked || submitting.current) return;
    setError(null);
    try {
      const value = netPaySetupSettings(
        month,
        { ...form, worksInSaxony },
        pensionScheme,
        additionalGross,
        additionalNet,
        initial,
        pensionEmployeeRate,
      );
      Keyboard.dismiss();
      submitting.current = true;
      setSaving(true);
      if (effectiveMonth === month) await onSave(value);
      else await onSave(value, effectiveMonth);
      leave.saved(onSaved);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Die Angaben konnten nicht gesichert werden.",
      );
      onValidationFailure?.();
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }
  const content = (
    <View style={{ gap: SPACING.xl }}>
      <FormSection>
        <NetPayValidity
          month={month}
          firstSetup={firstSetup}
          value={effectiveMonth}
          onChange={setEffectiveMonth}
          disabled={locked}
        />
        {initial?.version === 1 ? (
          <NetPayText>
            Deine bisherigen Angaben gelten nur für diesen Monat. Nach dem Speichern werden sie auch
            für folgende Monate übernommen.
          </NetPayText>
        ) : null}
      </FormSection>
      <FormStatus error={error} />
      <NetPaySettingsSection title="Steuern">
        <View style={{ gap: SPACING.lg }}>
          <NetPayChoice
            label="Steuerklasse"
            value={form.taxClass}
            disabled={locked}
            options={[1, 2, 3, 4, 5, 6].map((value) => ({ value, label: String(value) }))}
            onChange={(value) => {
              setForm((current) => ({
                ...current,
                taxClass: value,
                factorMode: current.taxClass === value ? current.factorMode : "NONE",
                factor: current.taxClass === value ? current.factor : "",
                childAllowance: value >= 5 ? "0" : current.childAllowance,
              }));
              setError(null);
            }}
          />
          <NetPayChoice
            label="Zahlst du Kirchensteuer?"
            value={form.churchTaxRate === null ? null : form.churchTaxRate !== 0}
            disabled={locked}
            options={YES_NO}
            onChange={(yes) => change("churchTaxRate", yes ? churchRate : 0)}
          />
          {form.churchTaxRate ? (
            <>
              <NetPayChoice
                label="Dein Wohnort"
                value={churchRate === 8}
                disabled={locked}
                options={[
                  { value: true, label: "Bayern / Baden-Württemberg" },
                  { value: false, label: "Anderes Bundesland" },
                ]}
                onChange={(eight) => {
                  setChurchRate(eight ? 8 : 9);
                  change("churchTaxRate", eight ? 8 : 9);
                }}
              />
            </>
          ) : null}
          {form.taxClass !== null && form.taxClass <= 4 ? (
            <>
              <Field
                label="Kinderfreibetrag laut Gehaltsabrechnung"
                value={form.childAllowance}
                onChangeText={(value) => change("childAllowance", value)}
                editable={!locked}
                keyboardType="decimal-pad"
              />
              <NetPayText>
                Ohne eigene Angabe verwenden wir 0. Der Kinderfreibetrag beeinflusst Kirchensteuer
                und Solidaritätszuschlag und ist von deiner Kinderzahl getrennt.
              </NetPayText>
            </>
          ) : null}
          <Field
            label="Monatlicher Steuerfreibetrag (€)"
            value={form.monthlyTaxAllowance}
            onChangeText={(value) => change("monthlyTaxAllowance", value)}
            editable={!locked}
            keyboardType="decimal-pad"
          />
          {form.taxClass === 4 ? (
            <>
              <NetPayChoice
                label="Faktorverfahren"
                value={form.factorMode}
                disabled={locked}
                options={[
                  { value: "NONE", label: "Ohne Faktor" },
                  { value: "FACTOR", label: "Mit Faktor" },
                ]}
                onChange={(value) => change("factorMode", value)}
              />
              {form.factorMode === "FACTOR" ? (
                <Field
                  label="Faktor laut Gehaltsabrechnung"
                  value={form.factor}
                  onChangeText={(value) => change("factor", value)}
                  editable={!locked}
                  keyboardType="decimal-pad"
                />
              ) : null}
            </>
          ) : null}
        </View>
      </NetPaySettingsSection>
      <NetPaySettingsSection title="Familie">
        <View style={{ gap: SPACING.lg }}>
          <Field
            label="Geburtsdatum (TT.MM.JJJJ)"
            value={form.birthDate}
            editable={!locked}
            onChangeText={(value) => change("birthDate", value)}
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            placeholder="15.01.1990"
          />
          <NetPayChoice
            label="Hast du Kinder?"
            value={form.isParent}
            disabled={locked}
            options={YES_NO}
            onChange={(yes) => {
              setForm((current) => ({
                ...current,
                isParent: yes,
                childrenUnder25: yes ? current.childrenUnder25 : "0",
              }));
              setError(null);
            }}
          />
          {form.isParent ? (
            <NetPayChoice
              label="Wie viele Kinder sind unter 25?"
              value={Math.min(5, Number(form.childrenUnder25))}
              disabled={locked}
              options={[0, 1, 2, 3, 4, 5].map((value) => ({
                value,
                label: value === 5 ? "5+" : String(value),
              }))}
              onChange={(value) => change("childrenUnder25", String(value))}
            />
          ) : null}
          <NetPayWorkflowLink
            onPress={() => setFamilyHelp(!familyHelp)}
            disabled={locked}
            expanded={familyHelp}
          >
            Warum diese Angaben?
          </NetPayWorkflowLink>
          {familyHelp ? (
            <NetPayText>
              Auch erwachsene Kinder zählen. Das beeinflusst deinen Beitrag zur Pflegeversicherung.
              Der steuerliche Kinderfreibetrag ist eine separate Angabe.
            </NetPayText>
          ) : null}
        </View>
      </NetPaySettingsSection>
      <NetPaySettingsSection title="Versicherung & Vorsorge">
        <View style={{ gap: SPACING.lg }}>
          <NetPayChoice
            label="Versicherungsart"
            value={
              form.specialCases?.includes("PRIVATE_INSURANCE")
                ? "PRIVATE_INSURANCE"
                : form.specialCases?.includes("OTHER_INSURANCE_STATUS")
                  ? "OTHER_INSURANCE_STATUS"
                  : "GKV"
            }
            disabled={locked}
            options={[
              { value: "GKV", label: "Gesetzlich" },
              { value: "PRIVATE_INSURANCE", label: "Privat" },
              { value: "OTHER_INSURANCE_STATUS", label: "Anderer Fall" },
            ]}
            onChange={(value) =>
              change("specialCases", [
                ...(form.specialCases ?? []).filter(
                  (v) => v !== "PRIVATE_INSURANCE" && v !== "OTHER_INSURANCE_STATUS",
                ),
                ...(value === "GKV" ? [] : [value]),
              ])
            }
          />
          {specialInsurance ? (
            <NetPayText>
              {form.specialCases?.includes("PRIVATE_INSURANCE")
                ? "Privat versichert · Standardprognose nicht verfügbar"
                : "Abweichender Versicherungsfall · Standardprognose nicht verfügbar"}
            </NetPayText>
          ) : (
            <>
              <NetPayChoice
                label="Beitrag für die Prognose"
                value={customHealth}
                disabled={locked}
                options={[
                  { value: false, label: "Durchschnitt verwenden" },
                  { value: true, label: "Eigener Zusatzbeitrag" },
                ]}
                onChange={(custom) => {
                  setCustomHealth(custom);
                  if (!custom) change("healthAdditionalRate", NET_PAY_HEALTH_FORECAST_RATE);
                  setError(null);
                }}
              />
              {customHealth ? (
                <Field
                  label="Zusatzbeitrag deiner Krankenkasse (%)"
                  value={form.healthAdditionalRate}
                  onChangeText={(value) => change("healthAdditionalRate", value)}
                  editable={!locked}
                  keyboardType="decimal-pad"
                />
              ) : null}
              {!customHealth ? (
                <NetPayText>Gesetzlich · Zusatzbeitrag {form.healthAdditionalRate} %</NetPayText>
              ) : null}
            </>
          )}
          <NetPayWorkflowSelect<NetPayPensionScheme>
            label="Zusatzversorgung"
            value={pensionScheme}
            disabled={locked}
            searchable
            options={NET_PAY_PENSION_OPTIONS}
            onChange={(value) => {
              setPensionScheme(value);
              setPensionEmployeeRate("");
              setError(null);
            }}
          />
          <NetPayText>Die Kasse steht auf deiner Gehaltsabrechnung.</NetPayText>
          {needsOwnPensionRate ? (
            <>
              <Field
                label="Dein EZVK-Eigenanteil laut Abrechnung (%)"
                value={pensionEmployeeRate}
                onChangeText={(value) => {
                  setPensionEmployeeRate(value);
                  setError(null);
                }}
                editable={!locked}
                keyboardType="decimal-pad"
                placeholder="Optional · z. B. 1,00"
              />
              <NetPayText>
                Kein eigener Abzug? Trage 0 ein. Unbekannt? Lass das Feld frei.
              </NetPayText>
            </>
          ) : null}
          {pensionScheme === "UNKNOWN" ||
          pensionScheme === "OTHER" ||
          (needsOwnPensionRate && pensionEmployeeRate.trim() === "") ? (
            <NetPayText>
              Netto vor Zusatzversorgung · Beiträge und ihre Auswirkungen sind noch offen.
            </NetPayText>
          ) : null}
          <NetPayWorkflowLink
            onPress={() => setInsuranceHelp(!insuranceHelp)}
            disabled={locked}
            expanded={insuranceHelp}
          >
            {insuranceHelp ? "Erklärung schließen" : "So rechnen wir"}
          </NetPayWorkflowLink>
          {insuranceHelp ? (
            <NetPayText>
              Voller bezahlter Monat, gesetzliche Versicherungen, geplante Dienste mit mittiger
              Pause. Sonderzahlungen erfasst du getrennt in der Gehaltsübersicht. Deine
              Zusatzversorgung steht auf der Gehaltsabrechnung und hängt vom Arbeitgeber ab. Das
              Bundesland allein reicht zur Auswahl nicht aus.
            </NetPayText>
          ) : null}
        </View>
      </NetPaySettingsSection>
      <NetPaySettingsSection title="Weitere Angaben">
        <View style={{ gap: SPACING.lg }}>
          <NetPayWorkflowSelect
            label="Beschäftigungsfall"
            value={
              employmentCases.length > 1 ? "LEGACY_MULTIPLE" : (employmentCases[0] ?? "STANDARD")
            }
            disabled={locked}
            options={[
              { value: "STANDARD", label: "Reguläre Beschäftigung" },
              ...NET_PAY_SPECIAL_CASE_OPTIONS.filter((option) =>
                EMPLOYMENT_CASES.has(option.value),
              ),
              ...(employmentCases.length > 1
                ? [{ value: "LEGACY_MULTIPLE", label: "Mehrere gespeicherte Sonderfälle" }]
                : []),
            ]}
            onChange={(value) => {
              if (value === "LEGACY_MULTIPLE") return;
              change("specialCases", [
                ...(form.specialCases ?? []).filter((v) => !EMPLOYMENT_CASES.has(v)),
                ...(value === "STANDARD"
                  ? []
                  : [value as NonNullable<NetPayFormValues["specialCases"]>[number]]),
              ]);
            }}
          />
          {employmentCases.length ? (
            <NetPayText>
              Abweichende Beschäftigungsfälle benötigen eine eigene Berechnung. Ausbildung wird bei
              passender Gehaltsbasis unterstützt.
            </NetPayText>
          ) : null}
          {form.specialCases?.includes("ONE_OFF_PAYMENT") ? (
            <NetPayText>
              Deine frühere Einmalzahlungsmarkierung bleibt erhalten. Ergänze Betrag und Monat unter
              „Jahressonderzahlung“ in der Gehaltsübersicht.
            </NetPayText>
          ) : null}
          <Field
            label="Weitere feste monatliche Zulage (€)"
            value={additionalGross}
            onChangeText={(value) => {
              setAdditionalGross(value);
              setError(null);
            }}
            editable={!locked}
            keyboardType="decimal-pad"
          />
          <NetPayText>
            Nur laufende Zulagen ergänzen, die in der Gehaltsauswertung noch fehlen. Sonst 0 lassen.
          </NetPayText>
          <Field
            label="Weitere monatliche Netto-Abzüge (€)"
            value={additionalNet}
            onChangeText={(value) => {
              setAdditionalNet(value);
              setError(null);
            }}
            editable={!locked}
            keyboardType="decimal-pad"
          />
          <NetPayCheck
            label="Weitere steuer- oder SV-wirksame Abzüge, die hier noch fehlen"
            checked={form.specialCases?.includes("ADDITIONAL_DEDUCTIONS") ?? false}
            disabled={locked}
            onChange={(checked) =>
              change("specialCases", [
                ...(form.specialCases ?? []).filter((v) => v !== "ADDITIONAL_DEDUCTIONS"),
                ...(checked ? ["ADDITIONAL_DEDUCTIONS" as const] : []),
              ])
            }
          />
          <NetPayText>
            Zusatzversorgung oben auswählen. Reine Abzüge vom ausgezahlten Netto gehören ins
            Euro-Feld.
          </NetPayText>
        </View>
      </NetPaySettingsSection>
    </View>
  );
  const footer = (
    <NetPayWorkflowAction onPress={() => void save()} disabled={locked} busy={locked}>
      Änderungen speichern
    </NetPayWorkflowAction>
  );
  return renderLayout ? (
    renderLayout({ content, footer, locked })
  ) : (
    <View style={{ gap: SPACING.lg }}>
      {content}
      {footer}
    </View>
  );
}

function NetPaySettingsSection({ children, title }: PropsWithChildren<{ readonly title: string }>) {
  const palette = usePalette();
  return (
    <View style={{ gap: SPACING.sm }}>
      <Text
        accessibilityRole="header"
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        style={{ color: palette.text, ...TYPOGRAPHY.sectionTitle }}
      >
        {title}
      </Text>
      <FormSection>{children}</FormSection>
    </View>
  );
}
