import type { SharingCloudPort } from "@/domain/calendar-sharing-ports";

/** Bounded, session-only cache. Images never enter SQLite, exports or the publication queue. */
export function createSharingProfilePhotos(options: {
  read: NonNullable<SharingCloudPort["getProfilePhoto"]>;
  readable: (id: string) => boolean;
  changed: () => void;
}) {
  let identity: string | null = null;
  let enabled = false;
  let epoch = 0;
  let targets = new Set<string>();
  const views = new Map<string, readonly string[]>();
  const photos = new Map<string, { key: string | null; uri: string | null }>();
  type Job = { id: string; ticket: number; done: () => void; promise: Promise<void> };
  const pending = new Map<string, Job>();
  let queue: Job[] = [];
  let workers = 0;
  function drain() {
    while (workers < 2 && queue.length) {
      const job = queue.shift()!;
      workers++;
      void (async () => {
        try {
          if (job.ticket !== epoch || !targets.has(job.id) || !options.readable(job.id)) return;
          const previous = photos.get(job.id);
          const result = await options.read(job.id, previous?.key ?? null);
          if (job.ticket !== epoch || !targets.has(job.id) || !options.readable(job.id)) return;
          const uri =
            result.unchanged && previous && result.photoKey === previous.key
              ? previous.uri
              : result.image
                ? `data:image/jpeg;base64,${result.image}`
                : null;
          photos.set(job.id, { key: result.photoKey, uri });
          options.changed();
        } catch {
          if (job.ticket === epoch) {
            photos.delete(job.id);
            options.changed();
          }
        } finally {
          if (pending.get(job.id) === job) pending.delete(job.id);
          workers--;
          job.done();
          drain();
        }
      })();
    }
  }
  async function schedule(ids: readonly string[], refresh = false) {
    const next = new Set(
      enabled && identity ? [...new Set(ids.filter(options.readable))].slice(0, 16) : [],
    );
    targets = next;
    // Fast scrolling must not accumulate an unbounded backlog behind slow requests.
    queue = queue.filter((job) => {
      if (job.ticket === epoch && next.has(job.id)) return true;
      if (pending.get(job.id) === job) pending.delete(job.id);
      job.done();
      return false;
    });
    let removed = false;
    for (const id of photos.keys())
      if (!next.has(id)) {
        photos.delete(id);
        removed = true;
      }
    if (removed) options.changed();
    const jobs: Promise<void>[] = [];
    for (const id of next) {
      const existing = pending.get(id);
      if (existing?.ticket === epoch) {
        jobs.push(existing.promise);
        continue;
      }
      if (!refresh && photos.has(id)) continue;
      let done = () => {};
      const promise = new Promise<void>((resolve) => {
        done = resolve;
      });
      const job = { id, ticket: epoch, done, promise };
      pending.set(id, job);
      queue.push(job);
      jobs.push(promise);
    }
    drain();
    await Promise.all(jobs);
  }
  return {
    activate(accountId: string | null, available: boolean) {
      if (identity === accountId && enabled === available) return;
      identity = accountId;
      enabled = available;
      epoch++;
      targets.clear();
      views.clear();
      photos.clear();
      pending.clear();
      for (const job of queue) job.done();
      queue = [];
    },
    load(ids: readonly string[], viewId = "default") {
      if (ids.length) views.set(viewId, ids.filter(options.readable).slice(0, 8));
      else views.delete(viewId);
      return schedule([...views.values()].reverse().flat());
    },
    refresh: () => schedule([...targets], true),
    drop() {
      epoch++;
      photos.clear();
      pending.clear();
      for (const job of queue) job.done();
      queue = [];
    },
    forget(id: string) {
      targets.delete(id);
      photos.delete(id);
    },
    uri: (id: string) => (options.readable(id) ? (photos.get(id)?.uri ?? null) : null),
  };
}
