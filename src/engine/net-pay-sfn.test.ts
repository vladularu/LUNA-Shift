import { describe, expect, it } from "vitest";

import reviewedHolidays from "../../rules/packages/reviewed/de-holidays/2026.json";
import type {
  SfnClassificationResult,
  SfnPayrollInput,
  SfnPremiumPayment,
  SfnShift,
  SfnTimeRange,
} from "@/domain/net-pay-sfn";
import type { RuleHolidayPackage } from "@/rules/contracts.generated";
import { bundledRuleResolver, createRuleResolver } from "@/rules/rule-resolver";

import { classifySfnPayroll2026, classifySfnPayroll2026Steps } from "./net-pay-sfn";

const resolver = createRuleResolver(
  {
    tariff: [],
    legal: [],
    holiday: [reviewedHolidays as RuleHolidayPackage],
  },
  { tariff: "unused", legal: "unused", holiday: "de-holidays" },
);
const emptyResolver = createRuleResolver({ tariff: [], legal: [], holiday: [] });

function interval(start: string, end: string): SfnTimeRange {
  return { start, end };
}

function shift(
  start = "2026-07-09T20:00+02:00",
  end = "2026-07-09T21:00+02:00",
  amountCents = 500,
  kind: SfnPremiumPayment["kind"] = "NIGHT",
): SfnShift {
  return {
    id: "s1",
    start,
    end,
    unpaidBreaks: [],
    payments: [
      { id: "p1", kind, amountCents, additionalToBasicPay: true, periods: [{ start, end }] },
    ],
  };
}

function input(
  shifts: readonly SfnShift[] = [shift()],
  patch: Partial<SfnPayrollInput> = {},
): SfnPayrollInput {
  return {
    month: "2026-07",
    completeGross: true,
    grossCents: 500_500,
    regularMonthlySocialInsuranceGrossCents: 500_000,
    basicHourlyPayCents: 2_000,
    workplace: { federalState: "NW", holidayRegion: "NONE" },
    workEvidence: "PLANNED",
    shifts,
    ...patch,
  };
}

function available(value = input()): Extract<SfnClassificationResult, { status: "available" }> {
  const result = classifySfnPayroll2026(value, resolver);
  expect(result.status).toBe("available");
  if (result.status !== "available") throw new Error(result.reason);
  return result;
}

function expectFree(
  value: SfnPayrollInput,
  taxFreeCents: number,
  socialInsuranceFreeCents = taxFreeCents,
): void {
  const result = available(value);
  expect(result.taxFreeCents).toBe(taxFreeCents);
  expect(result.socialInsuranceFreeCents).toBe(socialInsuranceFreeCents);
  expect(result.amounts.taxableGrossCents + taxFreeCents).toBe(value.grossCents);
  expect(result.amounts.socialInsuranceGrossCents + socialInsuranceFreeCents).toBe(
    value.grossCents,
  );
  expect(result.amounts.taxableGrossCents).toBeLessThanOrEqual(
    result.amounts.socialInsuranceGrossCents,
  );
}

