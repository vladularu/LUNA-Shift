import { describe, expect, it } from "vitest";
import type { PrivateCloudDocument } from "@/domain/private-cloud";
import { isCalendarOnlyCloudChange } from "./private-cloud-refresh-scope";

const before: PrivateCloudDocument = {
  format: "lunashift-private-cloud",
  version: 1,
  backupVersion: 20,
  databaseSchemaVersion: 33,
  data: {
    shifts: [{ id: "shift", title: "Früh" }],
    appointments: [{ id: "appointment", title: "Alt" }],
    profile: { timeZone: "Europe/Berlin" },
    preferences: [{ key: "theme", value: "light" }],
  },
  presentation: { calendarImage: null, calendarImageStrength: "medium" },
};

const calendarChanges: PrivateCloudDocument["data"][] = [
  { shifts: [{ id: "shift", title: "Spät" }] },
  { shifts: [] },
  { shifts: [{ id: "new", date: "2027-01-11" }] },
  { appointments: [{ id: "appointment", title: "Neu", revision: 2 }] },
  { appointments: [] },
  { shifts: [], appointments: [] },
];
const otherChanges: PrivateCloudDocument["data"][] = [
  { profile: { timeZone: "UTC" } },
  { preferences: [{ key: "theme", value: "dark" }] },
  { templates: [{ id: "template" }] },
  { netPayProfiles: [{ month: "2026-11" }] },
  { trainingProfiles: [{ effective_from: "2026-11-01" }] },
  { futureCollection: [] },
];

describe("cloud refresh scope", () => {
  it.each(calendarChanges)("keeps entry-only change %j in the existing screen", (data) => {
    expect(
      isCalendarOnlyCloudChange(before, { ...before, data: { ...before.data, ...data } }),
    ).toBe(true);
  });

  it.each(otherChanges)("refreshes all contexts for other or unknown data %j", (data) => {
    expect(
      isCalendarOnlyCloudChange(before, {
        ...before,
        data: { ...before.data, shifts: [], ...data },
      }),
    ).toBe(false);
  });

  it.each([
    { calendarImageStrength: "strong" as const },
    { calendarImageOpacity: 42 },
    { accountPhoto: null },
    { calendarImage: "changed-image" },
  ])("refreshes presentation changes %j", (presentation) => {
    expect(
      isCalendarOnlyCloudChange(before, {
        ...before,
        presentation: { ...before.presentation, ...presentation },
      }),
    ).toBe(false);
  });

  it("does not ignore schema or future document metadata", () => {
    expect(isCalendarOnlyCloudChange(before, { ...before, databaseSchemaVersion: 34 })).toBe(false);
    expect(isCalendarOnlyCloudChange(before, { ...before, backupVersion: 21 })).toBe(false);
    const future = { ...before, futureMetadata: "new" };
    expect(isCalendarOnlyCloudChange(before, future)).toBe(false);
  });
});
