import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SALARY_PAYMENT_PREFERENCES, setSalaryPaymentLag } from "@/domain/salary-payment";
import { EMPTY_ABSENCE_PAY } from "@/domain/absence-pay";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import type { ShiftEntry, UserProfile } from "@/domain/types";
import { calculateAutomaticPaymentNetPayForecast } from "@/engine/net-pay-payment-forecast";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS } from "@/engine/simple-pay";
import { getTvUkDutyHourlyCents } from "@/engine/simple-tvuk-nursing-pay";
import { RuleResolutionError, bundledRuleResolver as resolver } from "@/rules/rule-resolver";
import { salaryMonthInput } from "./salary-month-input";
import { salaryPaymentInput } from "./salary-payment-input";
import { buildReportSteps } from "@/features/report-export/report-data";
import { newSpecialDuty } from "@/domain/special-duty";
import { withTariffAbsencePay } from "@/engine/vka-absence-pay";
import type { WorkingTimeTargetProfile } from "@/domain/working-time-target";

vi.mock("@/features/analysis/rule-computation", () => ({
  captureRuleComputation: (compute: () => unknown) => {
    try {
      return { ok: true, value: compute() };
    } catch (error) {
      if (!(error instanceof RuleResolutionError)) throw error;
      return { ok: false, error, failure: error.failure };
    }
  },
}));
const base = { ...forecastProfile, tariff: null };
const land: UserProfile = {
  ...base,
  tvlKrTariff: { payGroup: "KR8", payLevel: 4, universityRegion: "WEST" },
};
const hessen: UserProfile = {
  ...base,
  federalState: "HE",
  tvhKrTariff: { payGroup: "KR8", payLevel: 4, fullTimeWeeklyMinutes: 2310 },
};
const klinik: UserProfile = {
  ...base,
  federalState: "BW",
  tvUkNursingTariff: { payGroup: "PUK8", payLevel: 4 },
};
const tva: UserProfile = {
  ...base,
  nursingTrainingTariff: { trainingYear: 2, sector: "BT_K", tariffRegion: "OTHER" },
};
const tval: UserProfile = {
  ...base,
  tvalPflegeTariff: { trainingYear: 2, universityRegion: "WEST" },
};
const context = (entries: ShiftEntry[]) => ({
  entries,
  resolver,
  tariffDecisions: [],
  workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
});
const leave = (date: string, type: "VACATION" | "SICK" = "VACATION", rate?: number) =>
  forecastShift({
    id: date,
    date,
    type,
    allDay: true,
    startTime: null,
    endTime: null,
    ...(rate == null
      ? {}
      : { absencePay: { ...EMPTY_ABSENCE_PAY, day: "PAID", dailyRateCents: rate } }),
  });