describe("explicit SFN payroll attribution 2026", () => {
  it.each([
    ["2026-07", "2026-07-09T20:00+02:00", "2026-07-10T06:00+02:00"],
    ["2026-03", "2026-03-28T20:00+01:00", "2026-03-29T06:00+02:00"],
    ["2026-10", "2026-10-24T20:00+02:00", "2026-10-25T06:00+01:00"],
  ])(
    "cooperatively preserves exact complete SFN results in %s, including offset changes",
    (month, start, end) => {
      const value = input([shift(start, end)], { month, monthAttribution: "SHIFT_START" });
      const expected = classifySfnPayroll2026(value, resolver, "FORECAST");
      const steps = classifySfnPayroll2026Steps(value, resolver, "FORECAST");
      let count = 0;
      while (true) {
        const step = steps.next();
        if (step.done) {
          expect(step.value).toEqual(expected);
          expect(step.value.status).toBe("available");
          break;
        }
        count++;
      }
      expect(count).toBeGreaterThan(month === "2026-07" ? 0 : 10);
    },
  );
  it("keeps full cash gross and passes separate taxable and SV bases", () => {
    const result = available();
    expect(result.amounts).toEqual({
      grossCents: 500_500,
      taxableGrossCents: 500_000,
      socialInsuranceGrossCents: 500_000,
      regularMonthlySocialInsuranceGrossCents: 500_000,
    });
    expect(result.workEvidence).toBe("PLANNED");
    expect(result.shifts[0]).toMatchObject({
      workedMinutes: 60,
      nightMinutes: 60,
      dayMinutes: 0,
      paidPremiumCents: 500,
      taxablePremiumCents: 0,
      socialInsuranceLiablePremiumCents: 0,
    });
  });

  it.each([
    ["19:00", "20:00", 0],
    ["19:59", "20:01", 8],
    ["20:00", "21:00", 500],
    ["05:00", "06:00", 500],
    ["05:59", "06:01", 8],
    ["06:00", "07:00", 0],
  ])("limits night eligibility %s–%s", (start, end, expected) => {
    expectFree(
      input([shift(`2026-07-09T${start}+02:00`, `2026-07-09T${end}+02:00`, 1_000)]),
      expected,
    );
  });

  it("raises only 00–04 after night work before midnight", () => {
    const s = shift("2026-07-09T23:00+02:00", "2026-07-10T05:00+02:00", 9_000);
    // 2 hours at 25% + 4 at 40%, each applied to 20 euros.
    expectFree(input([s]), 4_200);
  });

  it("does not raise the night cap for a midnight start", () => {
    expectFree(input([shift("2026-07-10T00:00+02:00", "2026-07-10T04:00+02:00", 4_000)]), 2_000);
  });

  it("requires pre-midnight work, not merely a pre-midnight shift start", () => {
    const s = shift("2026-07-09T20:00+02:00", "2026-07-10T04:00+02:00", 4_000);
    expectFree(
      input([{ ...s, unpaidBreaks: [interval(s.start, "2026-07-10T00:00+02:00")] }]),
      2_000,
    );
  });

  it.each([
    ["2026-07-12", "10:00", "11:00", 1_000], // Sunday
    ["2026-07-11", "10:00", "11:00", 0], // Saturday
    ["2026-10-03", "10:00", "11:00", 2_500],
    ["2026-05-01", "10:00", "11:00", 3_000],
    ["2026-12-24", "13:00", "14:00", 0],
    ["2026-12-24", "14:00", "15:00", 3_000],
    ["2026-12-25", "10:00", "11:00", 3_000],
    ["2026-12-26", "10:00", "11:00", 3_000],
    ["2026-12-31", "13:00", "14:00", 0],
    ["2026-12-31", "14:00", "15:00", 2_500],
  ])("applies day cap on %s at %s–%s", (date, start, end, expected) => {
    const offset = [5, 7].includes(Number(date.slice(5, 7))) ? "+02:00" : "+01:00";
    // October 3 still uses summer time.
    const effectiveOffset = date === "2026-10-03" ? "+02:00" : offset;
    expectFree(
      input(
        [
          shift(
            `${date}T${start}${effectiveOffset}`,
            `${date}T${end}${effectiveOffset}`,
            4_000,
            "DAY",
          ),
        ],
        { month: date.slice(0, 7) },
      ),
      expected,
    );
  });

  it("splits Heiligabend at 14:00 instead of freeing the whole line", () => {
    expectFree(
      input([shift("2026-12-24T13:00+01:00", "2026-12-24T15:00+01:00", 6_000, "DAY")], {
        month: "2026-12",
      }),
      3_000,
    );
  });

  it("shares the higher holiday cap between Sunday and holiday payments", () => {
    const s = shift("2026-11-01T10:00+01:00", "2026-11-01T11:00+01:00", 1_000, "DAY");
    expectFree(
      input(
        [
          {
            ...s,
            payments: [...s.payments, { ...s.payments[0], id: "holiday", amountCents: 2_500 }],
          },
        ],
        { month: "2026-11" },
      ),
      2_500,
    );
  });

  it("adds a separate night cap to the shared Sunday cap", () => {
    const s = shift("2026-07-12T22:00+02:00", "2026-07-12T23:00+02:00", 1_000, "DAY");
    expectFree(
      input([
        {
          ...s,
          payments: [
            ...s.payments,
            { ...s.payments[0], id: "night", kind: "NIGHT", amountCents: 500 },
          ],
        },
      ]),
      1_500,
    );
  });

  it("does not multiply a night cap when several payments overlap", () => {
    const s = shift();
    expectFree(
      input([{ ...s, payments: [...s.payments, { ...s.payments[0], id: "extra" }] }]),
      500,
    );
  });

  it("extends Sunday through 04:00 after pre-midnight night work", () => {
    expectFree(
      input([shift("2026-07-12T22:00+02:00", "2026-07-13T05:00+02:00", 7_000, "DAY")]),
      6_000,
    );
  });

  it("does not extend Sunday for a Monday midnight start", () => {
    expectFree(input([shift("2026-07-13T00:00+02:00", "2026-07-13T04:00+02:00", 4_000, "DAY")]), 0);
  });

  it("uses the workplace state for statutory holidays", () => {
    const s = shift("2026-06-04T10:00+02:00", "2026-06-04T11:00+02:00", 2_500, "DAY");
    expectFree(input([s], { month: "2026-06" }), 2_500);
    expectFree(
      input([s], { month: "2026-06", workplace: { federalState: "NI", holidayRegion: "NONE" } }),
      0,
    );
  });

  it("uses the confirmed local holiday region", () => {
    const s = shift("2026-08-08T10:00+02:00", "2026-08-08T11:00+02:00", 2_500, "DAY");
    expectFree(
      input([s], {
        month: "2026-08",
        workplace: { federalState: "BY", holidayRegion: "BY_AUGSBURG" },
      }),
      2_500,
    );
    expectFree(
      input([s], { month: "2026-08", workplace: { federalState: "BY", holidayRegion: "NONE" } }),
      0,
    );
  });

  it.each([
    [2_000, 500, 500],
    [2_500, 625, 625],
    [4_000, 1_000, 625],
    [5_000, 1_250, 625],
    [6_000, 1_250, 625],
  ])("applies independent base limits for hourly cents %i", (base, tax, sv) => {
    expectFree(input([shift(undefined, undefined, 2_000)], { basicHourlyPayCents: base }), tax, sv);
  });

  it("can free all of a low-rate Sunday payment even with base above 25 euros", () => {
    expectFree(
      input([shift("2026-07-12T10:00+02:00", "2026-07-12T11:00+02:00", 1_000, "DAY")], {
        basicHourlyPayCents: 4_000,
      }),
      1_000,
      1_000,
    );
  });

  it("does not exempt other premiums or included basic pay", () => {
    expectFree(input([shift(undefined, undefined, 500, "OTHER")]), 0);
    const s = shift();
    expectFree(input([{ ...s, payments: [{ ...s.payments[0], additionalToBasicPay: false }] }]), 0);
  });

  it("does not free daytime cash by combining it with eligible night minutes", () => {
    expectFree(input([shift("2026-07-09T19:00+02:00", "2026-07-09T21:00+02:00", 500)]), 250);
  });

  it("excludes unpaid breaks and retains paid breaks", () => {
    const s = shift("2026-07-09T19:00+02:00", "2026-07-09T21:00+02:00", 500);
    expectFree(input([{ ...s, unpaidBreaks: [interval(s.start, "2026-07-09T20:00+02:00")] }]), 500);
    expectFree(input([s]), 250);
  });

  it("retains exact rational cash attribution instead of losing repeated fractional cents", () => {
    expectFree(
      input([shift("2026-07-09T20:00+02:00", "2026-07-09T20:03+02:00", 1)], {
        basicHourlyPayCents: 2_000,
      }),
      1,
    );
  });

  it("rounds the free cap down only after summing the shift", () => {
    expectFree(
      input([shift("2026-07-09T20:00+02:00", "2026-07-09T20:03+02:00", 100)], {
        basicHourlyPayCents: 2_001,
      }),
      25,
    );
  });

  it("is invariant under splitting a uniformly paid interval into several periods", () => {
    const s = shift("2026-07-09T19:00+02:00", "2026-07-09T21:00+02:00", 501);
    const split = {
      ...s,
      payments: [
        {
          ...s.payments[0],
          periods: [
            interval(s.start, "2026-07-09T20:00+02:00"),
            interval("2026-07-09T20:00+02:00", s.end),
          ],
        },
      ],
    };
    expect(available(input([split]))).toEqual(available(input([s])));
  });

  it.each([
    ["2026-03", "2026-03-29T00:00+01:00", "2026-03-29T06:00+02:00", 300, 2_500],
    ["2026-10", "2026-10-25T00:00+02:00", "2026-10-25T06:00+01:00", 420, 3_500],
  ])("counts actual elapsed minutes at DST in %s", (month, start, end, minutes, free) => {
    const value = input([shift(start, end, 10_000)], { month });
    expectFree(value, free);
    expect(available(value).shifts[0].workedMinutes).toBe(minutes);
  });

  it("distinguishes both repeated 02:00 hours by offset", () => {
    const value = input([shift("2026-10-25T02:00+02:00", "2026-10-25T02:00+01:00", 1_000)], {
      month: "2026-10",
    });
    expectFree(value, 500);
    expect(available(value).shifts[0].workedMinutes).toBe(60);
  });

  it("supports context from the preceding month without freeing its cash in this month", () => {
    const s = shift("2026-06-30T22:00+02:00", "2026-07-01T04:00+02:00", 4_000);
    const value = input([
      {
        ...s,
        payments: [{ ...s.payments[0], periods: [interval("2026-07-01T00:00+02:00", s.end)] }],
      },
    ]);
    expectFree(value, 3_200);
  });

  it("requires holiday coverage for the preceding context month too", () => {
    const s = shift("2025-12-31T22:00+01:00", "2026-01-01T04:00+01:00", 4_000);
    const value = input(
      [
        {
          ...s,
          payments: [{ ...s.payments[0], periods: [interval("2026-01-01T00:00+01:00", s.end)] }],
        },
      ],
      { month: "2026-01" },
    );
    expect(classifySfnPayroll2026(value, resolver).status).toBe("missing-data");
    expect(classifySfnPayroll2026(value, bundledRuleResolver).status).toBe("available");
  });

  it("does not substitute legacy rules for an incomplete supplied resolver", () => {
    expect(classifySfnPayroll2026(input(), emptyResolver)).toMatchObject({
      status: "missing-data",
    });
  });

  it.each([
    { completeGross: false },
    { basicHourlyPayCents: null },
    { workplace: null },
    { workplace: { federalState: "BY", holidayRegion: "UNKNOWN" } },
    { workEvidence: undefined },
  ])("withholds a result for missing payroll assumptions %#", (patch) => {
    expect(
      classifySfnPayroll2026(input(undefined, patch as Partial<SfnPayrollInput>), resolver).status,
    ).toBe("missing-data");
  });

  it.each([
    { month: "2026-13" },
    { month: "2026-7" },
    { grossCents: -1 },
    { grossCents: 0 },
    { grossCents: 0.5 },
    { regularMonthlySocialInsuranceGrossCents: 600_000 },
    { basicHourlyPayCents: 0 },
    { basicHourlyPayCents: Number.NaN },
    { workplace: { federalState: "NI", holidayRegion: "BY_AUGSBURG" } },
    { shifts: null },
  ])("rejects invalid payroll inputs %#", (patch) => {
    expect(
      classifySfnPayroll2026(input(undefined, patch as Partial<SfnPayrollInput>), resolver).status,
    ).toBe("invalid-input");
  });

  it.each(["2025-07", "2027-07"])("rejects an unreviewed payroll year %s", (month) => {
    expect(classifySfnPayroll2026(input([], { month }), resolver).status).toBe("unsupported");
  });

  it.each([
    "2026-07-09T20:00",
    "2026-07-09T20:00+01:00",
    "2026-03-29T02:00+01:00",
    "2026-07-09T20:00:01+02:00",
    "2026-02-30T20:00+01:00",
  ])("rejects invalid or ambiguous timestamp %s", (start) => {
    expect(classifySfnPayroll2026(input([{ ...shift(), start }]), resolver).status).toBe(
      "invalid-input",
    );
  });

  it("withholds a result for an unknown unpaid break location", () => {
    expect(
      classifySfnPayroll2026(input([{ ...shift(), unpaidBreaks: null }]), resolver).status,
    ).toBe("missing-data");
  });

  it("rejects payments with no paid work after breaks", () => {
    const s = shift();
    expect(
      classifySfnPayroll2026(input([{ ...s, unpaidBreaks: [interval(s.start, s.end)] }]), resolver)
        .status,
    ).toBe("invalid-input");
  });

  it("rejects duplicate IDs, overlapping shifts, breaks and payment periods", () => {
    const s = shift();
    const values = [
      input([s, s]),
      input([s, { ...s, id: "s2" }]),
      input([{ ...s, payments: [...s.payments, s.payments[0]] }]),
      input([{ ...s, unpaidBreaks: [interval(s.start, s.end), interval(s.start, s.end)] }]),
      input([
        {
          ...s,
          payments: [
            { ...s.payments[0], periods: [interval(s.start, s.end), interval(s.start, s.end)] },
          ],
        },
      ]),
    ];
    for (const value of values)
      expect(classifySfnPayroll2026(value, resolver).status).toBe("invalid-input");
  });

  it("rejects attribution beyond the shift and a negative or fractional payment", () => {
    const s = shift();
    for (const patch of [
      { amountCents: -1 },
      { amountCents: 0.1 },
      { kind: "unknown" },
      { additionalToBasicPay: undefined },
      { periods: [interval(s.start, "2026-07-09T22:00+02:00")] },
    ]) {
      const value = input([
        { ...s, payments: [{ ...s.payments[0], ...patch } as SfnPremiumPayment] },
      ]);
      expect(classifySfnPayroll2026(value, resolver).status).toBe("invalid-input");
    }
  });

  it("rejects paid cash outside its attribution month", () => {
    const s = shift("2026-06-30T22:00+02:00", "2026-07-01T04:00+02:00", 4_000);
    expect(classifySfnPayroll2026(input([s]), resolver).status).toBe("unsupported");
  });

  it("rejects premiums exceeding complete gross", () => {
    expect(
      classifySfnPayroll2026(input([shift(undefined, undefined, 500_501)]), resolver).status,
    ).toBe("invalid-input");
  });

  it("reconciles multiple non-overlapping shifts and fully freezes outputs", () => {
    const s = shift();
    const s2 = shift("2026-07-10T20:00+02:00", "2026-07-10T21:00+02:00", 600);
    const result = available(
      input([s, { ...s2, id: "s2", payments: [{ ...s2.payments[0], id: "p2" }] }]),
    );
    expect(result.paidPremiumCents).toBe(1_100);
    expect(result.taxFreeCents).toBe(1_000);
    expect(
      result.shifts.reduce((sum, row) => sum + row.taxFreeCents + row.taxablePremiumCents, 0),
    ).toBe(1_100);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.amounts)).toBe(true);
    expect(Object.isFrozen(result.shifts)).toBe(true);
    expect(Object.isFrozen(result.shifts[0])).toBe(true);
  });

  it("allows explicit no-premium payroll without changing bases", () => {
    const result = available(input([]));
    expect(result.taxFreeCents).toBe(0);
    expect(result.amounts.taxableGrossCents).toBe(result.amounts.grossCents);
  });
});
