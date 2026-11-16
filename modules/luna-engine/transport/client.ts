import {
  checkedUtf8Length,
  EngineTransportError,
  jobId,
  parseTransportReply,
  parseBoundedTransportReply,
  TRANSPORT_LIMITS,
  type EngineBackend,
  type EngineLane,
  type EngineOperation,
  type TransportReply,
} from "./protocol";
import { SnapshotSources, type SnapshotSourceReceipt, type SnapshotSourceTicket } from "./source";
import { UtilityRequests, type EngineUtilityReceipt } from "./utility";
import { FinancialCollations } from "./financial/client";
import { FormResources } from "./forms/client";
import { AdmissionGate, requestPriority, type AdmissionPriority } from "./admissions";
import {
  CalendarSources,
  type CalendarSourceTicket,
  type CalendarSourceReceipt,
} from "./calendar/source";
import {
  CalendarWindows,
  type CalendarWindowTicket,
  type CalendarWindowPrepareOptions,
} from "./calendar/windows";
import type { CalendarPageView } from "./calendar/protocol";
import type {
  FinancialCollationReceipt,
  FinancialCollationTicket,
  FinancialRankPayload,
} from "./financial/protocol";

export interface EngineReceipt {
  readonly lane: EngineLane;
  readonly reply: TransportReply;
}
interface Ticket {
  readonly largeOutput: boolean;
  readonly generation: number;
  readonly lane: EngineLane;
  readonly json: string;
  readonly priority: AdmissionPriority;
  readonly current?: () => boolean;
  readonly resolve: (receipt: EngineReceipt) => void;
  readonly reject: (error: EngineTransportError) => void;
  id?: number;
  backendEpoch?: number;
  settled: boolean;
  admitting: boolean;
  detach?: () => void;
}
interface LaneState {
  readonly jobs: Map<number, Ticket>;
  readonly early: Map<number, TransportReply | null>;
  admitting: number;
  pumping: boolean;
  timer?: ReturnType<typeof setTimeout>;
}
const laneState = (): LaneState => ({
  jobs: new Map(),
  early: new Map(),
  admitting: 0,
  pumping: false,
});

/** One client per native singleton. Web's backend owns its two isolated cores. */
export class EngineClient {
  readonly formResources: FormResources;
  private readonly lanes: Record<EngineLane, LaneState> = {
    finance: laneState(),
    checks: laneState(),
  };
  private readonly tickets = new Set<Ticket>();
  private readonly receipts = new WeakMap<
    EngineReceipt,
    { generation: number; current?: () => boolean }
  >();
  private generation = 0;
  private utilityGeneration = 0;
  private utilitySourceGeneration = 0;
  private backendEpoch = 0;
  private closed = false;
  private ready = false;
  private utilityOwnerReady = false;
  private control: Promise<void> = Promise.resolve();
  private readonly unsubscribe?: () => void;
  private readonly sourceBuilders: SnapshotSources;
  private readonly utilities: UtilityRequests;
  private readonly financials: FinancialCollations;
  private readonly admissions: AdmissionGate<Ticket>;
  private readonly calendars: CalendarSources;
  private readonly calendarWindows: CalendarWindows;

