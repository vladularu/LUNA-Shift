import { act, renderHook } from "@testing-library/react-native";
import { beforeEach, afterEach, describe, expect, it, jest } from "@jest/globals";

import type { ShiftEntry, UserProfile } from "@/domain/types";
import { useDeferredMonthlyCompliance } from "@/features/analysis/use-monthly-compliance";
import { bundledRuleResolver, type RuleResolver } from "@/rules/rule-resolver";
import * as compliance from "@/engine/compliance";

jest.mock("@/features/analysis/use-local-reference-date", () => ({
  useLocalReferenceDate: () => "2026-08-04",
}));

let mockYouth: boolean | null = false;
let mockCase = 0;
const mockRetryPreferences = jest.fn();
jest.mock("@/features/settings/check-preferences", () => ({
  useCheckPreferences: () => ({
    youthEnabled: mockYouth,
    error: mockYouth === null ? "Prüfungseinstellungen konnten nicht geladen werden." : null,
    retry: mockRetryPreferences,
  }),
}));
beforeEach(() => {
  mockCase += 1;
  PROFILE = { ...PROFILE, updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, mockCase)).toISOString() };
  mockYouth = false;
  mockRetryPreferences.mockClear();
});

let PROFILE: UserProfile = {
  federalState: "NW",
  holidayRegion: "NONE",
  weeklyMinutes: 2_400,
  timeZone: "Europe/Berlin",
  regularRotatingNightWork: false,
  sundayHolidayWorkEligible: true,
  allEmploymentWorkRecorded: true,
  tariff: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const LENIENT_RESOLVER: RuleResolver = Object.freeze({
  ...bundledRuleResolver,
  resolveLegal: (effectiveDate: string) => {
    const resolved = bundledRuleResolver.resolveLegal(effectiveDate);
    if (!resolved.ok) return resolved;
    return {
      ok: true as const,
      value: {
        ...resolved.value,
        rules: {
          ...resolved.value.rules,
          workingTime: {
            ...resolved.value.rules.workingTime,
            maxDailyMinutes: 1_440,
          },
        },
      },
    };
  },
});

function shift(id: string, endTime: string): ShiftEntry {
  return {
    kind: "SHIFT",
    id: `${id}-${mockCase}`,
    date: "2026-08-03",
    templateId: null,
    title: id,
    type: "DAY",
    startTime: "06:00",
    endTime,
    breakMinutes: 30,
    color: "#2F80ED",
    symbol: "D",
    note: null,
    overtimeMinutes: 0,
    holidayPremiumMode: "WITH_TIME_OFF",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  };
}

describe("useDeferredMonthlyCompliance", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("reuses a prepared check across remounts and recalculates changed inputs", async () => {
    jest.useFakeTimers();
    const shifts = [shift("prepared", "14:00")];
    const calculate = jest.spyOn(compliance, "calculateMonthlyComplianceSteps");
    const hook = await renderHook(() =>
      useDeferredMonthlyCompliance({ enabled: true, month: "2026-08", profile: PROFILE, shifts }),
    );
    await act(async () => {
      jest.runAllTimers();
    });
    const prepared = hook.result.current.result;
    expect(prepared).not.toBeNull();
    const calls = calculate.mock.calls.length;
    await hook.unmount();
    const remount = await renderHook(
      ({ entries }: { entries: readonly ShiftEntry[] }) =>
        useDeferredMonthlyCompliance({
          enabled: true,
          month: "2026-08",
          profile: { ...PROFILE },
          shifts: entries,
        }),
      { initialProps: { entries: shifts } },
    );
    expect(remount.result.current.result).toBe(prepared);
    expect(calculate).toHaveBeenCalledTimes(calls);
    await remount.rerender({ entries: [{ ...shifts[0], endTime: "22:00" }] });
    expect(remount.result.current.result).toBeNull();
    await act(async () => {
      jest.runAllTimers();
    });
    expect(calculate).toHaveBeenCalledTimes(calls + 1);
    expect(remount.result.current.result).not.toEqual(prepared);
  });

  it("finishes outside the render phase and commits the requested result", async () => {
    jest.useFakeTimers();
    const shifts = [shift("long", "18:30")];
    const screen = await renderHook(() =>
      useDeferredMonthlyCompliance({
        enabled: true,
        month: "2026-08",
        profile: PROFILE,
        shifts,
      }),
    );

    expect(screen.result.current.result).toBeNull();
    await act(async () => {
      jest.runAllTimers();
    });
    expect(screen.result.current.result?.criticalCount).toBeGreaterThan(0);
  });

  it("batches cheap steps without exceeding the callback step cap", async () => {
    jest.useFakeTimers();
    const shifts: readonly ShiftEntry[] = [];
    const result = {
      month: "2026-08",
      issues: [],
      affectedDates: [],
      criticalCount: 0,
      warningCount: 0,
      infoCount: 0,
    };
    let advanced = 0;
    jest.spyOn(compliance, "calculateMonthlyComplianceSteps").mockImplementation(function* () {
      for (let step = 0; step < 100; step++) {
        advanced++;
        yield 1;
      }
      return result;
    });
    const screen = await renderHook(() =>
      useDeferredMonthlyCompliance({
        enabled: true,
        month: "2026-08",
        profile: PROFILE,
        shifts,
      }),
    );
    expect(screen.result.current.result).toBeNull();
    await act(async () => {
      jest.advanceTimersToNextTimer();
    });
    expect(advanced).toBeGreaterThan(0);
    expect(advanced).toBeLessThanOrEqual(32);
    expect(screen.result.current.result).toBeNull();
    await act(async () => {
      jest.runAllTimers();
    });
    expect(screen.result.current.result).toEqual(result);
    expect(advanced).toBe(100);
  });

  it("yields after the time budget even before reaching the step cap", async () => {
    jest.useFakeTimers();
    const shifts: readonly ShiftEntry[] = [];
    const result = {
      month: "2026-08",
      issues: [],
      affectedDates: [],
      criticalCount: 0,
      warningCount: 0,
      infoCount: 0,
    };
    jest.spyOn(compliance, "calculateMonthlyComplianceSteps").mockImplementation(function* () {
      yield 1;
      yield 1;
      return result;
    });
    let clock = 0;
    jest.spyOn(performance, "now").mockImplementation(() => (clock += 5));
    const screen = await renderHook(() =>
      useDeferredMonthlyCompliance({
        enabled: true,
        month: "2026-08",
        profile: PROFILE,
        shifts,
      }),
    );
    await act(async () => {
      jest.advanceTimersToNextTimer();
    });
    expect(screen.result.current.result).toBeNull();
    await act(async () => {
      jest.advanceTimersToNextTimer();
    });
    expect(screen.result.current.result).toBeNull();
    await act(async () => {
      jest.advanceTimersToNextTimer();
    });
    expect(screen.result.current.result).toEqual(result);
  });

  it("does not start a hidden page and retains its completed result when hidden again", async () => {
    jest.useFakeTimers();
    const shifts = [shift("normal", "14:00")];
    const calculate = jest.spyOn(compliance, "calculateMonthlyComplianceSteps");
    const screen = await renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useDeferredMonthlyCompliance({ enabled, month: "2026-08", profile: PROFILE, shifts }),
      { initialProps: { enabled: false } },
    );
    expect(calculate).not.toHaveBeenCalled();
    await screen.rerender({ enabled: true });
    await act(async () => {
      jest.runAllTimers();
    });
    const completed = screen.result.current.result;
    expect(completed).not.toBeNull();
    const calls = calculate.mock.calls.length;
    await screen.rerender({ enabled: false });
    expect(screen.result.current.result).toBe(completed);
    await screen.rerender({ enabled: true });
    await act(async () => {
      jest.runAllTimers();
    });
    expect(screen.result.current.result).toBe(completed);
    expect(calculate).toHaveBeenCalledTimes(calls);
  });

  it("cancels stale work when the input changes", async () => {
    jest.useFakeTimers();
    const first = [shift("long", "18:30")];
    const second = [shift("normal", "14:00")];
    const screen = await renderHook(
      ({ shifts }: { readonly shifts: readonly ShiftEntry[] }) =>
        useDeferredMonthlyCompliance({
          enabled: true,
          month: "2026-08",
          profile: PROFILE,
          shifts,
        }),
      { initialProps: { shifts: first } },
    );

    await act(async () => {
      jest.advanceTimersToNextTimer();
    });
    await screen.rerender({ shifts: second });
    await act(async () => {
      jest.runAllTimers();
    });

    expect(screen.result.current.result?.criticalCount).toBe(0);
  });

  it("does not commit work produced for a previous resolver snapshot", async () => {
    jest.useFakeTimers();
    const shifts = [shift("long", "18:30")];
    const screen = await renderHook(
      ({ ruleResolver }: { readonly ruleResolver: RuleResolver }) =>
        useDeferredMonthlyCompliance({
          enabled: true,
          month: "2026-08",
          profile: PROFILE,
          ruleResolver,
          shifts,
        }),
      { initialProps: { ruleResolver: bundledRuleResolver } },
    );

    await act(async () => {
      jest.advanceTimersToNextTimer();
    });
    await screen.rerender({ ruleResolver: LENIENT_RESOLVER });
    await act(async () => {
      jest.runAllTimers();
    });

    expect(
      screen.result.current.result?.issues.some((issue) => issue.rule === "ARBZG_3_MAX_10H"),
    ).toBe(false);
  });
});

it("recalculates on youth activation and never shows stale adult results during preference loading", async () => {
  jest.useFakeTimers();
  const shifts = [shift("normal", "15:00")];
  const screen = await renderHook(() =>
    useDeferredMonthlyCompliance({ enabled: true, month: "2026-08", profile: PROFILE, shifts }),
  );
  await act(async () => {
    jest.runAllTimers();
  });
  const adult = screen.result.current.result;
  mockYouth = true;
  await screen.rerender({});
  expect(screen.result.current.result).toBeNull();
  await act(async () => {
    jest.runAllTimers();
  });
  expect(
    screen.result.current.result?.issues.some((finding) => finding.rule.startsWith("JARBSCHG")),
  ).toBe(true);
  mockYouth = false;
  await screen.rerender({});
  await act(async () => {
    jest.runAllTimers();
  });
  expect(screen.result.current.result).toEqual(adult);
  mockYouth = null;
  await screen.rerender({});
  expect(screen.result.current.result).toBeNull();
  expect(screen.result.current.error).toContain("nicht geladen");
  await act(async () => screen.result.current.retry());
  expect(mockRetryPreferences).toHaveBeenCalled();
});
