import { useMemo } from "react";
import {
  usePflegeShiftEntries,
  usePflegeShiftTariff,
  usePflegeShiftTestData,
} from "@/application/pflegeshift-provider";
import { useRuleCatalogRuntime } from "@/application/rule-catalog-runtime-provider";
import { absencePayTariffAt, validateAbsencePay, type AbsencePayFacts } from "@/domain/absence-pay";
import type { ShiftEntry, UserProfile } from "@/domain/types";
import { addSalaryPaymentMonths } from "@/domain/salary-payment";
import { formatMonthTitle } from "@/engine/calendar";
import { netPayEuro } from "@/features/salary/net-pay-format";
import { salaryMonthInput } from "@/features/salary/salary-month-input";
import { captureRuleComputation } from "@/features/analysis/rule-computation";

interface DayPreview {
  readonly value: string;
  readonly label?: string;
  readonly reason?: string;
  readonly detail?: string;
}

export function useAbsencePayPreview({
  profile,
  original,
  date,
  type,
  value,
}: {
  profile: UserProfile;
  original: ShiftEntry | null;
  date: string;
  type: "SICK" | "VACATION";
  value: AbsencePayFacts | null;
}): DayPreview {
  const { entries } = usePflegeShiftEntries();
  const { tariffDecisions, workPatternSettings } = usePflegeShiftTariff();
  const { testMonths } = usePflegeShiftTestData();
  const { resolver } = useRuleCatalogRuntime();
  return useMemo(() => {
    try {
      validateAbsencePay(value, type, date);
    } catch {
      return { value: "Eingabe prüfen" };
    }
    const month = date.slice(0, 7);
    if (testMonths.includes(month)) return { value: "Testmonat" };
    const draft: ShiftEntry = {
      kind: "SHIFT",
      id: original?.id ?? "draft-absence-" + date,
      templateId: null,
      title: type === "SICK" ? "Krank" : "Urlaub",
      color: "",
      symbol: "",
      note: null,
      revision: 0,
      createdAt: date,
      updatedAt: date,
      deletedAt: null,
      holidayPremiumMode: "WITH_TIME_OFF",
      ...original,
      type,
      date,
      absencePay: value,
      allDay: true,
      startTime: null,
      endTime: null,
      breakMinutes: 0,
      overtimeMinutes: 0,
      specialDuty: null,
    };
    const saved = original && entries.find((entry) => entry.id === original.id);
    const matchesSaved =
      saved?.kind === "SHIFT" &&
      saved.date === date &&
      saved.type === type &&
      (saved.absencePay ?? null) === value;
    const calendar = matchesSaved
      ? entries
      : saved
        ? entries.map((entry) => (entry === saved ? draft : entry))
        : [...entries, draft];
    const result = captureRuleComputation(
      () =>
        salaryMonthInput(month, profile, {
          entries: calendar,
          tariffDecisions,
          workPatternSettings,
          testMonths,
          resolver,
        }).pay,
    );
    if (!result.ok) return { value: "Offen", reason: result.failure.message };
    const pay = result.value;
    const day = pay.absencePayDays?.find((row) => row.date === date);
    const note = pay.absencePayNotes?.find((row) => row.startsWith(date));
    const reference = (day?.eventStart ?? value?.eventStart ?? date).slice(0, 7);
    const tariff = absencePayTariffAt(profile, date);
    if (tariff === "TVAOED" || tariff === "TVAL") {
      const label = "Ausbildungsentgelt";
      const source =
        tariff === "TVAL"
          ? type === "SICK"
            ? "§ 13 TVA-L Pflege"
            : "§ 9 TVA-L Pflege"
          : type === "SICK"
            ? "§ 12 TVAöD"
            : "§ 9 TVAöD-Pflege";
      if (note) return { label, value: "Offen", reason: note.slice(13) };
      if (value?.day === "UNPAID" || value?.day === "EXCUSED_UNPAID")
        return { label, value: "Unbezahlt" };
      if (!pay.available && pay.personalBaseAmount == null)
        return {
          label,
          value: "Offen",
          reason: "Die Ausbildungsvergütung für diesen Monat fehlt.",
        };
      return {
        label,
        value: "Im Monatsgehalt",
        detail:
          source +
          " · Die tarifliche Fortzahlung richtet sich nach dem monatlichen Ausbildungsentgelt.",
      };
    }
    const basis =
      tariff === "TVUK"
        ? type === "SICK"
          ? "§ 19 TV-UK"
          : "§§ 19, 24 TV-UK"
        : tariff === "TVL"
          ? "§ 21 TV-L"
          : tariff === "TVH"
            ? "§ 21 TV-H"
            : "§ 21 TVöD";
    const detail = day?.manual
      ? "Tagessatz laut Abrechnung."
      : basis +
        " · Regulärer Vergleichszeitraum von " +
        formatMonthTitle(addSalaryPaymentMonths(reference, -3)) +
        " bis " +
        formatMonthTitle(addSalaryPaymentMonths(reference, -1)) +
        ". Ohne festgelegte Arbeitstage schätzt LUNA mit Montag bis Freitag.";
    if (note) return { value: "Offen", reason: note.slice(13), detail };
    if (day)
      return {
        value: (day.manual ? "" : "ca. ") + netPayEuro(day.dailyRateCents),
        detail,
      };
    if (!pay.available && !pay.absencePayNotes?.length)
      return { value: "Offen", reason: "Für diesen Monat fehlen Berechnungsgrundlagen.", detail };
    return { value: "Kein Aufschlag", detail };
  }, [
    date,
    entries,
    original,
    profile,
    resolver,
    tariffDecisions,
    testMonths,
    type,
    value,
    workPatternSettings,
  ]);
}
