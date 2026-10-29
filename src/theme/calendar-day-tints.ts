import type { Palette } from "./palette-values";
import type { CalendarHolidayColor } from "@/domain/types";

export const CALENDAR_HOLIDAY_COLORS = Object.freeze({
  RED: "#D94B4B",
  BLUE: "#3B82D0",
  ORANGE: "#D39A45",
});

/** Transparent surfaces retain the calendar photo and leave service colors intact. */
export function calendarDayTints(
  palette: Pick<Palette, "text">,
  holidayColor: CalendarHolidayColor = "ORANGE",
) {
  return {
    weekend: palette.text + "14",
    specialDay: CALENDAR_HOLIDAY_COLORS[holidayColor] + "40",
  };
}
