import { createContext, use } from "react";
import type { CachedSharedCalendar } from "@/domain/calendar-sharing";
const EMPTY: readonly CachedSharedCalendar[] = Object.freeze([]);
export const SharedCalendarsContext = createContext<readonly CachedSharedCalendar[]>(EMPTY);
export function useVisibleSharedCalendars(): readonly CachedSharedCalendar[] {
  return use(SharedCalendarsContext);
}
