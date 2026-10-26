import { render, renderHook } from "@testing-library/react-native";
import { describe, expect, it } from "@jest/globals";
import { createWorkingTimeCalculationProfile } from "@/engine/working-time-calculation-profile";
import { work } from "@/engine/remuneration-test-fixtures";
import { bundledRuleResolver } from "@/rules/rule-resolver";
import {
  CalendarHolidayCoverageNotice,
  calendarDayLabelForDate,
  holidayNameForDate,
  useCalendarHolidayResolution,
} from "./calendar-holidays";

const profile = createWorkingTimeCalculationProfile(
  { ...work, federalState: "HE", sundayHolidayWorkEligible: true },
  null,
  [],
);
describe("calendar day classifications", () => {
  it("keeps the statutory lookup statutory and supplies the full tariff day-window label", () => {
    expect(holidayNameForDate("2026-12-24", profile, bundledRuleResolver)).toBeUndefined();
    expect(calendarDayLabelForDate("2026-12-24", profile, bundledRuleResolver)).toBe(
      "Heiligabend (tariflicher Sondertag)",
    );
    expect(calendarDayLabelForDate("2026-12-25", profile, bundledRuleResolver)).toBe(
      "1. Weihnachtstag",
    );
  });
  it("keeps separate maps and respects the existing display preference", async () => {
    const { result, rerender } = await renderHook(
      ({ show }: { show: boolean }) =>
        useCalendarHolidayResolution("2026-12", profile, bundledRuleResolver, show),
      { initialProps: { show: true } },
    );
    expect(result.current.holidays.has("2026-12-24")).toBe(false);
    expect(result.current.specialDays.has("2026-12-24")).toBe(true);
    await rerender({ show: false });
    expect(result.current.specialDays.size).toBe(0);
    expect(result.current.holidays.size).toBe(0);
  });
  it("shows a coverage notice for broken calculation inputs without classifying new days", async () => {
    const p = { ...profile, workingTimeTarget: { status: "error" as const, notices: [] } };
    const { result } = await renderHook(() =>
      useCalendarHolidayResolution("2026-12", p, bundledRuleResolver, true),
    );
    const screen = await render(<CalendarHolidayCoverageNotice resolution={result.current} />);
    expect(result.current.specialDays.size).toBe(0);
    expect(
      screen.getByText(/Tarifliche Sondertage können gerade nicht angezeigt werden/),
    ).toBeVisible();
  });
});
