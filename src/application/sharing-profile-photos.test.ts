import { expect, it, vi } from "vitest";
import { createSharingProfilePhotos } from "./sharing-profile-photos";
import type { SharingCloudPort } from "@/domain/calendar-sharing-ports";

const response = (id: string, image: string | null = "photo") => ({
  calendarId: id,
  photoKey: image ? "a".repeat(64) : null,
  image,
  unchanged: false,
});
function fixture() {
  const read = vi
    .fn<NonNullable<SharingCloudPort["getProfilePhoto"]>>()
    .mockImplementation(async (id) => response(id));
  const readable = vi.fn(() => true);
  const photos = createSharingProfilePhotos({ read, readable, changed: vi.fn() });
  photos.activate("account-a", true);
  return { photos, read, readable };
}
it("keeps calendar and analysis avatar windows independent when either view closes", async () => {
  const { photos, read } = fixture();
  await photos.load(["calendar"], "calendar-view");
  await photos.load(["analysis"], "analysis-view");
  expect(photos.uri("calendar")).not.toBeNull();
  expect(photos.uri("analysis")).not.toBeNull();
  await photos.load([], "analysis-view");
  expect(photos.uri("calendar")).not.toBeNull();
  expect(photos.uri("analysis")).toBeNull();
  read.mockClear();
  await photos.refresh();
  expect(read).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith("calendar", "a".repeat(64));
});
it("loads only eight requested avatars, deduplicates, and rechecks consent with a known key", async () => {
  const { photos, read } = fixture();
  await photos.load(Array.from({ length: 1000 }, (_, i) => String(i)));
  expect(read).toHaveBeenCalledTimes(8);
  await photos.load(["0"]);
  expect(read).toHaveBeenCalledTimes(8);
  expect(photos.uri("0")).toBe("data:image/jpeg;base64,photo");
  expect(photos.uri("1")).toBeNull();
  read.mockImplementation(async (id) => ({ ...response(id), image: null, unchanged: true }));
  await photos.refresh();
  expect(read).toHaveBeenLastCalledWith("0", "a".repeat(64));
  expect(photos.uri("0")).toBe("data:image/jpeg;base64,photo");
  read.mockImplementation(async (id) => response(id, null));
  await photos.refresh();
  expect(photos.uri("0")).toBeNull();
});
it("keeps at most two requests active and drops late images after account switches", async () => {
  const { photos, read } = fixture();
  const release: (() => void)[] = [];
  read.mockImplementation(
    (id) => new Promise((resolve) => release.push(() => resolve(response(id)))),
  );
  const first = photos.load(["1", "2", "3", "4"]);
  const duplicate = photos.load(["1", "2", "3", "4"]);
  expect(read).toHaveBeenCalledTimes(2);
  photos.activate("account-b", true);
  for (const done of release) done();
  await Promise.all([first, duplicate]);
  expect(read).toHaveBeenCalledTimes(2);
  expect(photos.uri("1")).toBeNull();
});
it("forgets failed, removed, signed-out and expired images without blocking calendar operations", async () => {
  const { photos, read, readable } = fixture();
  await photos.load(["one"]);
  read.mockRejectedValueOnce(new Error("SHARE_NETWORK_FAILED"));
  await photos.refresh();
  expect(photos.uri("one")).toBeNull();
  await photos.refresh();
  expect(photos.uri("one")).not.toBeNull();
  readable.mockReturnValue(false);
  expect(photos.uri("one")).toBeNull();
  readable.mockReturnValue(true);
  photos.forget("one");
  expect(photos.uri("one")).toBeNull();
  await photos.load(["one"]);
  photos.activate(null, false);
  expect(photos.uri("one")).toBeNull();
});