  constructor(private readonly backend: EngineBackend) {
    this.formResources = new FormResources({
      capture: () => this.utilityGeneration,
      current: (owner) => !this.closed && owner === this.utilityGeneration,
      ready: async (owner) => {
        await this.control;
        this.ensureOpen();
        if (owner !== this.utilityGeneration || !this.utilityOwnerReady)
          throw new EngineTransportError("OWNER_NOT_BOUND");
        if (!backend.forms) throw new EngineTransportError("FORM_RESOURCE_UNAVAILABLE");
        return backend.forms();
      },
    });
    this.calendars = new CalendarSources({
      capture: () => this.utilityGeneration,
      current: (owner) => !this.closed && owner === this.utilityGeneration,
      ready: async (owner) => {
        await this.control;
        this.ensureOpen();
        if (owner !== this.utilityGeneration || !this.utilityOwnerReady)
          throw new EngineTransportError("OWNER_NOT_BOUND");
      },
      backend: () => backend.calendar,
    });
    this.calendarWindows = new CalendarWindows(this.calendars);
    this.admissions = new AdmissionGate(
      (ticket) => {
        if (ticket.settled) return false;
        if (this.closed || ticket.generation !== this.generation) {
          this.reject(ticket, "STALE_OWNER_OR_REVISION");
          return false;
        }
        if (!this.hostCurrent(ticket.current)) {
          this.reject(ticket, "ADMISSION_FAILED");
          return false;
        }
        return true;
      },
      (ticket) => {
        void this.admit(ticket, ticket.json);
      },
    );
    this.financials = new FinancialCollations({
      capture: () => ({ owner: this.utilityGeneration, source: this.utilitySourceGeneration }),
      current: (capture) =>
        !this.closed &&
        capture.owner === this.utilityGeneration &&
        capture.source === this.utilitySourceGeneration,
      ready: async (capture) => {
        await this.control;
        this.ensureOpen();
        if (
          capture.owner !== this.utilityGeneration ||
          capture.source !== this.utilitySourceGeneration
        )
          throw new EngineTransportError("STALE_FINANCIAL_COLLATION");
        if (!this.utilityOwnerReady) throw new EngineTransportError("OWNER_NOT_BOUND");
      },
      backend: () => this.backend.financialCollation,
    });
    this.utilities = new UtilityRequests({
      capture: () => ({ owner: this.utilityGeneration, source: this.utilitySourceGeneration }),
      current: (capture, sourceBound) =>
        !this.closed &&
        capture.owner === this.utilityGeneration &&
        (!sourceBound || capture.source === this.utilitySourceGeneration),
      ready: async (capture, sourceBound) => {
        await this.control;
        this.ensureOpen();
        if (
          capture.owner !== this.utilityGeneration ||
          (sourceBound && capture.source !== this.utilitySourceGeneration)
        )
          throw new EngineTransportError("STALE_UTILITY");
        if (!this.utilityOwnerReady) throw new EngineTransportError("OWNER_NOT_BOUND");
      },
      invoke: (json) => this.backend.invoke("utility", json),
    });
    this.sourceBuilders = new SnapshotSources(() => backend.sources, {
      capture: () => this.generation,
      current: (generation, check) =>
        !this.closed && generation === this.generation && this.hostCurrent(check),
      ready: async (generation) => {
        await this.control;
        this.ensureGeneration(generation);
        if (!this.ready) throw new EngineTransportError("OWNER_NOT_BOUND");
      },
    });
    this.unsubscribe = backend.onFault?.(() => {
      this.backendEpoch++;
      this.invalidate("BACKEND_RESTARTED");
    });
  }

  async info(): Promise<TransportReply> {
    const result = await this.invoke("info", "");
    if (
      !result.ok ||
      result.abiVersion !== 1 ||
      result.wireSchemaVersion !== 1 ||
      typeof result.engineVersion !== "string" ||
      !result.capabilities ||
      typeof result.capabilities !== "object" ||
      (result.capabilities as Record<string, unknown>).jobScheduling !== true
    )
      throw new EngineTransportError("INCOMPATIBLE_ENGINE");
    // fullCalculation remains the original core capability, including false.
    return result;
  }

  /** Source coordinators rebind after a replaced backend, while ordinary input
   * revisions keep the existing worker instances and native producer caches. */
  isOwnerBound(): boolean {
    return !this.closed && this.ready;
  }
  /** Tiny lifecycle witness. Finance/source revisions do not move it. */
  ownerGenerationSnapshot(): number {
    return this.utilityGeneration;
  }

  bindOwner(json: string): Promise<TransportReply> {
    return this.fence("bindOwner", json, true);
  }
  advanceRevision(json: string): Promise<TransportReply> {
    return this.fence("advanceRevision", json, false);
  }
  reset(): Promise<TransportReply> {
    return this.fence("reset", "", true);
  }

