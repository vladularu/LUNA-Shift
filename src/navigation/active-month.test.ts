import { describe, expect, it, vi } from "vitest";

import {
  createActiveMonthCoordinator,
  requestCalendarTodayOnPress,
  requireActiveMonth,
} from "@/navigation/active-month";
import { requestAnalysisCurrentPeriodOnReselect } from "./analysis-period-navigation";

describe("active month coordinator", () => {
  it("shares the latest valid month without React updates", () => {
    const coordinator = createActiveMonthCoordinator("2026-08");

    expect(coordinator.getMonth()).toBe("2026-08");
    expect(coordinator.setMonth("2027-01")).toBe("2027-01");
    expect(coordinator.getMonth()).toBe("2027-01");
  });

  it("publishes only actual month changes", () => {
    const coordinator = createActiveMonthCoordinator("2026-08");
    const listener = vi.fn();
    const unsubscribe = coordinator.subscribeMonths(listener);

    coordinator.setMonth("2026-08");
    coordinator.setMonth("2026-09");
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    coordinator.setMonth("2026-10");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed and impossible months", () => {
    expect(() => requireActiveMonth("2026-8")).toThrow();
    expect(() => requireActiveMonth("2026-13")).toThrow();
  });

  it("publishes exactly one Today request for each calendar tab press", () => {
    const coordinator = createActiveMonthCoordinator("2026-08");
    const listener = vi.fn();
    const unsubscribe = coordinator.subscribeTodayRequests(listener);

    requestCalendarTodayOnPress(coordinator);
    expect(coordinator.getTodayRequestRevision()).toBe(1);
    expect(coordinator.hasPendingTodayRequest(1)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    coordinator.requestToday();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps analysis reselects separate from calendar Today and preserves periods on normal tab switches", () => {
    const coordinator = createActiveMonthCoordinator("2026-08");
    const analysis = vi.fn();
    const today = vi.fn();
    const stop = coordinator.analysisRequests.subscribe(analysis);
    coordinator.subscribeTodayRequests(today);
    requestAnalysisCurrentPeriodOnReselect(coordinator, false);
    expect(coordinator.analysisRequests.getRevision()).toBe(0);
    requestAnalysisCurrentPeriodOnReselect(coordinator, true);
    expect(coordinator.analysisRequests.getRevision()).toBe(1);
    expect(analysis).toHaveBeenCalledTimes(1);
    expect(today).not.toHaveBeenCalled();
    expect(coordinator.getMonth()).toBe("2026-08");
    requestCalendarTodayOnPress(coordinator);
    expect(today).toHaveBeenCalledTimes(1);
    expect(analysis).toHaveBeenCalledTimes(1);
    stop();
    requestAnalysisCurrentPeriodOnReselect(coordinator, true);
    expect(analysis).toHaveBeenCalledTimes(1);
  });

  it("keeps the newest Today request pending until it is completed", () => {
    const coordinator = createActiveMonthCoordinator("2026-08");

    const firstRevision = coordinator.requestToday();
    const secondRevision = coordinator.requestToday();

    coordinator.completeTodayRequest(firstRevision);
    expect(coordinator.hasPendingTodayRequest(secondRevision)).toBe(true);

    coordinator.completeTodayRequest(secondRevision);
    expect(coordinator.hasPendingTodayRequest(secondRevision)).toBe(false);
  });
});
