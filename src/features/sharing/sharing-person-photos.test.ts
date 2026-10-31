import { describe, expect, it } from "vitest";
import {
  sharedPersonPresentation,
  visibleSharingPhotoIds,
  type SharingPhotoGeometry,
} from "./sharing-person-photos";
import type { SharingCalendarView } from "@/domain/sharing-ui-contract";
const received: SharingCalendarView = {
  id: "received",
  ownerId: "kim",
  name: "Kims Dienstplan",
  color: "#E776A8",
  visibility: "DETAILS",
  isOwner: false,
  visible: true,
  publishedAt: null,
  syncState: "current",
  members: [],
  invites: [],
  profilePhotoUri: "data:image/jpeg;base64,shared",
};
const present = (calendars: readonly SharingCalendarView[]) =>
  sharedPersonPresentation({ status: "signedIn", profilePhotosAvailable: true, calendars }, "kim");
describe("person photos in sharing settings", () => {
  it("uses a received consented photo by account ID even when the calendar name is different", () => {
    expect(present([received])).toEqual({
      color: received.color,
      photoUri: received.profilePhotoUri,
      calendarIds: [received.id],
    });
  });
  it("never identifies a person by their display name or by an outgoing photo consent", () => {
    expect(
      present([
        { ...received, ownerId: "someone-else", name: "Kim" },
        { ...received, id: "own", isOwner: true },
      ]).photoUri,
    ).toBeUndefined();
  });
  it("clears a withdrawn photo, unavailable capability and signed-out identity", () => {
    expect(present([{ ...received, profilePhotoUri: null }]).photoUri).toBeNull();
    expect(
      sharedPersonPresentation(
        { status: "signedIn", profilePhotosAvailable: false, calendars: [received] },
        "kim",
      ).photoUri,
    ).toBeNull();
    expect(
      sharedPersonPresentation(
        { status: "signedOut", profilePhotosAvailable: true, calendars: [received] },
        "kim",
      ).calendarIds,
    ).toEqual([]);
    expect(present([{ ...received, syncState: "expired" }]).photoUri).toBeUndefined();
  });
  it("can use another consented received calendar belonging to the same person", () => {
    expect(
      present([{ ...received, id: "no-photo", profilePhotoUri: null }, received]).photoUri,
    ).toBe(received.profilePhotoUri);
  });
});
const targets = Array.from({ length: 20 }, (_, i) => ({
  key: String(i),
  section: "incoming" as const,
  calendarIds: ["calendar-" + i],
}));
const geometry: SharingPhotoGeometry = {
  viewport: { offset: 478, height: 168 },
  sections: { incoming: 20 },
  cards: { incoming: 10 },
  rows: Object.fromEntries(targets.map((target, i) => [target.key, { top: i * 56, height: 56 }])),
};
it("loads only the rows intersecting the viewport and advances beyond the first eight people", () => {
  expect(visibleSharingPhotoIds(targets, geometry)).toEqual([
    "calendar-8",
    "calendar-9",
    "calendar-10",
  ]);
});
it("deduplicates photos and bounds large viewports without requesting unmeasured rows", () => {
  expect(
    visibleSharingPhotoIds(targets, { ...geometry, viewport: { offset: 0, height: 2000 } }),
  ).toHaveLength(8);
  expect(visibleSharingPhotoIds(targets, { ...geometry, rows: {} })).toEqual([]);
  expect(
    visibleSharingPhotoIds([{ ...targets[8], calendarIds: ["same", "same"] }], geometry),
  ).toEqual(["same"]);
});

it("keeps the person's color stable when a photo is available through another calendar", () => {
  const first = { ...received, id: "first", color: "#527D92", profilePhotoUri: null };
  expect(present([first, received])).toMatchObject({
    color: first.color,
    photoUri: received.profilePhotoUri,
  });
  expect(present([first, { ...received, profilePhotoUri: null }]).color).toBe(first.color);
});