  private fence(
    operation: "bindOwner" | "advanceRevision" | "reset",
    json: string,
    restart: boolean,
  ) {
    checkedUtf8Length(json, TRANSPORT_LIMITS.controlBytes);
    this.ensureOpen();
    this.invalidate("STALE_OWNER_OR_REVISION", restart);
    const generation = this.generation;
    if (restart && this.backend.restart) {
      this.backendEpoch++;
      this.backend.restart();
    }
    const result = this.control
      .catch(() => {})
      .then(async () => {
        // Preserve tiny control ordering, including bind immediately followed
        // by revision. The older caller remains fenced after completion.
        this.ensureOpen();
        const reply = await this.invoke(operation, json);
        this.ensureGeneration(generation);
        if (!reply.ok) throw new EngineTransportError("CONTROL_REJECTED");
        this.ready = operation !== "reset";
        this.utilityOwnerReady = this.ready;
        // This endpoint drops detached ownership only, on a backend worker queue.
        void this.invoke("collectRetired", "").catch(() => {});
        return reply;
      });
    this.control = result.then(() => {});
    // A caller may intentionally fire a fence before awaiting its completion.
    void this.control.catch(() => {});
    return result;
  }

  /** Snapshot register/release channel. Calculations must use calculate(). */
  execute(json: string): Promise<TransportReply> {
    return this.sourceOperation("execute", json);
  }
  snapshotDigests(json: string): Promise<TransportReply> {
    return this.sourceOperation("snapshotDigests", json);
  }
  calendarCandidates(json: string): Promise<TransportReply> {
    return this.sourceOperation("calendarCandidates", json);
  }
  utility(
    json: string,
    options: { readonly isCurrent?: () => boolean } = {},
  ): Promise<EngineUtilityReceipt> {
    return this.utilities.invoke(json, options);
  }
  isUtilityCurrent(receipt: EngineUtilityReceipt): boolean {
    return this.utilities.isCurrent(receipt);
  }
  calendarBegin(json: string, options: { readonly isCurrent?: () => boolean } = {}) {
    return this.calendars.begin(json, options);
  }
  calendarSource(ticket: CalendarSourceTicket, header: string, raw: string) {
    return this.calendars.source(ticket, header, raw);
  }
  calendarPresentation(
    header: string,
    raw: string,
    options: { readonly isCurrent?: () => boolean } = {},
  ) {
    return this.calendars.presentation(header, raw, options);
  }
  calendarSeal(ticket: CalendarSourceTicket) {
    return this.calendars.seal(ticket);
  }
  calendarAbort(ticket: CalendarSourceTicket) {
    return this.calendars.abort(ticket);
  }
  isCalendarSourceCurrent(receipt: CalendarSourceReceipt) {
    return this.calendars.isCurrent(receipt);
  }
  calendarWindowPrepare(
    receipt: CalendarSourceReceipt,
    json: string,
    options: CalendarWindowPrepareOptions = {},
  ) {
    return this.calendarWindows.prepare(receipt, json, options);
  }
  calendarWindowCandidates(ticket: CalendarWindowTicket, after: number | null, limit: number) {
    return this.calendarWindows.candidates(ticket, after, limit);
  }
  calendarWindowFinalize(ticket: CalendarWindowTicket, rawRanks: string) {
    return this.calendarWindows.finalize(ticket, rawRanks);
  }
  calendarWindowRead(
    ticket: CalendarWindowTicket,
    view: CalendarPageView,
    after: number | null,
    limit: number,
  ) {
    return this.calendarWindows.read(ticket, view, after, limit);
  }
  calendarWindowAbort(ticket: CalendarWindowTicket) {
    return this.calendarWindows.abort(ticket);
  }
  isCalendarWindowCurrent(ticket: CalendarWindowTicket) {
    return this.calendarWindows.isCurrent(ticket);
  }
  financialCollationPrepare(json: string, options: { readonly isCurrent?: () => boolean } = {}) {
    return this.financials.prepare(json, options);
  }
  financialCollationCandidates(
    ticket: FinancialCollationTicket,
    options: { readonly after: number | null; readonly limit: number },
  ) {
    return this.financials.candidates(ticket, options);
  }
  financialCollationFinalize(ticket: FinancialCollationTicket, payload: FinancialRankPayload) {
    return this.financials.finalize(ticket, payload);
  }
  financialCollationAbort(ticket: FinancialCollationTicket) {
    return this.financials.abort(ticket);
  }
  isFinancialCollationCurrent(receipt: FinancialCollationReceipt) {
    return this.financials.isCurrent(receipt);
  }
  /** Same bounded Finance admission/pump; proof remains pinned until terminal. */
  calculateFinancialDetails(
    receipt: FinancialCollationReceipt,
    json: string,
    options: {
      readonly signal?: AbortSignal;
      readonly isCurrent?: () => boolean;
    } = {},
  ): Promise<EngineReceipt> {
    return this.financials.useProof(receipt, async (backend, proof) => {
      if (!backend.bindDetails) throw new EngineTransportError("FINANCIAL_DETAILS_UNAVAILABLE");
      const current = () =>
        this.isFinancialCollationCurrent(receipt) && this.hostCurrent(options.isCurrent);
      return this.calculate("finance", backend.bindDetails(proof, json), {
        ...options,
        isCurrent: current,
      });
    });
  }
  private async sourceOperation(operation: EngineOperation, json: string) {
    checkedUtf8Length(json, TRANSPORT_LIMITS.inputBytes);
    if (operation === "execute") this.invalidateUtilitySources();
    const generation = this.generation;
    await this.control;
    this.ensureGeneration(generation);
    const reply = await this.invoke(operation, json);
    this.ensureGeneration(generation);
    return reply;
  }

