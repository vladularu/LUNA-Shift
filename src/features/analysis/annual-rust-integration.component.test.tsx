import { act, renderHook } from "@testing-library/react-native";
import { beforeEach, afterEach, describe, expect, it, jest } from "@jest/globals";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import type { AnnualReport } from "./annual-report";
import type { AnnualAnalysisRequest } from "./annual-analysis";
import type { AnnualNetPay, AnnualNetPayRequest } from "./annual-net-pay";
import type { AnnualRustCalculator } from "./annual-rust-bridge";
import { useSimpleAnnualReport } from "./use-simple-annual-report";
import { usePreparedAnnualNetPay } from "./use-annual-net-pay";
import * as oldReport from "./annual-core-report";
import * as oldNet from "./annual-net-pay";
import fixture from "./annual-rust-bridge.fixture.json";

let mockCalculator: AnnualRustCalculator;
jest.mock("./use-annual-rust-calculator", () => ({
  useAnnualRustCalculator: () => mockCalculator,
}));
jest.mock("./analysis-persistent-results", () => ({ useAnalysisPersistentResults: () => null }));
jest.mock("./use-local-reference-date", () => ({ useLocalReferenceDate: () => "2026-11-16" }));
jest.mock("@/features/settings/check-preferences", () => ({
  useCheckPreferences: () => ({ youthEnabled: false }),
}));
const report = () =>
  ({
    ...fixture.report,
    distribution: new Map(fixture.report.distribution as [string, number][]),
  }) as unknown as AnnualReport;
const request = () =>
  ({
    ...fixture.base,
    enabled: true,
    ruleResolver: { ...bundledRuleResolver },
  }) as unknown as AnnualAnalysisRequest & { enabled: boolean };
async function settle() {
  await act(async () => {
    for (let i = 0; i < 12; i++) {
      jest.runAllTimers();
      await Promise.resolve();
    }
  });
}
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
  mockCalculator = {
    cacheIdentity: "native-annual",
    report: jest.fn<AnnualRustCalculator["report"]>().mockResolvedValue(report()),
    net: jest
      .fn<AnnualRustCalculator["net"]>()
      .mockResolvedValue(fixture.net as unknown as AnnualNetPay),
  };
  jest.spyOn(oldReport, "buildAnnualAvailableReportSteps").mockImplementation(() => {
    throw new Error("TS annual math must stay inactive");
  });
  jest.spyOn(oldNet, "annualNetPaySteps").mockImplementation(() => {
    throw new Error("TS annual net math must stay inactive");
  });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});
describe("existing annual hooks with Rust data only", () => {
  it("reuses a completed neighboring year when swiping back", async () => {
    const input = request();
    jest.mocked(mockCalculator.report).mockImplementation(async (request) => ({
      ...report(),
      year: request.year,
      months: report().months.map((row, index) => ({
        ...row,
        month: `${request.year}-${String(index + 1).padStart(2, "0")}`,
      })),
    }));
    const hook = await renderHook(
      ({ year }: { year: number }) => useSimpleAnnualReport({ ...input, year }),
      { initialProps: { year: input.year } },
    );
    await settle();
    await hook.rerender({ year: input.year + 1 });
    await settle();
    expect(hook.result.current.report?.year).toBe(input.year + 1);
    await hook.rerender({ year: input.year });
    expect(hook.result.current.report?.year).toBe(input.year);
    await settle();
    expect(mockCalculator.report).toHaveBeenCalledTimes(2);
  });
  it("uses the existing failure and retry flow instead of waiting indefinitely", async () => {
    const input = request();
    jest.mocked(mockCalculator.report).mockRejectedValueOnce(new Error("native unavailable"));
    const hook = await renderHook(() => useSimpleAnnualReport(input));
    await settle();
    expect(hook.result.current.fatalError?.message).toBe("native unavailable");
    await act(async () => {
      hook.result.current.retry();
    });
    await settle();
    expect(hook.result.current.report).toEqual(report());
    expect(hook.result.current.fatalError).toBeNull();
  });
  it("reuses unchanged years immediately after remount without TS or Rust recalculation", async () => {
    const input = request();
    const hook = await renderHook(() => useSimpleAnnualReport(input));
    await settle();
    expect(hook.result.current.report).toEqual(report());
    expect(mockCalculator.report).toHaveBeenCalledTimes(1);
    await hook.unmount();
    const again = await renderHook(() =>
      useSimpleAnnualReport({ ...input, entries: structuredClone(input.entries) }),
    );
    expect(again.result.current.report).toEqual(report());
    await settle();
    expect(mockCalculator.report).toHaveBeenCalledTimes(1);
    expect(oldReport.buildAnnualAvailableReportSteps).not.toHaveBeenCalled();
  });
  it("discards a late result after a service edit", async () => {
    const input = request();
    let finish!: (value: AnnualReport) => void;
    jest.mocked(mockCalculator.report).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const changed = { ...report(), actualMinutes: report().actualMinutes + 30 };
    jest.mocked(mockCalculator.report).mockResolvedValueOnce(changed);
    const hook = await renderHook(
      ({ entries }: { entries: AnnualAnalysisRequest["entries"] }) =>
        useSimpleAnnualReport({ ...input, entries }),
      { initialProps: { entries: input.entries } },
    );
    await settle();
    const entries = input.entries.map((entry, index) =>
      index === 0 ? { ...entry, revision: entry.revision + 1 } : entry,
    );
    await hook.rerender({ entries });
    await settle();
    expect(hook.result.current.report).toEqual(changed);
    await act(async () => {
      finish(report());
    });
    await settle();
    expect(hook.result.current.report).toEqual(changed);
  });
  it("keeps the original annual net result and shares it after remount", async () => {
    const input = {
      ...fixture.netRequest,
      context: { ...fixture.netRequest.context, resolver: { ...bundledRuleResolver } },
    } as unknown as AnnualNetPayRequest;
    const hook = await renderHook(() => usePreparedAnnualNetPay(input, true));
    await settle();
    expect(hook.result.current.report).toEqual(fixture.net);
    await hook.unmount();
    const again = await renderHook(() => usePreparedAnnualNetPay(input, true));
    expect(again.result.current.report).toEqual(fixture.net);
    await settle();
    expect(mockCalculator.net).toHaveBeenCalledTimes(1);
    expect(oldNet.annualNetPaySteps).not.toHaveBeenCalled();
  });
});
