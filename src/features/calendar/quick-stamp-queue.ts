import { plannedSpecialDuty } from "@/domain/special-duty";
import type { CalendarEntry, ShiftEntry, SaveShiftInput } from "@/domain/types";
import {
  matchingQuickEntries,
  quickEntryShiftInput,
  type QuickEntryStampAction,
} from "./quick-entry-actions";

type Job = {
  remove: boolean;
  action: QuickEntryStampAction;
  preview: ShiftEntry;
  resolve: (ok: boolean) => void;
};
type Lane = {
  date: string;
  added: Map<string, ShiftEntry>;
  removed: Map<string, readonly CalendarEntry[]>;
  jobs: Job[];
  running: boolean;
};
export type StampPreviewDay = { date: string; entries: readonly CalendarEntry[] };

/** UI-only predictions; only repository results ever reach the application provider. */
export function createQuickStampQueue(port: {
  entries(): readonly CalendarEntry[];
  save(input: SaveShiftInput): Promise<ShiftEntry>;
  remove(entry: CalendarEntry): Promise<void>;
  changed(days: readonly StampPreviewDay[], busy: boolean): void;
  failed(error: unknown): void;
  completed(action: QuickEntryStampAction, date: string, removed: number): void;
}) {
  const lanes = new Map<string, Lane>();
  let sequence = 0;
  let lastPublished = "";
  function base(lane: Lane) {
    const entries = port
      .entries()
      .filter((entry) => entry.date === lane.date && !lane.removed.has(entry.id));
    return [...entries.filter((entry) => !lane.added.has(entry.id)), ...lane.added.values()];
  }
  function publish() {
    const days = [...lanes.values()].map((lane) => {
      let entries = base(lane);
      for (const job of lane.jobs) {
        const matches = matchingQuickEntries(job.action, lane.date, entries);
        const ids = new Set(matches.map((entry) => entry.id));
        entries = job.remove
          ? entries.filter((entry) => !ids.has(entry.id))
          : matches.length
            ? entries
            : [...entries, job.preview];
      }
      return { date: lane.date, entries };
    });
    const busy = [...lanes.values()].some((lane) => lane.jobs.length > 0);
    const snapshot = JSON.stringify({ days, busy });
    if (snapshot === lastPublished) return;
    lastPublished = snapshot;
    port.changed(days, busy);
  }
  async function drain(lane: Lane) {
    lane.running = true;
    while (lane.jobs.length) {
      const job = lane.jobs[0];
      let ok = false;
      try {
        const matches = matchingQuickEntries(job.action, lane.date, base(lane));
        if (job.remove) {
          for (const entry of matches) {
            await port.remove(entry);
            lane.added.delete(entry.id);
            lane.removed.set(entry.id, port.entries());
          }
        } else if (!matches.length) {
          const saved = await port.save(quickEntryShiftInput(job.action, lane.date));
          lane.added.set(saved.id, saved);
          lane.removed.delete(saved.id);
        }
        port.completed(job.action, lane.date, matches.length);
        ok = true;
      } catch (error) {
        port.failed(error);
      }
      lane.jobs.shift();
      publish();
      job.resolve(ok);
    }
    lane.running = false;
    reconcile();
  }
  function reconcile() {
    const canonical = new Map(port.entries().map((entry) => [entry.id, entry]));
    let changed = false;
    for (const [date, lane] of lanes) {
      for (const [id, saved] of lane.added) {
        if ((canonical.get(id)?.revision ?? -1) >= saved.revision) {
          lane.added.delete(id);
          changed = true;
        }
      }
      for (const [id, atRemoval] of lane.removed)
        if (!canonical.has(id) && port.entries() !== atRemoval) {
          lane.removed.delete(id);
          changed = true;
        }
      if (!lane.running && !lane.jobs.length && !lane.added.size && !lane.removed.size) {
        lanes.delete(date);
        changed = true;
      }
    }
    if (changed || lanes.size) publish();
  }
  return {
    reconcile,
    stamp(action: QuickEntryStampAction, date: string): Promise<boolean> {
      let lane = lanes.get(date);
      if (!lane) {
        lane = { date, added: new Map(), removed: new Map(), jobs: [], running: false };
        lanes.set(date, lane);
      }
      const input = quickEntryShiftInput(action, date);
      const preview: ShiftEntry = {
        ...input,
        kind: "SHIFT",
        id: `pending-stamp:${++sequence}`,
        templateId: action.template.id,
        title: action.template.name,
        type: action.template.type,
        specialDuty: plannedSpecialDuty(action.template.specialDuty),
        startTime: action.template.startTime,
        endTime: action.template.endTime,
        breakMinutes: action.template.breakMinutes,
        color: action.color,
        symbol: action.symbol,
        note: null,
        overtimeMinutes: 0,
        holidayPremiumMode: "WITH_TIME_OFF",
        revision: 0,
        createdAt: "",
        updatedAt: "",
        deletedAt: null,
      };
      const current = lane;
      return new Promise((resolve) => {
        let predicted = base(current);
        for (const job of current.jobs) {
          const matches = matchingQuickEntries(job.action, date, predicted);
          const ids = new Set(matches.map((entry) => entry.id));
          predicted = job.remove
            ? predicted.filter((entry) => !ids.has(entry.id))
            : matches.length
              ? predicted
              : [...predicted, job.preview];
        }
        const remove = matchingQuickEntries(action, date, predicted).length > 0;
        current.jobs.push({ action, preview, resolve, remove });
        publish();
        if (!current.running) void drain(current);
      });
    },
  };
}