  calculate(
    lane: EngineLane,
    json: string,
    options: {
      readonly signal?: AbortSignal;
      readonly isCurrent?: () => boolean;
      readonly largeInput?: boolean | "CHECKS_DETAILS";
      readonly priority?: AdmissionPriority;
    } = {},
  ): Promise<EngineReceipt> {
    try {
      this.ensureOpen();
      if (
        options.largeInput &&
        (options.priority !== "INTERACTIVE" ||
          (options.largeInput === "CHECKS_DETAILS" ? lane !== "checks" : lane !== "finance"))
      )
        throw new EngineTransportError("INVALID_LANE");
      checkedUtf8Length(
        json,
        options.largeInput ? TRANSPORT_LIMITS.inputBytes : TRANSPORT_LIMITS.admissionBytes,
      );
      if (lane !== "finance" && lane !== "checks") throw new EngineTransportError("INVALID_LANE");
      if (this.tickets.size >= TRANSPORT_LIMITS.pending)
        throw new EngineTransportError("HOST_QUEUE_FULL");
    } catch (error) {
      return Promise.reject(error);
    }
    const generation = this.generation;
    return new Promise<EngineReceipt>((resolve, reject) => {
      const ticket: Ticket = {
        largeOutput: Boolean(options.largeInput),
        generation,
        lane,
        json,
        priority: options.largeInput ? "INTERACTIVE" : requestPriority(json),
        resolve,
        reject,
        current: options.isCurrent,
        settled: false,
        admitting: false,
      };
      this.tickets.add(ticket);
      const abort = () => this.cancel(ticket);
      options.signal?.addEventListener("abort", abort, { once: true });
      ticket.detach = () => options.signal?.removeEventListener("abort", abort);
      if (options.signal?.aborted) abort();
      if (!ticket.settled) this.admissions.enqueue(ticket, ticket.priority);
    });
  }

