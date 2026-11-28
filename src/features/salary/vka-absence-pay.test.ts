import { describe, expect, it } from "vitest";
import { netFromKnownAbsencePay } from "./net-from-known-absence-pay";
import { automatedSettings } from "@/domain/net-pay-automation-test-fixtures";
import { calculateAutomaticPaymentNetPayForecast } from "@/engine/net-pay-payment-forecast";
import { EMPTY_ABSENCE_PAY } from "@/domain/absence-pay";
import { tariffAllowanceBasis } from "./salary-composition";
import { DEFAULT_SALARY_PAYMENT_PREFERENCES, setSalaryPaymentLag } from "@/domain/salary-payment";
import { forecastProfile, forecastShift } from "@/engine/net-pay-tvoed-forecast-test-fixtures";
import { DEFAULT_TVOED_WORK_PATTERN_SETTINGS } from "@/engine/simple-pay";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import { salaryPaymentInput } from "./salary-payment-input";
import { salaryMonthInput } from "./salary-month-input";
import { isSalaryPaymentProjection } from "@/features/analysis/persistent-salary-value";
import type { UserProfile } from "@/domain/types";

const context = {
  resolver: bundledRuleResolver,
  tariffDecisions: [],
  workPatternSettings: DEFAULT_TVOED_WORK_PATTERN_SETTINGS,
};
const e: UserProfile = {
  ...forecastProfile,
  tariff: null,
  vkaETariff: { payGroup: "E8", payLevel: 4, sector: "BT_K", tariffRegion: "OTHER" },
};
describe("§ 21 in Gehalt und Auszahlung", () => {
  it.each([
    forecastProfile,
    {
      ...forecastProfile,
      tariff: {
        ...forecastProfile.tariff!,
        tariffRegion: "KAV_BW" as const,
        fullTimeWeeklyMinutes: 2340,
      },
    },
    e,
  ])(
    "berechnet Oktober, November mit Sonderzahlung und Dezember trotz verschobener monatlicher Zulage",
    (profile) => {
      const settings = automatedSettings("2026-01");
      const configured = {
        ...settings,
        automation: {
          ...settings.automation!,
          annualPayments: [
            {
              payoutMonth: "2026-11",
              grossCents: 423692,
              revision: 1,
              netBasis: { kind: "CONSTANT_PAY" as const },
            },
          ],
        },
      };
      const timeline = [
        {
          settings: configured,
          revision: 1,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ];
      const months = ["07", "08", "09", "10", "11", "12"].map((m) => "2026-" + m);
      const shifts = months.map((m) => forecastShift({ id: m, date: m + "-04" }));
      const leave = [12, 13, 14, 15, 16].map((d) =>
        forecastShift({
          id: "vac" + d,
          date: "2026-10-" + d,
          type: "VACATION",
          allDay: true,
          startTime: null,
          endTime: null,
          absencePay: { ...EMPTY_ABSENCE_PAY, dailyRateCents: 1442 },
        }),
      );
      const source = {
        ...context,
        entries: [...shifts, ...leave],
        tariffDecisions: months.map((month) => ({
          month,
          allowanceStatus: "ALTERNATING_MONTHLY" as const,
          revision: 1,
          confirmedAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        })),
      };
      const pref = setSalaryPaymentLag(DEFAULT_SALARY_PAYMENT_PREFERENCES, "2026-09", 1);
      let paidCents = 0;
      for (const month of months.slice(-3)) {
        const projection = salaryPaymentInput(month, profile, source, pref, "PAYOUT");
        const cash = projection.contributions
          .filter((c) => c.group === "ABSENCE_PAY")
          .reduce((sum, c) => sum + c.amountCents, 0);
        expect(cash).toBe(month === "2026-11" ? 7210 : 0);
        paidCents += cash;
        const result = calculateAutomaticPaymentNetPayForecast(
          { month, profile, settings: configured, sourceSettings: timeline, projection },
          context.resolver,
        );
        expect(result.result.status).toBe("available");
        if (result.result.status !== "available") throw new Error(result.result.reason);
        if (profile.tariff?.tariffRegion === "OTHER") {
          expect(projection.pay.tvoedAllowanceAmount).toBe(25);
          expect(projection.pay.allowanceAmount).toBe(250);
          expect(projection.pay.careAllowanceAmount).toBe(141.82);
          expect(projection.pay.personalBaseAmount).toBe(4075.58);
          expect(tariffAllowanceBasis(profile, projection.pay, context.resolver)).toContain(
            "bei Vollzeit",
          );
        }
        if (profile.tariff?.tariffRegion === "KAV_BW") {
          expect(projection.pay.tvoedAllowanceAmount).toBe(34.55);
          expect(projection.pay.allowanceAmount).toBe(246.79);
          expect(projection.pay.careAllowanceAmount).toBe(140);
          expect(projection.pay.personalBaseAmount).toBe(4023.33);
        }
        const annual = month === "2026-11" ? 423692 : 0;
        expect(result.result.pay.amounts.grossCents).toBe(
          Math.round(projection.pay.estimatedGrossAmount! * 100) + annual,
        );
        expect(result.result.pay.netCents).toBeGreaterThan(0);
      }
      expect(paidCents).toBe(7210);
    },
  );
  it("zahlt bei einem Rhythmuswechsel alle fälligen U/K-Tage genau einmal aus", () => {
    const months = ["2026-09", "2026-10", "2026-11"];
    const entries = months.map((month, i) =>
      forecastShift({
        id: month,
        date: month + "-12",
        type: "SICK",
        allDay: true,
        startTime: null,
        endTime: null,
        absencePay: { ...EMPTY_ABSENCE_PAY, day: "PAID", dailyRateCents: 100 * (i + 1) },
      }),
    );
    const preferences = {
      ...DEFAULT_SALARY_PAYMENT_PREFERENCES,
      periods: months.map((month, i) => ({
        effectiveMonth: month,
        delays: {
          PREMIUMS: ([2, 1, 0] as const)[i],
          OVERTIME: 0,
          SPECIAL_DUTY: 0,
          MONTHLY_ALLOWANCE: 0,
          HOURLY_ALLOWANCE: 0,
        } as const,
      })),
    };
    const project = (month: string) =>
      salaryPaymentInput(month, forecastProfile, { ...context, entries }, preferences, "PAYOUT");
    const november = project(months[2]);
    expect(november.pay.absencePayAmount).toBe(6);
    expect(november.pay.absencePayDays?.map((day) => day.date)).toEqual(
      entries.map((entry) => entry.date),
    );
    expect(
      november.contributions
        .filter((part) => part.group === "ABSENCE_PAY")
        .map((part) => part.claimMonth),
    ).toEqual(months);
    expect(november.outgoingContributions?.filter((part) => part.group === "ABSENCE_PAY")).toEqual(
      [],
    );
    expect(project("2026-12").contributions.some((part) => part.group === "ABSENCE_PAY")).toBe(
      false,
    );
  });

  it.each([forecastProfile, e])(
    "schätzt fünf Oktober-Ausfalltage aus drei Kalendermonaten ohne Eingabe",
    (profile) => {
      const nights = ["2026-07-12", "2026-08-09", "2026-09-13"].map((date) =>
        forecastShift({ id: date, date }),
      );
      for (const type of ["VACATION", "SICK"] as const) {
        const days = Array.from({ length: 7 }, (_, index) => {
          const date = "2026-10-" + (12 + index);
          return forecastShift({
            id: date,
            date,
            type,
            allDay: true,
            startTime: null,
            endTime: null,
            breakMinutes: 0,
          });
        });
        const source = { ...context, entries: [...nights, ...days] };
        const cents = nights.reduce(
          (sum, shift) =>
            sum +
            Math.round(
              100 * salaryMonthInput(shift.date.slice(0, 7), profile, source).pay.timePremiumAmount,
            ),
          0,
        );
        const rate = Math.round(cents / 65);
        expect(rate).toBeGreaterThan(0);
        const pay = salaryMonthInput("2026-10", profile, source).pay;
        expect(pay.absencePayNotes).toEqual([]);
        expect(pay.absencePayDays?.map((d) => d.date)).toEqual(days.slice(0, 5).map((d) => d.date));
        expect(pay.absencePayDays?.every((d) => d.dailyRateCents === rate)).toBe(true);
        const cash = salaryPaymentInput(
          "2026-12",
          profile,
          source,
          DEFAULT_SALARY_PAYMENT_PREFERENCES,
          "PAYOUT",
        );
        expect(cash.contributions.find((c) => c.group === "ABSENCE_PAY")?.amountCents).toBe(
          rate * 5,
        );
        const missing = salaryMonthInput("2026-10", profile, {
          ...source,
          entries: [...nights.slice(0, 2), ...days],
        }).pay;
        expect(missing.absencePayNotes?.[0]).toContain("September 2026");
        expect(missing.absencePayDays).toEqual([]);
        const free = { ...days[0], absencePay: { ...EMPTY_ABSENCE_PAY, day: "FREE" as const } };
        expect(
          salaryMonthInput("2026-10", profile, {
            ...source,
            entries: [...nights, free, ...days.slice(1)],
          }).pay.absencePayDays,
        ).toHaveLength(4);
      }
    },
  );
  it.each([forecastProfile, e])(
    "zeigt Oktober und Dezember ohne offenen Anteil und erhält bestätigte Beträge",
    (profile) => {
      const settings = automatedSettings("2026-08");
      const timeline = [
        {
          settings,
          revision: 1,
          createdAt: "2026-08-01T00:00:00Z",
          updatedAt: "2026-08-01T00:00:00Z",
        },
      ];
      const prefs = {
        ...DEFAULT_SALARY_PAYMENT_PREFERENCES,
        socialInsuranceAttribution: "CASH_VARIABLE" as const,
      };
      const holiday = forecastShift({
        id: "urlaub",
        date: "2026-10-13",
        type: "VACATION",
        allDay: true,
        startTime: null,
        endTime: null,
        breakMinutes: 0,
      });
      const night = forecastShift({ id: "nacht", date: "2026-10-12" });
      const paid = forecastShift({
        ...holiday,
        id: "confirmed",
        date: "2026-10-22",
        absencePay: { ...EMPTY_ABSENCE_PAY, day: "PAID", dailyRateCents: 1500 },
      });
      const basis = {
        profile,
        resolver: bundledRuleResolver,
        attribution: prefs.socialInsuranceAttribution,
      };
      for (const month of ["2026-10", "2026-12"]) {
        const project = (absence: typeof holiday) =>
          salaryPaymentInput(
            month,
            profile,
            { ...context, entries: [night, absence, paid] },
            prefs,
            "PAYOUT",
          );
        const calc = (projection: ReturnType<typeof project>) =>
          calculateAutomaticPaymentNetPayForecast(
            {
              profile,
              month,
              projection,
              settings,
              sourceSettings: timeline,
              socialInsuranceAttribution: basis.attribution,
            },
            basis.resolver,
          );
        const pending = project(holiday),
          base = calc(pending);
        expect(base.result.status).toBe("unavailable");
        const actual = netFromKnownAbsencePay(base, pending, basis, settings, timeline, []);
        const complete = project({
          ...holiday,
          absencePay: { ...EMPTY_ABSENCE_PAY, day: "PAID", dailyRateCents: 0 },
        });
        const expected = calc(complete);
        expect(expected.result.status).toBe("available");
        expect(actual.forecast?.result).toEqual(expected.result);
        if (month === "2026-10") {
          const native = {
            ...base,
            result: {
              status: "unavailable" as const,
              stage: "sfn" as const,
              reason:
                "Die Anspruchs- und Auszahlungsgrundlagen konnten nicht vollständig zugeordnet werden.",
            },
          };
          expect(
            netFromKnownAbsencePay(native, pending, basis, settings, timeline, []).forecast?.result,
          ).toEqual(expected.result);
        }
        expect(actual.notice).toContain("13.10.2026");
        expect(pending.sources.find((s) => s.month === "2026-10")?.pay.available).toBe(false);
        expect(
          netFromKnownAbsencePay(expected, complete, basis, settings, timeline, []).notice,
        ).toBeUndefined();
        expect(
          netFromKnownAbsencePay(
            base,
            {
              ...pending,
              issues: [
                ...pending.issues,
                { kind: "MISSING_MONTH", month, group: "PREMIUMS", message: "Dienstmonat fehlt" },
              ],
            },
            basis,
            settings,
            timeline,
            [],
          ).forecast,
        ).toBe(base);
      }
    },
  );

  it.each([forecastProfile, e])("zahlt den Novemberaufschlag im Januar aus", (profile) => {
    for (const type of ["VACATION", "SICK"] as const) {
      const entries = [2, 3, 4].map((d) =>
        forecastShift({
          id: "fall-" + d,
          date: "2026-11-0" + d,
          type,
          allDay: true,
          startTime: null,
          endTime: null,
          breakMinutes: 0,
          absencePay: {
            ...EMPTY_ABSENCE_PAY,
            day: "PAID",
            workdaysPerWeek: 5,
            referenceCents: 97500,
          },
        }),
      );
      const source = { ...context, entries };
      const earned = salaryPaymentInput(
        "2026-11",
        profile,
        source,
        DEFAULT_SALARY_PAYMENT_PREFERENCES,
        "EARNED",
      );
      const cash = salaryPaymentInput(
        "2027-01",
        profile,
        source,
        DEFAULT_SALARY_PAYMENT_PREFERENCES,
        "PAYOUT",
      );
      expect(earned.pay.absencePayAmount).toBe(45);
      expect(cash.contributions.find((c) => c.group === "ABSENCE_PAY")).toEqual({
        group: "ABSENCE_PAY",
        claimMonth: "2026-11",
        paymentMonth: "2027-01",
        amountCents: 4500,
      });
      expect(isSalaryPaymentProjection(cash)).toBe(true);
      expect(cash.pay.timePremiumAmount).toBe(0);
    }
  });
  it("berechnet den Durchschnitt erneut, wenn eine Nachtschicht im Referenzmonat geändert wird", () => {
    const vacation = forecastShift({
      id: "vac",
      date: "2026-09-01",
      type: "VACATION",
      allDay: true,
      startTime: null,
      endTime: null,
      breakMinutes: 0,
      absencePay: { ...EMPTY_ABSENCE_PAY, day: "PAID", workdaysPerWeek: 5, historyComplete: true },
    });
    const night = forecastShift({
      id: "night",
      date: "2026-07-12",
      overtimeMinutes: 0,
      tariffOvertimeConfirmed: false,
    });
    const before = { ...context, entries: [vacation, night] };
    const after = { ...context, entries: [vacation] };
    const history = salaryMonthInput("2026-07", forecastProfile, before).pay;
    expect(history.timePremiumAmount).toBeGreaterThan(0);
    expect(salaryMonthInput("2026-09", forecastProfile, before).pay.absencePayAmount).toBe(
      Math.round((history.timePremiumAmount * 100) / 65) / 100,
    );
    expect(salaryMonthInput("2026-09", forecastProfile, after).pay.absencePayAmount).toBe(0);
  });
});
