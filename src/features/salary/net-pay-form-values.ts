import { Temporal } from "@js-temporal/polyfill";
import type { NetPayAmounts, NetPaySpecialCase } from "@/domain/net-pay";
import {
  validateMonthlyNetPaySettings,
  type MonthlyNetPaySettings,
} from "@/domain/net-pay-profile";

export const NET_PAY_SPECIAL_CASE_OPTIONS: readonly { value: NetPaySpecialCase; label: string }[] =
  [
    { value: "PRIVATE_INSURANCE", label: "Private Krankenversicherung" },
    { value: "MINIJOB", label: "Minijob" },
    { value: "MIDIJOB", label: "Midijob" },
    { value: "MULTIPLE_EMPLOYMENTS", label: "Mehrere Beschäftigungen" },
    { value: "ONE_OFF_PAYMENT", label: "Einmalzahlung, z. B. Weihnachtsgeld" },
    { value: "ADDITIONAL_DEDUCTIONS", label: "Zusatzversorgung oder weitere Abzüge" },
    { value: "PARTIAL_MONTH", label: "Unvollständiger Abrechnungsmonat" },
    { value: "PENSIONER", label: "Renten- oder Versorgungsbezug" },
    { value: "APPRENTICE", label: "Ausbildung" },
    { value: "OTHER_INSURANCE_STATUS", label: "Andere Versicherung oder Beitragsbefreiung" },
  ];

export interface NetPayFormValues {
  birthDate: string;
  taxClass: number | null;
  factorMode: "NONE" | "FACTOR" | null;
  factor: string;
  churchTaxRate: number | null;
  childAllowance: string;
  isParent: boolean | null;
  childrenUnder25: string;
  worksInSaxony: boolean | null;
  healthAdditionalRate: string;
  monthlyTaxAllowance: string;
  specialCases: readonly NetPaySpecialCase[] | null;
  sfnBasicHourlyPay: string;
}

export function decimalFormValue(value: number, scale = 100): string {
  return String(value / scale).replace(".", ",");
}

/** Parses exact decimal input; never rounds a user-entered fraction. */
export function parseNetPayDecimal(value: string, scale: number, label: string): number {
  const text = value.trim();
  const places = Math.log10(scale);
  const match = /^(\d+)(?:[,.](\d+))?$/.exec(text);
  if (!match || !Number.isInteger(places) || (match[2]?.length ?? 0) > places)
    throw new Error(`Bitte ${label} vollständig und ohne Tausendertrennzeichen angeben.`);
  const amount = Number(match[1]) * scale + Number((match[2] ?? "").padEnd(places, "0"));
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 10_000_000)
    throw new Error(`Bitte einen gültigen Wert für ${label} angeben.`);
  return amount;
}

export function netPayFormValues(settings: MonthlyNetPaySettings | null): NetPayFormValues {
  const p = settings?.profile;
  return {
    birthDate: p
      ? `${p.birthDate.slice(8)}.${p.birthDate.slice(5, 7)}.${p.birthDate.slice(0, 4)}`
      : "",
    taxClass: p?.taxClass ?? null,
    factorMode: p ? (p.factorPermille === null ? "NONE" : "FACTOR") : null,
    factor: p?.factorPermille ? decimalFormValue(p.factorPermille, 1000) : "",
    churchTaxRate: p?.churchTaxRatePercent ?? null,
    childAllowance: p ? decimalFormValue(p.childAllowanceHalfUnits * 50) : "",
    isParent: p?.isParent ?? null,
    childrenUnder25: p ? String(p.childrenUnder25) : "",
    worksInSaxony: p?.worksInSaxony ?? null,
    healthAdditionalRate: p ? decimalFormValue(p.healthAdditionalRateBps) : "",
    monthlyTaxAllowance: p ? decimalFormValue(p.monthlyTaxAllowanceCents) : "",
    specialCases: settings?.specialCases ?? null,
    sfnBasicHourlyPay:
      settings?.sfnBasicHourlyPayCents == null
        ? ""
        : decimalFormValue(settings.sfnBasicHourlyPayCents),
  };
}