  snapshotBegin(headerJson: string, options: { readonly isCurrent?: () => boolean } = {}) {
    this.invalidateUtilitySources();
    return this.sourceBuilders.begin(headerJson, options);
  }
  invokeSource(ticket: SnapshotSourceTicket, groupHeaderJson: string, rawSourceJson: string) {
    return this.sourceBuilders.source(ticket, groupHeaderJson, rawSourceJson);
  }
  snapshotSeal(ticket: SnapshotSourceTicket) {
    if (this.sourceBuilders.isCurrentTicket(ticket)) this.invalidateUtilitySources();
    return this.sourceBuilders.seal(ticket);
  }
  snapshotCalendarCandidates(
    ticket: SnapshotSourceTicket,
    options: { readonly after: number | null; readonly limit: number },
  ) {
    return this.sourceBuilders.candidates(ticket, options);
  }
  snapshotCalendarRanks(ticket: SnapshotSourceTicket, ranksJson: string) {
    return this.sourceBuilders.ranks(ticket, ranksJson);
  }
  snapshotCatalogCandidates(
    ticket: SnapshotSourceTicket,
    options: { readonly after: number | null; readonly limit: number },
  ) {
    return this.sourceBuilders.catalogCandidates(ticket, options);
  }
  snapshotCatalogFinalize(ticket: SnapshotSourceTicket, ranksJson: string) {
    return this.sourceBuilders.catalogFinalize(ticket, ranksJson);
  }
  snapshotProfileClock(ticket: SnapshotSourceTicket, observedEpochMilliseconds: number) {
    return this.sourceBuilders.profileClock(ticket, observedEpochMilliseconds);
  }
  snapshotAbort(ticket: SnapshotSourceTicket) {
    if (this.sourceBuilders.isCurrentTicket(ticket)) this.invalidateUtilitySources();
    return this.sourceBuilders.abort(ticket);
  }

  isCurrent(receipt: EngineReceipt | SnapshotSourceReceipt): boolean {
    if (this.sourceBuilders.isCurrent(receipt)) return true;
    const token = this.receipts.get(receipt as EngineReceipt);
    return (
      !!token &&
      !this.closed &&
      token.generation === this.generation &&
      this.hostCurrent(token.current)
    );
  }

  close(): void {
    if (this.closed) return;
    this.invalidate("TRANSPORT_CLOSED");
    this.closed = true;
    this.unsubscribe?.();
    this.backend.close();
  }

  private async admit(ticket: Ticket, json: string) {
    const state = this.lanes[ticket.lane];
    let started = false;
    let retry = false;
    ticket.admitting = true;
    try {
      await this.control;
      this.ensureGeneration(ticket.generation);
      if (ticket.settled) return;
      if (!this.ready) throw new EngineTransportError("OWNER_NOT_BOUND");
      if (!this.hostCurrent(ticket.current)) throw new EngineTransportError("STALE_HOST_REQUEST");
      state.admitting++;
      started = true;
      ticket.backendEpoch = this.backendEpoch;
      const reply = await this.invoke(
        ticket.lane === "finance" ? "admitFinance" : "admitChecks",
        json,
        ticket.lane,
      );
      if (
        !reply.ok &&
        reply.stage === "SCHEDULER" &&
        reply.code === "CAPACITY" &&
        !ticket.settled &&
        ticket.generation === this.generation &&
        !this.closed
      ) {
        retry = true;
        this.admissions.capacity(ticket, ticket.priority);
        this.schedule("finance");
        this.schedule("checks");
        return;
      }
      if (
        !reply.ok &&
        reply.stage === "FINANCIAL_COLLATION" &&
        reply.code === "FINANCIAL_COLLATION_UNKNOWN_PROOF"
      ) {
        // Idle native LRU retention is finite. The source coordinator can
        // prepare a fresh proof once; it must not treat this as ready evidence.
        this.reject(ticket, "FINANCIAL_COLLATION_UNKNOWN_PROOF");
        return;
      }
      if (!reply.ok || reply.state !== "QUEUED" || !jobId(reply.jobId))
        throw new EngineTransportError("ADMISSION_REJECTED");
      ticket.id = reply.jobId;
      if (this.admissions.has(ticket)) {
        state.jobs.set(ticket.id, ticket);
        if (state.early.has(ticket.id)) {
          const early = state.early.get(ticket.id)!;
          state.early.delete(ticket.id);
          this.routeOne(state, ticket.id, early);
        }
      }
      if (ticket.settled || ticket.generation !== this.generation || this.closed)
        this.cancelNative(ticket);
    } catch {
      this.reject(ticket, "ADMISSION_FAILED");
    } finally {
      if (started) state.admitting--;
      ticket.admitting = false;
      if (ticket.id === undefined && !retry) this.admissions.release(ticket);
      if ((ticket.settled && !this.admissions.has(ticket)) || (ticket.id === undefined && !retry))
        this.tickets.delete(ticket);
      if (state.admitting === 0) state.early.clear();
      if (started) this.schedule(ticket.lane);
    }
  }

