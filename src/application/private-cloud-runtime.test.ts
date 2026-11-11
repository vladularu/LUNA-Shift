import { describe, expect, it, vi } from "vitest";
import { createPrivateCloudRuntime } from "./private-cloud-runtime";
import { sameCloudValue } from "@/domain/private-cloud-merge";
import {
  PrivateCloudConflictError,
  type CloudDeviceState,
  type CloudLocalPort,
  type PrivateCloudDocument,
  type PrivateCloudRemote,
  type PrivateCloudRevision,
} from "@/domain/private-cloud";

const doc = (ids: string[]): PrivateCloudDocument => ({
  format: "lunashift-private-cloud",
  version: 1,
  backupVersion: 20,
  databaseSchemaVersion: 33,
  data: { shifts: ids.map((id) => ({ id, title: id })) },
  presentation: { calendarImage: null, calendarImageStrength: "medium" },
});
const revision = (document: PrivateCloudDocument, number = 1): PrivateCloudRevision => ({
  document,
  revision: number,
  updatedAt: "2026-10-17T12:00:00.000Z",
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(bound = true) {
  let device = doc(["original"]);
  let cloud: PrivateCloudRevision | null = revision(device);
  let state: CloudDeviceState | null = bound
    ? { accountId: "a", baseline: cloud, pending: null }
    : null;
  let recovery: PrivateCloudDocument | null = null;
  const local: CloudLocalPort = {
    state: async () => state,
    capture: async () => structuredClone(device),
    bind: vi.fn(async (accountId, current) => {
      if (current()) state = { accountId, baseline: null, pending: null };
    }),
    stage: vi.fn(async (accountId, pending, current) => {
      if (state && current() && state.accountId === accountId) state = { ...state, pending };
    }),
    clearPending: vi.fn(async (accountId, current) => {
      if (state && current() && state.accountId === accountId) state = { ...state, pending: null };
    }),
    recovery: async () => recovery,
    apply: vi.fn(async (accountId, expected, incoming, current) => {
      if (
        !state ||
        !current() ||
        state.accountId !== accountId ||
        !sameCloudValue(expected, device)
      )
        return false;
      recovery = device;
      device = incoming.document;
      state = { ...state, baseline: incoming, pending: null };
      return true;
    }),
  };
  const receipts = new Map<string, PrivateCloudRevision>();
  const remote: PrivateCloudRemote = {
    read: vi.fn(async () => cloud),
    history: async () => (cloud ? [cloud] : []),
    write: vi.fn(async (input) => {
      const previous = receipts.get(input.mutationId);
      if (previous) return previous;
      if (input.expectedRevision !== (cloud?.revision ?? 0)) throw new PrivateCloudConflictError();
      cloud = revision(input.document, (cloud?.revision ?? 0) + 1);
      receipts.set(input.mutationId, cloud);
      return cloud;
    }),
  };
  const onApplied = vi.fn(async () => undefined);
  const make = () => {
    const runtime = createPrivateCloudRuntime({
      local,
      remote,
      validate: async () => undefined,
      makeId: () => crypto.randomUUID(),
      onApplied,
    });
    runtime.setAccount("a");
    return runtime;
  };
  return {
    local,
    remote,
    onApplied,
    make,
    setDevice: (value: PrivateCloudDocument) => {
      device = value;
    },
    setCloud: (value: PrivateCloudRevision | null) => {
      cloud = value;
    },
    setState: (value: CloudDeviceState | null) => {
      state = value;
    },
    getCloud: () => cloud,
    getDevice: () => device,
    getState: () => state,
  };
}

describe("private cloud account lifecycle", () => {
  it("uses the latest view refresh handler without replacing an in-flight runtime", async () => {
    const f = setup(false);
    f.setDevice(doc([]));
    const held = deferred<PrivateCloudRevision | null>();
    vi.mocked(f.remote.read).mockReturnValueOnce(held.promise);
    const runtime = f.make();
    const pending = runtime.synchronize();
    const latest = vi.fn(async () => undefined);
    runtime.setOnApplied(latest);
    held.resolve(revision(doc(["original"])));
    await pending;
    expect(latest).toHaveBeenCalledWith(doc([]), doc(["original"]));
    expect(f.onApplied).not.toHaveBeenCalled();
  });
  it("does not download personal snapshots or photos again when the remote revision is unchanged", async () => {
    const f = setup();
    f.remote.head = vi.fn(async () => ({ revision: 1, updatedAt: "2026-10-17T12:00:00Z" }));
    const runtime = f.make();
    await runtime.synchronize();
    expect(runtime.snapshot().phase).toBe("synced");
    expect(f.remote.read).not.toHaveBeenCalled();
    expect(f.remote.write).not.toHaveBeenCalled();
  });
  it("automatically adopts an identical cloud snapshot after sign-in without uploading it", async () => {
    const f = setup(false);
    const runtime = f.make();
    await runtime.synchronize();
    expect(runtime.snapshot().phase).toBe("synced");
    expect(f.remote.write).not.toHaveBeenCalled();
    expect(f.getState()?.accountId).toBe("a");
  });
  it("automatically creates the first backup and then synchronizes later local changes", async () => {
    const f = setup(false);
    f.setCloud(null);
    const runtime = f.make();
    await runtime.synchronize();
    expect(runtime.snapshot().phase).toBe("synced");
    expect(f.remote.write).toHaveBeenCalledTimes(1);
    expect(f.getState()?.baseline?.document).toEqual(doc(["original"]));
    f.setDevice(doc(["original", "later"]));
    await runtime.synchronize();
    expect(f.getState()?.baseline?.document).toEqual(doc(["original", "later"]));
  });
  it("automatically receives cloud data on an empty device without replacing the cloud", async () => {
    const f = setup(false);
    f.setDevice(doc([]));
    const runtime = f.make();
    await runtime.synchronize();
    expect(runtime.snapshot().phase).toBe("synced");
    expect(f.getDevice()).toEqual(doc(["original"]));
    expect(f.remote.write).not.toHaveBeenCalled();
    expect(f.onApplied).toHaveBeenCalledTimes(1);
    expect(f.onApplied).toHaveBeenCalledWith(doc([]), doc(["original"]));
  });
  it("requires a source choice before combining unrelated first-device data", async () => {
    const f = setup(false);
    f.setCloud(revision(doc(["other-device"])));
    const runtime = f.make();
    await runtime.synchronize();
    expect(runtime.snapshot()).toMatchObject({
      phase: "conflict",
      hasCloudData: true,
      requiresFullChoice: true,
    });
    expect(f.remote.write).not.toHaveBeenCalled();
    expect(f.local.apply).not.toHaveBeenCalled();
    expect(f.getDevice()).toEqual(doc(["original"]));
    expect(f.getCloud()?.document).toEqual(doc(["other-device"]));
    expect(f.getState()?.baseline).toBeNull();
  });
  it("requires a choice for competing initial edits and can resolve them", async () => {
    const f = setup(false);
    f.setCloud(
      revision({ ...doc([]), data: { shifts: [{ id: "original", title: "different" }] } }),
    );
    const runtime = f.make();
    await runtime.synchronize();
    expect(runtime.snapshot().phase).toBe("conflict");
    expect(f.remote.write).not.toHaveBeenCalled();
    expect(f.local.apply).not.toHaveBeenCalled();
    await runtime.synchronize("cloud");
    expect(runtime.snapshot().phase).toBe("synced");
    expect(f.getDevice().data.shifts).toEqual([{ id: "original", title: "different" }]);
  });
  it("retries automatic initial sync after going offline without losing device data", async () => {
    const f = setup(false);
    f.setCloud(null);
    vi.mocked(f.remote.read).mockRejectedValueOnce(new Error("offline"));
    const runtime = f.make();
    await runtime.synchronize();
    expect(runtime.snapshot().phase).toBe("error");
    expect(f.remote.write).not.toHaveBeenCalled();
    expect(f.getDevice()).toEqual(doc(["original"]));
    await runtime.synchronize();
    expect(runtime.snapshot().phase).toBe("synced");
  });
  it("requires a fresh choice when the signed-in account differs from the local owner", async () => {
    const f = setup();
    const runtime = f.make();
    runtime.setAccount("b");
    await runtime.synchronize();
    expect(runtime.snapshot().phase).toBe("setup");
    expect(f.getState()?.accountId).toBe("a");
    expect(f.remote.write).not.toHaveBeenCalled();
  });
  it("merges independent offline edits without discarding either device", async () => {
    const f = setup();
    f.setDevice(doc(["original", "device"]));
    f.setCloud(revision(doc(["original", "cloud"]), 2));
    const runtime = f.make();
    await runtime.synchronize();
    expect(runtime.snapshot().phase).toBe("synced");
    expect((f.getDevice().data.shifts as { id: string }[]).map((row) => row.id).sort()).toEqual([
      "cloud",
      "device",
      "original",
    ]);
  });
  it("does not overwrite device changes made while an upload was in flight", async () => {
    const f = setup();
    f.setDevice(doc(["original", "first"]));
    const receipt = deferred<PrivateCloudRevision>();
    vi.mocked(f.remote.write).mockImplementationOnce(async () => receipt.promise);
    const runtime = f.make();
    const work = runtime.synchronize();
    await vi.waitFor(() => expect(f.remote.write).toHaveBeenCalled());
    f.setDevice(doc(["original", "first", "later"]));
    f.setCloud(revision(doc(["original", "first"]), 2));
    receipt.resolve(revision(doc(["original", "first"]), 2));
    await work;
    expect(f.getDevice()).toEqual(doc(["original", "first", "later"]));
    expect(runtime.snapshot().phase).toBe("error");
    expect(f.onApplied).not.toHaveBeenCalled();
    await runtime.synchronize();
    expect(runtime.snapshot().phase).toBe("synced");
    const shifts = f.getDevice().data.shifts;
    expect(Array.isArray(shifts) && shifts.map((row) => (row as { id: string }).id).sort()).toEqual(
      ["first", "later", "original"],
    );
  });
  it("ignores an old account response after logout", async () => {
    const f = setup();
    const incoming = deferred<PrivateCloudRevision | null>();
    vi.mocked(f.remote.read).mockImplementationOnce(() => incoming.promise);
    const runtime = f.make();
    const work = runtime.synchronize();
    await vi.waitFor(() => expect(f.remote.read).toHaveBeenCalled());
    runtime.setAccount(null);
    incoming.resolve(revision(doc(["foreign"]), 2));
    await work;
    expect(f.getDevice()).toEqual(doc(["original"]));
    expect(f.local.apply).not.toHaveBeenCalled();
    expect(runtime.snapshot().phase).toBe("signed_out");
  });
  it("replays a persisted upload with the same mutation id after a lost response and restart", async () => {
    const f = setup();
    f.setDevice(doc(["original", "offline"]));
    const receipt = revision(doc(["original", "offline"]), 2);
    vi.mocked(f.remote.write)
      .mockRejectedValueOnce(new Error("lost response"))
      .mockResolvedValue(receipt);
    const first = f.make();
    await first.synchronize();
    const pending = f.getState()?.pending;
    expect(pending).not.toBeNull();
    f.setCloud(receipt);
    const second = f.make();
    await second.synchronize();
    expect(vi.mocked(f.remote.write).mock.calls[1][0].mutationId).toBe(pending?.mutationId);
    expect(second.snapshot().phase).toBe("synced");
  });
  it("recovers from a stale pending mutation without retrying it forever", async () => {
    const f = setup();
    f.setDevice(doc(["original", "device"]));
    vi.mocked(f.remote.write).mockRejectedValueOnce(new Error("offline"));
    const runtime = f.make();
    await runtime.synchronize();
    f.setCloud(revision(doc(["original", "remote"]), 2));
    await runtime.synchronize();
    expect(runtime.snapshot().phase).toBe("synced");
    expect(f.getState()?.pending).toBeNull();
  });
  it("uses the complete selected cloud snapshot after competing edits", async () => {
    const f = setup();
    f.setDevice(doc(["device"]));
    f.setCloud(
      revision(
        {
          ...doc(["cloud", "original"]),
          data: {
            shifts: [
              { id: "cloud", title: "cloud" },
              { id: "original", title: "edited" },
            ],
          },
        },
        2,
      ),
    );
    const runtime = f.make();
    await runtime.synchronize();
    expect(runtime.snapshot().phase).toBe("conflict");
    expect(f.remote.write).not.toHaveBeenCalled();
    await runtime.synchronize("cloud");
    expect(runtime.snapshot().phase).toBe("synced");
    expect((f.getDevice().data.shifts as { id: string }[]).map((row) => row.id).sort()).toEqual([
      "cloud",
      "original",
    ]);
  });
  it("keeps repeated initial polls and restarts read-only until a source is chosen", async () => {
    const f = setup(false);
    f.setCloud(revision(doc(["cloud-plan"])));
    const first = f.make();
    await first.synchronize();
    await first.synchronize();
    const restarted = f.make();
    await restarted.synchronize();
    expect(restarted.snapshot().phase).toBe("conflict");
    expect(f.remote.write).not.toHaveBeenCalled();
    expect(f.local.apply).not.toHaveBeenCalled();
    expect(f.getState()?.baseline).toBeNull();
  });
  it("adopts a cloud snapshot already containing all device data without uploading a union", async () => {
    const f = setup(false);
    const cloud = doc(["cloud-plan", "original"]);
    f.setCloud(revision(cloud));
    const runtime = f.make();
    await runtime.synchronize();
    expect(runtime.snapshot().phase).toBe("synced");
    expect(f.getDevice()).toEqual(cloud);
    expect(f.remote.write).not.toHaveBeenCalled();
  });
  it("does not mix distinct same-day shift IDs or appointments when cloud data is selected", async () => {
    const f = setup(false);
    const cloud: PrivateCloudDocument = {
      ...doc([]),
      data: {
        shifts: [
          { id: "cloud-school", date: "2026-12-09", title: "Schule" },
          { id: "cloud-am", date: "2026-12-14", title: "Früh" },
          { id: "cloud-pm", date: "2026-12-14", title: "Spät" },
        ],
        appointments: [{ id: "cloud-appointment" }],
      },
    };
    const device: PrivateCloudDocument = {
      ...doc([]),
      data: {
        shifts: [
          { id: "preview-school-copy", date: "2026-12-09", title: "Schule" },
          { id: "preview-night", date: "2026-12-09", title: "Nacht" },
        ],
        appointments: [{ id: "preview-appointment" }],
      },
    };
    f.setDevice(device);
    f.setCloud(revision(cloud));
    const runtime = f.make();
    await runtime.synchronize();
    expect(runtime.snapshot().phase).toBe("conflict");
    expect(f.remote.write).not.toHaveBeenCalled();
    await runtime.synchronize("cloud");
    expect(f.getDevice()).toEqual(cloud);
    expect(f.getCloud()?.document).toEqual(cloud);
    expect(f.remote.write).not.toHaveBeenCalled();
    expect(await f.local.recovery()).toEqual(device);
    await runtime.synchronize();
    expect(f.getDevice()).toEqual(cloud);
  });
  it("uses only current device data after an explicit device source choice", async () => {
    const f = setup(false);
    f.setCloud(revision(doc(["cloud-plan"])));
    const runtime = f.make();
    await runtime.synchronize();
    expect(f.remote.write).not.toHaveBeenCalled();
    await runtime.synchronize("device");
    expect(f.getCloud()?.document).toEqual(doc(["original"]));
    expect(f.remote.write).toHaveBeenCalledTimes(1);
  });
  it("does not retain unsynced device additions after a complete cloud source choice", async () => {
    const f = setup();
    f.setDevice(doc(["original", "device-only"]));
    f.setCloud(revision(doc(["cloud-only", "original"]), 2));
    const runtime = f.make();
    await runtime.synchronize("cloud");
    expect(f.getDevice()).toEqual(doc(["cloud-only", "original"]));
    expect(f.remote.write).not.toHaveBeenCalled();
  });
  it("uses the complete device snapshot after an explicit choice with a shared baseline", async () => {
    const f = setup();
    const device = doc(["original", "device-only"]);
    f.setDevice(device);
    f.setCloud(revision(doc(["cloud-only", "original"]), 2));
    await f.make().synchronize("device");
    expect(f.getDevice()).toEqual(device);
    expect(f.getCloud()?.document).toEqual(device);
    expect(f.remote.write).toHaveBeenCalledTimes(1);
    expect(vi.mocked(f.remote.write).mock.calls[0][0].expectedRevision).toBe(2);
  });
  it("does not replay a legacy unbased union upload before initial source selection", async () => {
    const f = setup(false);
    const cloud = revision(doc(["cloud-plan"]));
    f.setCloud(cloud);
    f.setState({
      accountId: "a",
      baseline: null,
      pending: {
        expectedRevision: 1,
        mutationId: "legacy-union",
        document: doc(["cloud-plan", "original"]),
        sourceDocument: doc(["original"]),
      },
    });
    const runtime = f.make();
    await runtime.synchronize();
    await runtime.synchronize();
    expect(runtime.snapshot().phase).toBe("conflict");
    expect(f.remote.write).not.toHaveBeenCalled();
    expect(f.getCloud()).toEqual(cloud);
    await runtime.synchronize("cloud");
    expect(f.local.clearPending).toHaveBeenCalledTimes(1);
    expect(f.remote.write).not.toHaveBeenCalled();
    expect(f.getDevice()).toEqual(cloud.document);
    expect(f.getState()?.pending).toBeNull();
  });
  it("abandons a pending upload before an explicit cloud source choice", async () => {
    const f = setup();
    const baseline = f.getState()!.baseline;
    f.setDevice(doc(["original", "unwanted-device-plan"]));
    f.setState({
      accountId: "a",
      baseline,
      pending: {
        expectedRevision: 1,
        mutationId: "abandoned-upload",
        document: f.getDevice(),
        sourceDocument: f.getDevice(),
      },
    });
    const runtime = f.make();
    await runtime.synchronize("cloud");
    expect(f.local.clearPending).toHaveBeenCalledTimes(1);
    expect(f.remote.write).not.toHaveBeenCalled();
    expect(f.getDevice()).toEqual(doc(["original"]));
    expect(f.getState()?.pending).toBeNull();
  });
  it("drops an unbased abandoned union when device and cloud already agree", async () => {
    const f = setup(false);
    f.setState({
      accountId: "a",
      baseline: null,
      pending: {
        expectedRevision: 1,
        mutationId: "obsolete-union",
        document: doc(["original", "obsolete-extra"]),
        sourceDocument: doc(["original"]),
      },
    });
    const runtime = f.make();
    await runtime.synchronize();
    expect(runtime.snapshot().phase).toBe("synced");
    expect(f.remote.write).not.toHaveBeenCalled();
    expect(f.getCloud()?.document).toEqual(doc(["original"]));
    expect(f.getState()?.pending).toBeNull();
  });
  it("does not recreate a missing cloud from an abandoned unbased union", async () => {
    const f = setup(false);
    f.setCloud(null);
    f.setState({
      accountId: "a",
      baseline: null,
      pending: {
        expectedRevision: 1,
        mutationId: "missing-cloud-union",
        document: doc(["original", "obsolete-extra"]),
        sourceDocument: doc(["original"]),
      },
    });
    const runtime = f.make();
    await runtime.synchronize();
    expect(runtime.snapshot().phase).toBe("error");
    expect(f.remote.write).not.toHaveBeenCalled();
    expect(f.getDevice()).toEqual(doc(["original"]));
    await runtime.synchronize("device");
    expect(runtime.snapshot().phase).toBe("synced");
    expect(f.getCloud()?.document).toEqual(doc(["original"]));
  });
  it("replays a safe first-backup upload with the same mutation after an offline failure", async () => {
    const f = setup(false);
    f.setCloud(null);
    vi.mocked(f.remote.write).mockRejectedValueOnce(new Error("offline"));
    await f.make().synchronize();
    const pending = f.getState()!.pending!;
    expect(pending.expectedRevision).toBe(0);
    const restarted = f.make();
    await restarted.synchronize();
    expect(restarted.snapshot().phase).toBe("synced");
    expect(vi.mocked(f.remote.write).mock.calls[1][0].mutationId).toBe(pending.mutationId);
  });
});