export function monthlyNetPaySettingsFromForm(
  month: string,
  form: NetPayFormValues,
  _previous: MonthlyNetPaySettings | null,
) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(form.birthDate.trim());
  if (!match) throw new Error("Bitte das Geburtsdatum als TT.MM.JJJJ angeben.");
  const birthDate = `${match[3]}-${match[2]}-${match[1]}`;
  try {
    Temporal.PlainDate.from(birthDate, { overflow: "reject" });
  } catch {
    throw new Error("Bitte ein gültiges Geburtsdatum angeben.");
  }
  if (Temporal.PlainDate.from(birthDate).year < 1900)
    throw new Error("Geburtsdatum: Bitte ein Datum ab dem Jahr 1900 angeben.");
  if (Temporal.PlainDate.compare(birthDate, `${month}-01`) > 0)
    throw new Error("Das Geburtsdatum liegt nach dem Beginn des gewählten Abrechnungsmonats.");
  if (form.taxClass === null) throw new Error("Bitte die Steuerklasse auswählen.");
  if (form.churchTaxRate === null) throw new Error("Bitte die Kirchensteuer auswählen.");
  if (form.isParent === null)
    throw new Error("Bitte die Elterneigenschaft für die Pflegeversicherung auswählen.");
  if (form.worksInSaxony === null)
    throw new Error("Bitte auswählen, ob du in Sachsen beschäftigt bist.");
  if (form.specialCases === null)
    throw new Error(
      "Bitte den regulären Abrechnungsfall oder einen passenden Sonderfall auswählen.",
    );
  if (form.taxClass === 4 && form.factorMode === null)
    throw new Error("Bitte für Steuerklasse IV das Faktorverfahren auswählen.");
  const allowance = parseNetPayDecimal(form.childAllowance, 100, "den Kinderfreibetrag");
  if (allowance % 50 !== 0)
    throw new Error("Der Kinderfreibetrag muss in Schritten von 0,5 angegeben werden.");
  if (allowance > 1000) throw new Error("Kinderfreibetrag: Bitte einen Wert von 0 bis 10 angeben.");
  if (form.taxClass >= 5 && allowance !== 0)
    throw new Error("Kinderfreibetrag: Bei Steuerklasse V und VI bitte 0 eintragen.");
  const factorPermille =
    form.taxClass === 4 && form.factorMode === "FACTOR"
      ? parseNetPayDecimal(form.factor, 1000, "den Faktor")
      : null;
  if (factorPermille !== null && (factorPermille < 1 || factorPermille > 999))
    throw new Error("ELStAM-Faktor: Bitte einen Wert von 0,001 bis 0,999 angeben.");
  const childrenUnder25 = parseNetPayDecimal(form.childrenUnder25, 1, "die Kinderzahl");
  if (childrenUnder25 > 20)
    throw new Error("Kinder unter 25: Bitte eine ganze Zahl von 0 bis 20 angeben.");
  if (!form.isParent && childrenUnder25 !== 0)
    throw new Error(
      "Kinder unter 25: Bei Elterneigenschaft „Nein“ bitte 0 eintragen oder die Elterneigenschaft prüfen.",
    );
  const healthAdditionalRateBps = parseNetPayDecimal(
    form.healthAdditionalRate,
    100,
    "den vollen GKV-Zusatzbeitrag",
  );
  if (healthAdditionalRateBps > 10_000)
    throw new Error(
      "Voller GKV-Zusatzbeitrag: Bitte den Beitrag als Prozentwert von 0 bis 100 angeben.",
    );
  const sfnBasicHourlyPayCents = form.sfnBasicHourlyPay.trim()
    ? parseNetPayDecimal(form.sfnBasicHourlyPay, 100, "den SFN-Grundlohn")
    : null;
  if (sfnBasicHourlyPayCents === 0)
    throw new Error(
      "SFN-Grundlohn: Bitte einen Betrag über 0 angeben oder das optionale Feld leeren.",
    );
  return validateMonthlyNetPaySettings({
    version: 1,
    month,
    profile: {
      birthDate,
      taxClass: form.taxClass,
      factorPermille,
      churchTaxRatePercent: form.churchTaxRate,
      childAllowanceHalfUnits: allowance / 50,
      isParent: form.isParent,
      childrenUnder25,
      worksInSaxony: form.worksInSaxony,
      healthAdditionalRateBps,
      monthlyTaxAllowanceCents: parseNetPayDecimal(
        form.monthlyTaxAllowance,
        100,
        "den monatlichen Freibetrag",
      ),
    },
    specialCases: form.specialCases,
    sfnBasicHourlyPayCents,
  });
}

export interface NetPayAmountForm {
  gross: string;
  taxable: string;
  socialInsurance: string;
  regularSocialInsurance: string;
}

export function netPayAmountsFromForm(form: NetPayAmountForm): NetPayAmounts {
  return {
    grossCents: parseNetPayDecimal(form.gross, 100, "das Gesamtbrutto"),
    taxableGrossCents: parseNetPayDecimal(form.taxable, 100, "das Steuerbrutto"),
    socialInsuranceGrossCents: parseNetPayDecimal(form.socialInsurance, 100, "das SV-Brutto"),
    regularMonthlySocialInsuranceGrossCents: parseNetPayDecimal(
      form.regularSocialInsurance,
      100,
      "das regelmäßige SV-Einkommen",
    ),
  };
}
