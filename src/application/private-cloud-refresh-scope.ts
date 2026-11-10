import type { PrivateCloudDocument } from "@/domain/private-cloud";
import { sameCloudValue } from "@/domain/private-cloud-merge";

/** Unknown collections and metadata require the complete provider refresh. */
export function isCalendarOnlyCloudChange(
  before: PrivateCloudDocument,
  after: PrivateCloudDocument,
): boolean {
  if (before.presentation.calendarImage !== after.presentation.calendarImage) return false;
  const withoutEntries = (document: PrivateCloudDocument) => ({
    ...document,
    data: { ...document.data, shifts: [], appointments: [] },
    presentation: { ...document.presentation, calendarImage: null },
  });
  return sameCloudValue(withoutEntries(before), withoutEntries(after));
}
