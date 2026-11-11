import { afterEach, describe, expect, it, vi } from "vitest";
import { checkPeriodLabel } from "./check-period-label";

afterEach(() => vi.restoreAllMocks());

describe("check period labels on iOS", () => {
  it("renders when Hermes omits the resolved Intl calendar", () => {
    const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (
      this: Intl.DateTimeFormat,
    ) {
      const options = { ...resolvedOptions.call(this) };
      Reflect.deleteProperty(options, "calendar");
      return options;
    });
    expect(checkPeriodLabel("2026-11-11", "2026-11-12")).toBe("11.–12. November 2026");
  });

  it("shows unavailable stored dates without crashing a check", () => {
    expect(checkPeriodLabel("invalid", "2026-11-12")).toBe("Zeitraum nicht verfügbar");
    expect(checkPeriodLabel("2026-11-12", "2026-11-11")).toBe("Zeitraum nicht verfügbar");
  });

  it("keeps single dates and month/year transitions unambiguous", () => {
    expect(checkPeriodLabel("2026-11-12", "2026-11-12")).toBe("12. November 2026");
    expect(checkPeriodLabel("2026-11-30", "2026-12-01")).toBe(
      "30. November 2026 – 1. Dezember 2026",
    );
    expect(checkPeriodLabel("2026-12-31", "2027-01-01")).toBe("31. Dezember 2026 – 1. Januar 2027");
  });
});
