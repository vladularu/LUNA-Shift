import { mergePrivateCloudDocuments, sameCloudValue } from "@/domain/private-cloud-merge";
import {
  PrivateCloudConflictError,
  type CloudJson,
  type CloudLocalPort,
  type PrivateCloudDocument,
  type PrivateCloudRemote,
  type PrivateCloudRevision,
} from "@/domain/private-cloud";
import { UserFacingError, userFacingErrorMessage } from "@/domain/errors";

export interface PrivateCloudStatus {
  readonly phase: "signed_out" | "disabled" | "setup" | "syncing" | "synced" | "conflict" | "error";
  readonly lastSyncedAt: string | null;
  readonly conflictCount: number;
  readonly hasCloudData: boolean;
  readonly requiresFullChoice: boolean;
  readonly message: string | null;
}
export function createPrivateCloudRuntime(options: {
  readonly local: CloudLocalPort;
  readonly remote: PrivateCloudRemote | null;
  readonly makeId: () => string;
  readonly validate: (document: PrivateCloudDocument) => Promise<void>;
  readonly onApplied: () => Promise<void>;
  readonly canSynchronize?: () => boolean;
}) {
  let accountId: string | null = null;
  let generation = 0;
  let allowed = true;
  let busy: Promise<void> | null = null;
  let status: PrivateCloudStatus = {
    phase: "signed_out",
    lastSyncedAt: null,
    conflictCount: 0,
    hasCloudData: false,
    requiresFullChoice: false,
    message: null,
  };
  const listeners = new Set<() => void>();
  const update = (next: Partial<PrivateCloudStatus>) => {
    status = { ...status, ...next };
    for (const notify of listeners) notify();
  };
  async function synchronize(choice?: "device" | "cloud") {
    if (busy) return busy;
    const actor = accountId;
    const run = generation;
    const current = () =>
      actor !== null &&
      allowed &&
      accountId === actor &&
      generation === run &&
      (options.canSynchronize?.() ?? true);
    if (!actor || !current()) return;
    if (!options.remote) {
      update({ phase: "disabled" });
      return;
    }
    const remote = options.remote;
    async function readCurrent(baseline: PrivateCloudRevision | null) {
      if (remote.head) {
        const head = await remote.head(actor!);
        if (!head) return null;
        if (baseline?.revision === head.revision) return baseline;
      }
      return remote.read(actor!);
    }
    busy = (async () => {
      try {
        update({ phase: "syncing", message: null });
        let state = await options.local.state();
        if (!current()) return;
        // Never send a previous account's local data to another identity automatically.
        if (state && state.accountId !== actor && !choice) {
          const cloud = remote.head ? await remote.head(actor) : await remote.read(actor);
          if (current()) update({ phase: "setup", hasCloudData: cloud !== null });
          return;
        }
        if (state?.accountId !== actor) {
          await options.local.bind(actor, current);
          state = await options.local.state();
        }
        if (!current() || state?.accountId !== actor) return;
        let mergeBase = state.baseline?.document ?? null;
        if (state.pending) {
          try {
            const receipt = await remote.write({ accountId: actor, ...state.pending });
            mergeBase = state.pending.sourceDocument;
            if (!state.baseline) state = { ...state, baseline: receipt };
          } catch (error) {
            if (!(error instanceof PrivateCloudConflictError)) throw error;
            if (!current()) return;
            await options.local.clearPending(actor, current);
          }
          if (!current()) return;
        }
        const cloud = await readCurrent(state.baseline);
        if (!current()) return;
        const device = await options.local.capture();
        if (!current()) return;
        let merged = device;
        if (!state.baseline) {
          if (choice === "cloud") {
            if (!cloud) throw new UserFacingError("Für dieses Konto gibt es noch keine Sicherung.");
            merged = cloud.document;
          } else if (!choice && cloud) {
            // No previous shared baseline: additions can merge, competing values cannot.
            // Empty keyed collections do not infer deletions on either device.
            const initialBase: PrivateCloudDocument = {
              ...device,
              data: Object.fromEntries(
                Object.entries(device.data).flatMap<[string, CloudJson]>(([key, value]) =>
                  Array.isArray(value) ? [[key, []]] : value === null ? [[key, null]] : [],
                ),
              ),
              presentation: { calendarImage: null, calendarImageStrength: "medium" },
            };
            const result = mergePrivateCloudDocuments(initialBase, device, cloud.document);
            if (result.conflicts.length) {
              update({
                phase: "conflict",
                conflictCount: result.conflicts.length,
                hasCloudData: true,
                requiresFullChoice: true,
              });
              return;
            }
            merged = result.document;
          }
        } else if (cloud && choice && status.requiresFullChoice) {
          merged = choice === "cloud" ? cloud.document : device;
        } else if (cloud) {
          const result =
            choice === "cloud"
              ? mergePrivateCloudDocuments(
                  mergeBase ?? state.baseline.document,
                  cloud.document,
                  device,
                )
              : mergePrivateCloudDocuments(
                  mergeBase ?? state.baseline.document,
                  device,
                  cloud.document,
                );
          if (result.conflicts.length && !choice) {
            update({
              phase: "conflict",
              conflictCount: result.conflicts.length,
              hasCloudData: true,
              requiresFullChoice: false,
            });
            return;
          }
          merged = result.document;
        } else {
          throw new UserFacingError(
            "Der bisherige Cloud-Stand fehlt. Deine Gerätedaten bleiben erhalten.",
          );
        }
        try {
          await options.validate(merged);
        } catch (error) {
          if (!choice && cloud) {
            update({
              phase: "conflict",
              conflictCount: 1,
              requiresFullChoice: true,
              hasCloudData: true,
              message: "Bitte wähle aus, welche Daten du behalten möchtest.",
            });
            return;
          }
          throw error;
        }
        if (!current()) return;
        const head = cloud;
        let receipt = head;
        if (!head || !sameCloudValue(merged, head.document)) {
          const pending = {
            expectedRevision: head?.revision ?? 0,
            mutationId: options.makeId(),
            document: merged,
            sourceDocument: device,
          };
          await options.local.stage(actor, pending, current);
          if (!current()) return;
          receipt = await remote.write({ accountId: actor, ...pending });
          if (!current()) return;
        }
        if (!receipt || !current()) return;
        const applied = await options.local.apply(actor, device, receipt, current);
        if (!current()) return;
        if (!applied) {
          update({
            phase: "error",
            message: "Es gab weitere Änderungen. Bitte gleiche erneut ab.",
          });
          return;
        }
        update({
          phase: "synced",
          lastSyncedAt: new Date().toISOString(),
          conflictCount: 0,
          requiresFullChoice: false,
          hasCloudData: true,
        });
        if (!sameCloudValue(device, receipt.document)) await options.onApplied();
      } catch (error) {
        if (current())
          update({
            phase: "error",
            message: userFacingErrorMessage(
              error,
              "Der Cloud-Abgleich ist fehlgeschlagen. Deine Daten bleiben erhalten.",
            ),
          });
      }
    })().finally(() => {
      busy = null;
    });
    return busy;
  }
  return {
    isCurrentAccount: (value: string) => accountId === value,
    setAllowed(value: boolean) {
      if (allowed === value) return;
      allowed = value;
      if (!value) generation++;
    },
    snapshot: () => status,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setAccount(value: string | null) {
      if (value === accountId) return;
      accountId = value;
      generation++;
      update({
        phase: value ? "disabled" : "signed_out",
        lastSyncedAt: null,
        conflictCount: 0,
        hasCloudData: false,
        requiresFullChoice: false,
        message: null,
      });
    },
    synchronize,
  };
}
