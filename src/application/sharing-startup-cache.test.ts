import { expect, it, vi } from "vitest";
import type { CachedSharedCalendar } from "@/domain/calendar-sharing";
import type { SharingAuthUser } from "@/domain/calendar-sharing-ports";
import { createSharingStartupCache } from "./sharing-startup-cache";

const user = { id: "account", displayName: "Alex" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  let notify: (value: SharingAuthUser | null) => void = () => {};
  const unsubscribe = vi.fn();
  const auth = {
    isConfigured: true,
    getCachedSession: vi.fn(async () => user),
    subscribe: vi.fn((listener: typeof notify) => {
      notify = listener;
      return unsubscribe;
    }),
  };
  const readCaches = vi.fn(async (_id: string): Promise<readonly CachedSharedCalendar[]> => []);
  return { auth, readCaches, unsubscribe, change: (next: SharingAuthUser | null) => notify(next) };
}
it("starts the read early, consumes it once, and reads fresh caches on a later activation", async () => {
  const f = fixture();
  const pending = deferred<readonly CachedSharedCalendar[]>();
  f.readCaches.mockReturnValueOnce(pending.promise);
  const cache = createSharingStartupCache(f.auth, f.readCaches);
  expect(f.readCaches).not.toHaveBeenCalled();
  cache.start();
  await vi.waitFor(() => expect(f.readCaches).toHaveBeenCalledWith(user.id));
  const first = cache.take();
  pending.resolve([]);
  expect(await first).toEqual({ accountId: user.id, calendars: [] });
  expect(f.readCaches).toHaveBeenCalledTimes(1);
  await cache.take();
  expect(f.readCaches).toHaveBeenCalledTimes(2);
  cache.stop();
  expect(f.unsubscribe).toHaveBeenCalledTimes(1);
});
it.each([null, { id: "next", displayName: "Sam" }])(
  "fences an account change during the cache read: %s",
  async (next) => {
    const f = fixture();
    const pending = deferred<readonly CachedSharedCalendar[]>();
    f.readCaches.mockReturnValueOnce(pending.promise);
    const cache = createSharingStartupCache(f.auth, f.readCaches);
    cache.start();
    await vi.waitFor(() => expect(f.readCaches).toHaveBeenCalled());
    f.change(next);
    pending.resolve([]);
    expect(await cache.take()).toEqual({ accountId: next?.id ?? null, calendars: [] });
    expect(f.readCaches).toHaveBeenCalledTimes(next ? 2 : 1);
    cache.stop();
  },
);
it("rejects a completed warm result if sign-out happens before consumption", async () => {
  const f = fixture();
  const cache = createSharingStartupCache(f.auth, f.readCaches);
  cache.start();
  await vi.waitFor(() => expect(f.readCaches).toHaveBeenCalled());
  f.change(null);
  expect(await cache.take()).toEqual({ accountId: null, calendars: [] });
  cache.stop();
});
it("does not repeat a local read for the same account's initial-session/token event", async () => {
  const f = fixture();
  const pending = deferred<readonly CachedSharedCalendar[]>();
  f.readCaches.mockReturnValue(pending.promise);
  const cache = createSharingStartupCache(f.auth, f.readCaches);
  cache.start();
  await vi.waitFor(() => expect(f.readCaches).toHaveBeenCalled());
  f.change(user);
  pending.resolve([]);
  await cache.take();
  expect(f.readCaches).toHaveBeenCalledTimes(1);
  cache.stop();
});
it("propagates real storage errors and cancels pending identity reads on stop", async () => {
  const f = fixture();
  f.readCaches.mockRejectedValue(new Error("disk full"));
  const cache = createSharingStartupCache(f.auth, f.readCaches);
  cache.start();
  await expect(cache.take()).rejects.toThrow("disk full");
  cache.stop();
  const identity = deferred<SharingAuthUser>();
  f.auth.getCachedSession.mockReturnValue(identity.promise);
  cache.start();
  cache.stop();
  identity.resolve(user);
  expect(await cache.take()).toEqual({ accountId: null, calendars: [] });
  expect(f.readCaches).toHaveBeenCalledTimes(1);
});