  private cancel(ticket: Ticket) {
    this.reject(ticket, "CANCELED");
    if (ticket.id !== undefined) this.cancelNative(ticket);
  }
  private cancelNative(ticket: Ticket) {
    const id = ticket.id;
    if (id === undefined || this.closed || ticket.backendEpoch !== this.backendEpoch) return;
    // Lane qualification is necessary for independent Wasm job-ID sequences.
    void this.invoke("cancelJob", JSON.stringify({ jobId: id }), ticket.lane)
      .catch(() => {})
      .finally(() => this.schedule(ticket.lane));
  }

  private schedule(lane: EngineLane) {
    const state = this.lanes[lane];
    if (this.closed || state.pumping || state.timer !== undefined) return;
    state.timer = setTimeout(() => {
      state.timer = undefined;
      void this.pump(lane);
    }, 0);
  }
  private async pump(lane: EngineLane) {
    const state = this.lanes[lane];
    state.pumping = true;
    const generation = this.generation;
    let again = false;
    try {
      for (let i = 0; i < TRANSPORT_LIMITS.pumpJobs && !this.closed; i++) {
        const backendEpoch = this.backendEpoch;
        const reply = await this.invoke(lane === "finance" ? "runFinance" : "runChecks", "", lane);
        if (backendEpoch !== this.backendEpoch) break;
        this.route(lane, reply);
        if (reply.state === "IDLE") {
          again = false;
          break;
        }
        again = true;
        if (!reply.ok && !jobId(reply.jobId)) throw new EngineTransportError("WORKER_FAILED");
      }
    } catch {
      for (const ticket of state.jobs.values()) {
        if (ticket.generation === generation) {
          this.reject(ticket, "WORKER_FAILED");
          this.cancelNative(ticket);
          this.admissions.release(ticket);
          state.jobs.delete(ticket.id!);
          this.tickets.delete(ticket);
        }
      }
      again = false;
    } finally {
      state.pumping = false;
      if (again || (state.jobs.size > 0 && generation !== this.generation)) this.schedule(lane);
    }
  }

