import { describe, expect, it } from "vitest";
import reviewedHolidays from "../../rules/packages/reviewed/de-holidays/2026.json";
import type { SfnPayrollInput, SfnPremiumPayment } from "@/domain/net-pay-sfn";
import type { RuleHolidayPackage } from "@/rules/contracts.generated";
import { bundledRuleResolver, createRuleResolver } from "@/rules/rule-resolver";
import { classifySfnPayroll2026 } from "./net-pay-sfn";

function payroll(
  start = "2026-07-31T22:00+02:00",
  end = "2026-08-01T06:00+02:00",
  kind: SfnPremiumPayment["kind"] = "NIGHT",
): SfnPayrollInput {
  return {
    month: start.slice(0, 7),
    monthAttribution: "SHIFT_START",
    completeGross: true,
    grossCents: 520_000,
    regularMonthlySocialInsuranceGrossCents: 500_000,
    basicHourlyPayCents: 6_000,
    workplace: { federalState: "NW", holidayRegion: "NONE" },
    workEvidence: "PLANNED",
    shifts: [
      {
        id: "boundary",
        start,
        end,
        unpaidBreaks: [],
        payments: [
          {
            id: "night",
            kind,
            amountCents: 20_000,
            additionalToBasicPay: true,
            periods: [{ start, end }],
          },
        ],
      },
    ],
  };
}

describe("planned SFN attribution follows the salary shift-start month", () => {
  it("keeps night cash intact and applies separate tax and SV caps to the actual minutes", () => {
    const result = classifySfnPayroll2026(payroll(), bundledRuleResolver);
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error(result.reason);
    // 22–24: 25%, 00–04: 40%, 04–06: 25%; tax hourly cap 50€, SV hourly cap 25€.
    expect(result.paidPremiumCents).toBe(20_000);
    expect(result.taxFreeCents).toBe(13_000);
    expect(result.socialInsuranceFreeCents).toBe(6_500);
    expect(result.amounts).toMatchObject({
      grossCents: 520_000,
      taxableGrossCents: 507_000,
      socialInsuranceGrossCents: 513_500,
    });
    expect(result.shifts[0]).toMatchObject({ workedMinutes: 480, nightMinutes: 480 });
  });

  it.each([
    ["2026-01-31T22:00+01:00", "2026-02-01T06:00+01:00", 6_000],
    ["2026-04-30T22:00+02:00", "2026-05-01T06:00+02:00", 15_000],
    ["2026-10-31T22:00+01:00", "2026-11-01T06:00+01:00", 15_000],
  ])("uses the Sunday or holiday on the real following date after %s", (start, end, free) => {
    const result = classifySfnPayroll2026(
      { ...payroll(start, end, "DAY"), basicHourlyPayCents: 2_000 },
      bundledRuleResolver,
    );
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error(result.reason);
    expect(result.taxFreeCents).toBe(free);
    expect(result.socialInsuranceFreeCents).toBe(free);
    expect(result.shifts[0].dayMinutes).toBe(360);
  });

  it.each(["PLANNED", "RECORDED"] as const)(
    "preserves work-minute attribution as the default for %s work",
    (workEvidence) => {
      const { monthAttribution: _attribution, ...value } = payroll();
      expect(classifySfnPayroll2026({ ...value, workEvidence }, bundledRuleResolver).status).toBe(
        "unsupported",
      );
      expect(
        classifySfnPayroll2026(
          { ...value, workEvidence, monthAttribution: "WORK_MINUTES" },
          bundledRuleResolver,
        ).status,
      ).toBe("unsupported");
    },
  );

  it("does not silently apply the planned convention to recorded payroll", () => {
    expect(
      classifySfnPayroll2026({ ...payroll(), workEvidence: "RECORDED" }, bundledRuleResolver)
        .status,
    ).toBe("invalid-input");
  });

  it.each(["2026-06", "2026-08"])("rejects a shift that starts outside %s", (month) => {
    expect(classifySfnPayroll2026({ ...payroll(), month }, bundledRuleResolver).status).toBe(
      "unsupported",
    );
  });

  it("requires actual-date holiday coverage at a year boundary", () => {
    const value = payroll("2026-12-31T22:00+01:00", "2027-01-01T06:00+01:00");
    const resolver = createRuleResolver(
      { tariff: [], legal: [], holiday: [reviewedHolidays as RuleHolidayPackage] },
      { tariff: "unused", legal: "unused", holiday: "de-holidays" },
    );
    expect(classifySfnPayroll2026(value, resolver)).toMatchObject({ status: "missing-data" });
    expect(classifySfnPayroll2026(value, bundledRuleResolver).status).toBe("available");
  });

  it("retains pause exclusion and continues night context across the month", () => {
    const value = payroll();
    const result = classifySfnPayroll2026(
      {
        ...value,
        shifts: [
          {
            ...value.shifts[0],
            unpaidBreaks: [{ start: "2026-08-01T01:00+02:00", end: "2026-08-01T02:00+02:00" }],
          },
        ],
      },
      bundledRuleResolver,
    );
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error(result.reason);
    expect(result.shifts[0].workedMinutes).toBe(420);
    expect(result.taxFreeCents).toBe(11_000);
    expect(result.socialInsuranceFreeCents).toBe(5_500);
  });

  it("still rejects overlapping shifts and intervals beyond the shift", () => {
    const value = payroll();
    const duplicate = { ...value.shifts[0], id: "duplicate" };
    const outside = {
      ...value.shifts[0],
      payments: [
        {
          ...value.shifts[0].payments[0],
          periods: [{ start: value.shifts[0].start, end: "2026-08-01T07:00+02:00" }],
        },
      ],
    };
    for (const shifts of [[...value.shifts, duplicate], [outside]])
      expect(classifySfnPayroll2026({ ...value, shifts }, bundledRuleResolver).status).toBe(
        "invalid-input",
      );
  });
});
