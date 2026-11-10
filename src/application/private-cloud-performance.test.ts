import { describe, expect, it, vi } from "vitest";
import { createPrivateCloudRuntime } from "./private-cloud-runtime";
import { sameCloudValue } from "@/domain/private-cloud-merge";
import {
  PrivateCloudConflictError,
  type CloudDeviceState,
  type CloudLocalPort,
  type PrivateCloudDocument,
  type PrivateCloudRevision,
} from "@/domain/private-cloud";

const document = (): PrivateCloudDocument => ({
  format: "lunashift-private-cloud",
  version: 1,
  backupVersion: 20,
  databaseSchemaVersion: 33,
  data: { shifts: [{ id: "original", title: "Original" }] },
  presentation: { calendarImage: null, calendarImageStrength: "medium" },
});
const revision = (value: PrivateCloudDocument, number = 1): PrivateCloudRevision => ({
  document: structuredClone(value),
  revision: number,
  updatedAt: "2026-10-17T12:00:00Z",
});
function setup(initial = document()) {
  let device = structuredClone(initial);
  let cloud: PrivateCloudRevision | null = revision(initial);
  let state: CloudDeviceState = { accountId: "a", baseline: structuredClone(cloud), pending: null };
  let active = true;
  const local: CloudLocalPort = {
    state: async () => structuredClone(state),
    capture: vi.fn(async () => structuredClone(device)),
    bind: vi.fn(async () => undefined),
    stage: vi.fn(async (_actor, pending, current) => {
      if (current()) state = { ...state, pending };
    }),
    clearPending: async () => {
      state = { ...state, pending: null };
    },
    recovery: async () => null,
    apply: vi.fn(async (_actor, expected, incoming, current) => {
      if (!current() || !sameCloudValue(expected, device)) return false;
      device = structuredClone(incoming.document);
      state = { ...state, baseline: structuredClone(incoming), pending: null };
      return true;
    }),
  };
  const remote = {
    head: vi.fn(async () => cloud && { revision: cloud.revision, updatedAt: cloud.updatedAt }),
    read: vi.fn(async () => structuredClone(cloud)),
    write: vi.fn(async (input: { expectedRevision: number; document: PrivateCloudDocument }) => {
      if (input.expectedRevision !== (cloud?.revision ?? 0)) throw new PrivateCloudConflictError();
      cloud = revision(input.document, (cloud?.revision ?? 0) + 1);
      return structuredClone(cloud);
    }),
    history: async () => [],
  };
  const validate = vi.fn(async (_value: PrivateCloudDocument) => undefined);
  const onApplied = vi.fn(async () => undefined);
  const runtime = createPrivateCloudRuntime({
    local,
    remote,
    validate,
    onApplied,
    makeId: () => "new-mutation",
    canSynchronize: () => active,
  });
  runtime.setAccount("a");
  return {
    runtime,
    local,
    remote,
    validate,
    onApplied,
    device: () => structuredClone(device),
    state: () => structuredClone(state),
    setDevice: (value: PrivateCloudDocument) => {
      device = structuredClone(value);
    },
    setCloud: (value: PrivateCloudRevision | null) => {
      cloud = structuredClone(value);
    },
    setState: (value: CloudDeviceState) => {
      state = structuredClone(value);
    },
    setActive: (value: boolean) => {
      active = value;
    },
  };
}