const nights = ["2026-07-12", "2026-08-09", "2026-09-13"].map((date) =>
  forecastShift({ date, id: date }),
);
const october = [12, 13, 14, 15, 16, 17, 18].map((d) => leave("2026-10-" + d));
const preferences = setSalaryPaymentLag(DEFAULT_SALARY_PAYMENT_PREFERENCES, "2026-09", 1);
describe("Tarifliche Fortzahlung bei Urlaub und Krankheit", () => {
  it("TV-L: fünf frühere Ausfalltage reduzieren 65 auf 60, der frühere Aufschlag bleibt draußen", () => {
    const prior = [3, 4, 5, 6, 7].map((d) => leave("2026-08-0" + d, "SICK", 1500));
    const entries = [...nights, ...prior, ...october];
    const ordinary = salaryMonthInput("2026-10", land, context([])).pay;
    const result = withTariffAbsencePay("2026-10", ordinary, land, entries, resolver, () => ({
      ...ordinary,
      timePremiumAmount: 200,
      absencePayAmount: 75,
    }));
    expect(result.absencePayDays?.map((d) => d.dailyRateCents)).toEqual([
      1000, 1000, 1000, 1000, 1000,
    ]);
    expect(result.absencePayAmount).toBe(50);
  });
  it.each([
    ["TV-L", land],
    ["TV-H", hessen],
    ["TV-UK", klinik],
  ] as const)(
    "%s bucht Urlaub und Krankheit aus dem Kalender einmal in den Folgemonat und ins Netto",
    (name, profile) => {
      const entries = [
        ...nights,
        ...october.slice(0, 5),
        leave("2026-10-19", "SICK"),
        ...["2026-11-02", "2026-12-02"].map((date) => forecastShift({ id: date, date })),
      ];
      const ctx = context(entries);
      const claim = salaryMonthInput("2026-10", profile, ctx).pay;
      expect(claim.absencePayNotes).toEqual([]);
      expect(claim.absencePayDays).toHaveLength(6);
      const sum = claim.absencePayDays!.reduce((total, d) => total + d.dailyRateCents, 0);
      expect(sum).toBeGreaterThan(0);
      for (const month of ["2026-10", "2026-11", "2026-12"]) {
        const projection = salaryPaymentInput(month, profile, ctx, preferences, "PAYOUT");
        const parts = projection.contributions.filter(
          (c) => c.group === "ABSENCE_PAY" && c.claimMonth === "2026-10",
        );
        expect(parts.reduce((s, p) => s + p.amountCents, 0)).toBe(month === "2026-11" ? sum : 0);
        const settings = automatedSettings("2026-01");
        const timeline = [
          {
            settings,
            revision: 1,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        ];
        const net = calculateAutomaticPaymentNetPayForecast(
          { month, profile, settings, projection, sourceSettings: timeline },
          resolver,
        );
        expect(net.result.status, JSON.stringify(net.result)).toBe("available");
        if (net.result.status === "available")
          expect(net.result.pay.amounts.grossCents).toBe(
            Math.round(projection.pay.estimatedGrossAmount! * 100),
          );
      }
      if (name === "TV-UK") {
        const hourly = getTvUkDutyHourlyCents("2026-10-12", profile, resolver)!;
        const july = salaryMonthInput("2026-07", profile, ctx).pay;
        expect(Math.round(july.shiftBreakdowns[0].premiumLines[0].hourlyRate * 100)).not.toBe(
          hourly,
        );
        const adjusted = nights
          .flatMap((n) =>
            salaryMonthInput(n.date.slice(0, 7), profile, ctx).pay.shiftBreakdowns.flatMap(
              (b) => b.premiumLines,
            ),
          )
          .reduce((s, l) => s + Math.round((hourly * l.minutes * l.percentage) / 6000), 0);
        expect(claim.absencePayDays?.[0].dailyRateCents).toBe(Math.round(adjusted / 65));
      }
      expect(
        salaryMonthInput("2026-10", profile, context([...nights.slice(0, 2), october[0]])).pay
          .absencePayNotes?.[0],
      ).toContain("September 2026");
    },
  );
  it.each([
    [land, "2026-05", ["2026-02", "2026-03", "2026-04"], 254],
    [hessen, "2026-08", ["2026-05", "2026-06", "2026-07"], 273],
  ] as const)("passt nur Bezüge vor der Tarifgrenze an", (profile, month, months, bps) => {
    const prior = months.map((m) => forecastShift({ date: m + "-09", id: m }));
    const entry = leave(month + "-12", "SICK");
    const blank = salaryMonthInput(month, profile, context([])).pay;
    const pay = withTariffAbsencePay(month, blank, profile, [...prior, entry], resolver, () => ({
      ...blank,
      timePremiumAmount: 100,
    }));
    expect(pay.absencePayDays?.[0].dailyRateCents).toBe(Math.round((30000 + 2 * bps) / 65));
  });
  it.each([tva, tval])(
    "führt bei Ausbildung Urlaub und Krankheit mit dem Monatsentgelt, ohne doppelte Buchung",
    (profile) => {
      const ctx = context([
        ...nights,
        ...october,
        leave("2026-10-19", "SICK"),
        forecastShift({ type: "TRAINING", date: "2026-10-22" }),
      ]);
      const pay = salaryMonthInput("2026-10", profile, ctx).pay;
      const original = salaryMonthInput("2026-10", profile, context([])).pay;
      expect(pay.available).toBe(true);
      expect(pay.personalBaseAmount).toBeGreaterThan(0);
      expect(pay.estimatedGrossAmount).toBe(original.estimatedGrossAmount);
      expect(pay.absencePayAmount).toBeUndefined();
      expect(
        salaryPaymentInput("2026-11", profile, ctx, preferences, "PAYOUT").contributions.filter(
          (c) => c.group === "ABSENCE_PAY",
        ),
      ).toEqual([]);
    },
  );
  it.each([
    [hessen, 67500],
    [klinik, 60000],
  ] as const)(
    "behandelt frühere Tagesaufschläge je nach Tarif, ohne den Teiler zu ändern",
    (profile, numerator) => {
      const history = leave("2026-08-12", "SICK", 7500);
      const blank = salaryMonthInput("2026-10", profile, context([])).pay;
      const pay = withTariffAbsencePay(
        "2026-10",
        blank,
        profile,
        [...nights, history, october[0]],
        resolver,
        (claim) => ({
          ...blank,
          timePremiumAmount: 200,
          absencePayAmount: claim === "2026-08" ? 75 : 0,
        }),
      );
      expect(pay.absencePayDays?.[0].dailyRateCents).toBe(Math.round(numerator / 65));
    },
  );
  it("berücksichtigt den bezahlten Einsatz während der Rufbereitschaft im TV-L", () => {
    const onCall = forecastShift({
      id: "ruf",
      date: "2026-07-07",
      type: "CUSTOM",
      startTime: "06:00",
      endTime: "20:00",
      breakMinutes: 0,
      specialDuty: {
        ...newSpecialDuty("ON_CALL", "06:00", "20:00", "Europe/Berlin"),
        settlement: "PAY",
        calloutsComplete: true,
        callouts: [
          { kind: "REMOTE", start: 600, end: 660, departure: 600, returned: 660, breakMinutes: 0 },
        ],
      },
    });
    const ctx = context([...nights, onCall, october[0]]);
    const months = ["07", "08", "09"].map((m) => salaryMonthInput("2026-" + m, land, ctx).pay);
    expect(months[0].specialDutyBreakdowns?.[0].calloutPay?.baseAmountCents).toBeGreaterThan(0);
    const cents = months.reduce(
      (sum, m) =>
        sum +
        Math.round(100 * (m.timePremiumAmount + (m.specialDutyAmount ?? 0) + m.allowanceAmount)),
      0,
    );
    expect(salaryMonthInput("2026-10", land, ctx).pay.absencePayDays?.[0].dailyRateCents).toBe(
      Math.round(cents / 65),
    );
  });
  it.each([land, hessen, klinik, tva, tval])(
    "klärt bei Krankheit ab dem 43. Tag die Fortzahlung statt volles Monatsentgelt auszuweisen",
    (profile) => {
      const day = {
        ...leave("2026-10-13", "SICK"),
        absencePay: { ...EMPTY_ABSENCE_PAY, eventStart: "2026-09-01" },
      };
      const pay = salaryMonthInput("2026-10", profile, context([...nights, day])).pay;
      expect(pay.available).toBe(false);
      expect(pay.estimatedGrossAmount).toBeNull();
      expect(pay.knownGrossAmount).toBeUndefined();
      expect(pay.absencePayNotes?.[0]).toContain("sechs Wochen");
    },
  );
  it("verwendet die Dreitagewoche aus dem Arbeitsprofil für Teiler und Anspruchstage", () => {
    const profile: UserProfile & WorkingTimeTargetProfile = {
      ...land,
      weeklyMinutes: 1386,
      workingTimeTarget: {
        status: "ready",
        notices: [],
        context: {
          days: [],
          periods: [
            {
              validFrom: "2025-01-01",
              validTo: null,
              weeklyMinutes: 1386,
              federalState: "NW",
              holidayRegion: "NONE",
              tariff: { kind: "TVL_KR", version: "1", scopeConfirmed: true },
              model: { kind: "FIXED_WEEK", weekdayMinutes: [462, 0, 462, 0, 462, 0, 0] },
            },
          ],
        },
      },
    };
    const blank = salaryMonthInput("2026-10", profile, context([])).pay;
    const pay = withTariffAbsencePay(
      "2026-10",
      blank,
      profile,
      [...nights, ...october],
      resolver,
      () => ({ ...blank, timePremiumAmount: 130 }),
    );
    expect(pay.absencePayDays?.map((d) => [d.date, d.dailyRateCents])).toEqual([
      ["2026-10-12", 1000],
      ["2026-10-14", 1000],
      ["2026-10-16", 1000],
    ]);
  });
  it("exportiert dieselbe November-Auszahlung wie die Gehaltsansicht", () => {
    const ctx = context([...nights, ...october]);
    const expected = salaryPaymentInput("2026-11", land, ctx, preferences, "PAYOUT").pay
      .absencePayAmount;
    expect(expected).toBeGreaterThan(0);
    const steps = buildReportSteps({
      period: "2026-11",
      profile: land,
      ...ctx,
      ruleResolver: resolver,
      createdAt: "2026-11-28",
      referenceDate: "2026-11-28",
      youthProtection: false,
      testMonths: [],
      salaryPaymentPreferences: preferences,
    });
    let result = steps.next();
    while (!result.done) result = steps.next();
    expect(
      result.value.rows.find(
        (r) => r.field === "absencePayAmount" && r.section === "Gehaltsprognose",
      )?.value,
    ).toBe(String(expected).replace(".", ","));
  });
  it.each([
    ["2026-08-15", 21.67],
    ["2026-07-15", 43.33],
  ] as const)("rundet den Teiler nach Eintritt am %s auf Hundertstel", (from, divisor) => {
    const profile: UserProfile & WorkingTimeTargetProfile = {
      ...land,
      workingTimeTarget: {
        status: "ready",
        notices: [],
        context: { days: [], periods: [], employment: { from, to: null } },
      },
    };
    const day = { ...october[0], absencePay: { ...EMPTY_ABSENCE_PAY, referenceCents: 65000 } };
    const pay = salaryMonthInput("2026-10", profile, context([day])).pay;
    expect(pay.absencePayDays?.[0].dailyRateCents).toBe(Math.round(65000 / divisor));
  });
  it("verwendet beim TV-L nach Eintritt die tatsächlich geleisteten Arbeitstage und ihre Bezüge", () => {
    const started: UserProfile & WorkingTimeTargetProfile = {
      ...land,
      workingTimeTarget: {
        status: "ready",
        notices: [],
        context: { days: [], periods: [], employment: { from: "2026-10-05", to: null } },
      },
    };
    const night = forecastShift({ date: "2026-10-11" });
    const ctx = context([
      nights[0],
      night,
      october[0],
      forecastShift({ date: "2026-10-25", id: "later" }),
    ]);
    const historical = salaryMonthInput("2026-10", land, context([night])).pay;
    const pay = salaryMonthInput("2026-10", started, ctx).pay;
    expect(pay.absencePayAmount).toBe(historical.timePremiumAmount);
    expect(pay.absencePayAmount).toBeGreaterThan(0);
  });
});