  private route(lane: EngineLane, reply: TransportReply) {
    const state = this.lanes[lane];
    const skipped = reply.skippedJobs;
    if (skipped !== undefined) {
      if (!Array.isArray(skipped) || skipped.length > 12 || !skipped.every(jobId))
        throw new EngineTransportError("INVALID_NATIVE_REPLY");
      for (const id of skipped) this.routeOne(state, id, null);
    }
    if (reply.jobId !== undefined) {
      if (!jobId(reply.jobId)) throw new EngineTransportError("INVALID_NATIVE_REPLY");
      if (reply.ok && reply.state === "RUNNING") return;
      if (reply.ok && !["PREPARED", "COMPLETED", "CANCELED"].includes(String(reply.state)))
        throw new EngineTransportError("INVALID_NATIVE_REPLY");
      this.routeOne(state, reply.jobId, reply);
    } else if (reply.ok && reply.state !== "IDLE")
      throw new EngineTransportError("INVALID_NATIVE_REPLY");
  }
  private routeOne(state: LaneState, id: number, reply: TransportReply | null) {
    const ticket = state.jobs.get(id);
    if (ticket) {
      this.admissions.release(ticket);
      state.jobs.delete(id);
      this.finish(ticket, reply);
      if (ticket.settled && !ticket.admitting) this.tickets.delete(ticket);
    } else if (state.admitting > 0) {
      if (!state.early.has(id) && state.early.size >= TRANSPORT_LIMITS.pending)
        throw new EngineTransportError("EARLY_REPLY_LIMIT");
      state.early.set(id, reply);
    }
    this.admissions.progress();
  }
  private finish(ticket: Ticket, reply: TransportReply | null) {
    if (!reply || !reply.ok || reply.state === "CANCELED") {
      this.reject(ticket, "NATIVE_JOB_CANCELED_OR_FAILED");
      return;
    }
    if (ticket.generation !== this.generation || this.closed || !this.hostCurrent(ticket.current)) {
      this.reject(ticket, "STALE_HOST_REQUEST");
      return;
    }
    if (ticket.settled) return;
    ticket.settled = true;
    ticket.detach?.();
    this.remove(ticket);
    const receipt: EngineReceipt = Object.freeze({ lane: ticket.lane, reply });
    this.receipts.set(receipt, { generation: ticket.generation, current: ticket.current });
    ticket.resolve(receipt);
  }
  private reject(ticket: Ticket, code: string) {
    if (ticket.settled) return;
    ticket.settled = true;
    ticket.detach?.();
    this.remove(ticket);
    ticket.reject(new EngineTransportError(code));
  }
  private remove(ticket: Ticket) {
    this.admissions.cancelWaiting(ticket);
    if (ticket.id !== undefined && !this.admissions.has(ticket))
      this.lanes[ticket.lane].jobs.delete(ticket.id);
    // In-flight admissions retain a bounded ticket until their ACK can be canceled.
    if (!ticket.admitting && !this.admissions.has(ticket)) this.tickets.delete(ticket);
  }
  private invalidate(code: string, ownerChanged = true) {
    if (ownerChanged) this.formResources.invalidate();
    this.generation++;
    this.utilitySourceGeneration++;
    if (ownerChanged) {
      this.utilityGeneration++;
      this.utilityOwnerReady = false;
      this.calendars.invalidate();
      this.calendarWindows.invalidate();
    }
    this.utilities.invalidate(ownerChanged);
    this.financials.invalidate(ownerChanged);
    this.ready = false;
    this.admissions.clear();
    for (const ticket of this.tickets) this.reject(ticket, code);
    for (const state of Object.values(this.lanes)) {
      state.early.clear();
      if (state.timer !== undefined) clearTimeout(state.timer);
      state.timer = undefined;
    }
  }
  private invalidateUtilitySources() {
    this.utilitySourceGeneration++;
    this.utilities.invalidate(false);
    this.financials.invalidate(false);
  }
  private hostCurrent(check?: () => boolean): boolean {
    try {
      return !check || check();
    } catch {
      return false;
    }
  }
  private ensureOpen() {
    if (this.closed) throw new EngineTransportError("TRANSPORT_CLOSED");
  }
  private ensureGeneration(generation: number) {
    this.ensureOpen();
    if (generation !== this.generation) throw new EngineTransportError("STALE_OWNER_OR_REVISION");
  }
  private async invoke(operation: EngineOperation, json: string, lane?: EngineLane) {
    this.ensureOpen();
    const raw = await this.backend.invoke(operation, json, lane);
    const outputLane =
      operation === "runFinance" ? "finance" : operation === "runChecks" ? "checks" : null;
    return outputLane &&
      [...this.tickets].some((t) => t.lane === outputLane && t.largeOutput && !t.settled)
      ? parseBoundedTransportReply(raw, TRANSPORT_LIMITS.inputBytes)
      : parseTransportReply(raw);
  }
}