describe("unchanged private-cloud polls", () => {
  it("suspends polling when disallowed and stops notifying removed subscribers", async () => {
    const f = setup();
    const phases: string[] = [];
    const stop = f.runtime.subscribe(() => phases.push(f.runtime.snapshot().phase));
    expect(f.runtime.isCurrentAccount("a")).toBe(true);
    expect(f.runtime.isCurrentAccount("b")).toBe(false);
    f.runtime.setAllowed(false);
    f.runtime.setAllowed(false);
    await f.runtime.synchronize();
    expect(f.remote.head).not.toHaveBeenCalled();
    f.runtime.setAllowed(true);
    await f.runtime.synchronize();
    expect(phases).toEqual(["syncing", "synced"]);
    stop();
    await f.runtime.synchronize();
    expect(phases).toEqual(["syncing", "synced"]);
  });
  it("does not read local or remote data when the cloud service is disabled or signed out", async () => {
    const f = setup();
    const runtime = createPrivateCloudRuntime({
      local: f.local,
      remote: null,
      validate: f.validate,
      onApplied: f.onApplied,
      makeId: () => "unused",
    });
    runtime.setAccount("a");
    await runtime.synchronize();
    expect(runtime.snapshot().phase).toBe("disabled");
    runtime.setAccount(null);
    await runtime.synchronize();
    expect(runtime.snapshot().phase).toBe("signed_out");
    expect(f.local.capture).not.toHaveBeenCalled();
  });
  it("coalesces overlapping polls into one server head and one fresh local capture", async () => {
    const f = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.remote.head.mockImplementationOnce(async () => {
      await gate;
      return { revision: 1, updatedAt: "2026-10-17T12:00:00Z" };
    });
    const first = f.runtime.synchronize(),
      second = f.runtime.synchronize();
    await vi.waitFor(() => expect(f.remote.head).toHaveBeenCalledOnce());
    release();
    await Promise.all([first, second]);
    expect(f.local.capture).toHaveBeenCalledOnce();
    expect(f.validate).toHaveBeenCalledOnce();
    expect(f.runtime.snapshot().phase).toBe("synced");
  });
  it("does not complete an old poll after synchronization is disallowed during validation", async () => {
    const f = setup();
    f.validate.mockImplementationOnce(async () => {
      f.runtime.setAllowed(false);
    });
    await f.runtime.synchronize();
    expect(f.runtime.snapshot().phase).not.toBe("synced");
    expect(f.local.apply).not.toHaveBeenCalled();
    expect(f.remote.write).not.toHaveBeenCalled();
    f.runtime.setAllowed(true);
    await f.runtime.synchronize();
    expect(f.runtime.snapshot().phase).toBe("synced");
  });
  it("takes one fresh snapshot and validates it without entering the write/apply path", async () => {
    const f = setup(),
      before = f.state();
    await f.runtime.synchronize();
    expect(f.runtime.snapshot().phase).toBe("synced");
    expect(f.local.capture).toHaveBeenCalledOnce();
    expect(f.validate).toHaveBeenCalledOnce();
    expect(f.remote.head).toHaveBeenCalledOnce();
    expect(f.remote.read).not.toHaveBeenCalled();
    expect(f.remote.write).not.toHaveBeenCalled();
    expect(f.local.stage).not.toHaveBeenCalled();
    expect(f.local.apply).not.toHaveBeenCalled();
    expect(f.onApplied).not.toHaveBeenCalled();
    expect(f.state()).toEqual(before);
  });
  it("rechecks the server and local snapshot on every poll instead of caching an unchanged result", async () => {
    const f = setup();
    await f.runtime.synchronize();
    await f.runtime.synchronize();
    expect(f.remote.head).toHaveBeenCalledTimes(2);
    expect(f.local.capture).toHaveBeenCalledTimes(2);
    expect(f.validate).toHaveBeenCalledTimes(2);
    expect(f.local.apply).not.toHaveBeenCalled();
  });
  it("still rejects an invalid unchanged document", async () => {
    const f = setup();
    f.validate.mockRejectedValueOnce(new Error("invalid snapshot"));
    await f.runtime.synchronize();
    expect(f.runtime.snapshot().phase).toBe("conflict");
    expect(f.local.apply).not.toHaveBeenCalled();
    expect(f.remote.write).not.toHaveBeenCalled();
  });
  it("uploads and applies a local change despite an unchanged remote revision", async () => {
    const f = setup();
    const next = { ...f.device(), data: { shifts: [{ id: "original", title: "Edited" }] } };
    f.setDevice(next);
    await f.runtime.synchronize();
    expect(f.runtime.snapshot().phase).toBe("synced");
    expect(f.remote.write).toHaveBeenCalledOnce();
    expect(f.local.apply).toHaveBeenCalledOnce();
    expect(f.state().baseline?.document).toEqual(next);
  });
  it("persists a new remote revision even when its document is identical", async () => {
    const f = setup();
    f.setCloud(revision(f.device(), 2));
    await f.runtime.synchronize();
    expect(f.remote.read).toHaveBeenCalledOnce();
    expect(f.local.apply).toHaveBeenCalledOnce();
    expect(f.state().baseline?.revision).toBe(2);
    expect(f.remote.write).not.toHaveBeenCalled();
  });
  it("applies actual remote changes and requests the existing reload", async () => {
    const f = setup();
    const next = { ...f.device(), data: { shifts: [{ id: "original", title: "Remote edit" }] } };
    f.setCloud(revision(next, 2));
    await f.runtime.synchronize();
    expect(f.runtime.snapshot().phase).toBe("synced");
    expect(f.device()).toEqual(next);
    expect(f.local.apply).toHaveBeenCalledOnce();
    expect(f.onApplied).toHaveBeenCalledOnce();
  });
  it("finishes a persisted retry even when device, baseline and server contain identical data", async () => {
    const f = setup();
    f.setState({
      ...f.state(),
      pending: {
        expectedRevision: 0,
        mutationId: "retry-id",
        document: f.device(),
        sourceDocument: f.device(),
      },
    });
    f.remote.write.mockResolvedValueOnce(revision(f.device()));
    await f.runtime.synchronize();
    expect(f.remote.write).toHaveBeenCalledWith(
      expect.objectContaining({ mutationId: "retry-id" }),
    );
    expect(f.local.apply).toHaveBeenCalledOnce();
    expect(f.state().pending).toBeNull();
    expect(f.runtime.snapshot().phase).toBe("synced");
  });
  it("establishes a durable baseline on a device that does not have one", async () => {
    const f = setup();
    f.setState({ ...f.state(), baseline: null });
    await f.runtime.synchronize();
    expect(f.local.apply).toHaveBeenCalledOnce();
    expect(f.state().baseline?.revision).toBe(1);
  });
  it("keeps the existing apply path when remote head support is unavailable", async () => {
    const f = setup();
    Object.assign(f.remote, { head: undefined });
    await f.runtime.synchronize();
    expect(f.remote.read).toHaveBeenCalledOnce();
    expect(f.local.apply).toHaveBeenCalledOnce();
  });
  it("preserves omitted account photos through the existing merge for changed documents", async () => {
    const initial = document();
    const f = setup({
      ...initial,
      presentation: { ...initial.presentation, accountPhoto: "private-photo" },
    });
    f.setDevice(initial);
    await f.runtime.synchronize();
    expect(f.device().presentation.accountPhoto).toBe("private-photo");
    expect(f.local.apply).toHaveBeenCalledOnce();
    expect(f.remote.write).not.toHaveBeenCalled();
  });
  it("ignores completion after sign-out during validation", async () => {
    const f = setup();
    f.validate.mockImplementationOnce(async () => {
      f.runtime.setAccount(null);
    });
    await f.runtime.synchronize();
    expect(f.runtime.snapshot().phase).toBe("signed_out");
    expect(f.local.apply).not.toHaveBeenCalled();
    expect(f.remote.write).not.toHaveBeenCalled();
  });
  it("does not apply after entering the background during validation", async () => {
    const f = setup();
    f.validate.mockImplementationOnce(async () => {
      f.setActive(false);
    });
    await f.runtime.synchronize();
    expect(f.runtime.snapshot().phase).not.toBe("synced");
    expect(f.local.apply).not.toHaveBeenCalled();
  });
  it("preserves edits made during an unchanged poll and uploads them on the next poll", async () => {
    const f = setup();
    const edited = { ...f.device(), data: { shifts: [{ id: "original", title: "Late edit" }] } };
    f.validate.mockImplementationOnce(async () => {
      f.setDevice(edited);
    });
    await f.runtime.synchronize();
    expect(f.device()).toEqual(edited);
    expect(f.local.apply).not.toHaveBeenCalled();
    expect(f.remote.write).not.toHaveBeenCalled();
    await f.runtime.synchronize();
    expect(f.runtime.snapshot().phase).toBe("synced");
    expect(f.state().baseline?.document).toEqual(edited);
  });
  it("reports a missing cloud head instead of accepting a stale baseline", async () => {
    const f = setup(),
      before = f.state();
    f.setCloud(null);
    await f.runtime.synchronize();
    expect(f.runtime.snapshot().phase).toBe("error");
    expect(f.state()).toEqual(before);
    expect(f.remote.write).not.toHaveBeenCalled();
  });
});
