import { checkedRawSourceString, EngineTransportError } from "../protocol";
import {
  FINANCIAL_COLLATION_LIMITS as limits,
  type BackendFinancialProof,
  type BackendFinancialTicket,
  type FinancialCandidatePage,
  type FinancialCollationBackend,
  type FinancialCollationPreparation,
  type FinancialCollationReceipt,
  type FinancialCollationTicket,
  type FinancialRankPayload,
} from "./protocol";
import {
  checkFinancialMetadata,
  digest,
  expectedFinancialScope,
  financialReason,
  preparedMetadata,
  record,
  type ExpectedFinancialScope,
} from "./wire";
interface Capture {
  readonly owner: number;
  readonly source: number;
}
export interface FinancialEnvironment {
  capture(): Capture;
  current(capture: Capture): boolean;
  ready(capture: Capture): Promise<void>;
  backend(): FinancialCollationBackend | undefined;
}
interface Channel {
  revision: number;
  serial: number;
}
interface State {
  readonly capture: Capture;
  readonly expected: ExpectedFinancialScope;
  readonly channel: Channel;
  readonly serial: number;
  readonly current?: () => boolean;
  phase: "PREPARING" | "OPEN" | "FINALIZING" | "FINALIZED" | "CLOSED";
  tail: Promise<void>;
  backend?: FinancialCollationBackend;
  native?: BackendFinancialTicket;
  proof?: BackendFinancialProof;
  candidateDigest?: string;
  total?: number;
  cached?: boolean;
  abortRequested: boolean;
  aborting?: Promise<void>;
  active: number;
  last: number;
}
interface Pending {
  state: State;
  settled: boolean;
  reject(error: EngineTransportError): void;
}
function fail(code: string): never {
  throw new EngineTransportError(code);
}

/** Host metadata/lifecycle only. Native owns strings, rank parsing and proofs. */
export class FinancialCollations {
  private sequence = 0;
  private rawFinalizing?: State;
  private readonly channels = new Map<string, Channel>();
  private readonly states = new Set<State>();
  private readonly drafts = new Set<State>();
  private readonly proofs = new Set<State>();
  private readonly tickets = new WeakMap<FinancialCollationTicket, State>();
  private readonly receipts = new WeakMap<FinancialCollationReceipt, State>();
  private readonly pending = new Set<Pending>();
  constructor(private readonly environment: FinancialEnvironment) {}

  prepare(
    json: string,
    options: { readonly isCurrent?: () => boolean } = {},
  ): Promise<FinancialCollationPreparation> {
    try {
      const expected = expectedFinancialScope(json),
        capture = this.environment.capture();
      if (!this.environment.current(capture) || !this.hostCurrent(options.isCurrent))
        return Promise.reject(new EngineTransportError("STALE_FINANCIAL_COLLATION"));
      let channel = this.channels.get(expected.channel);
      if (channel && channel.revision > expected.revision)
        return Promise.reject(new EngineTransportError("STALE_FINANCIAL_COLLATION"));
      // Replacing an intent frees its host slot immediately; a late native ACK
      // is still aborted against its original opaque backend incarnation.
      for (const state of this.states)
        if (!this.current(state) || state.expected.channel === expected.channel) this.close(state);
      if (this.drafts.size >= limits.drafts)
        return Promise.reject(new EngineTransportError("FINANCIAL_COLLATION_QUEUE_FULL"));
      const serial = this.next();
      if (!channel) {
        if (this.channels.size >= limits.channels) {
          const oldest = [...this.channels].find(
            ([, candidate]) => ![...this.states].some((s) => s.channel === candidate),
          );
          if (!oldest)
            return Promise.reject(new EngineTransportError("FINANCIAL_COLLATION_QUEUE_FULL"));
          this.channels.delete(oldest[0]);
        }
        channel = { revision: expected.revision, serial };
        this.channels.set(expected.channel, channel);
      } else {
        channel.revision = expected.revision;
        channel.serial = serial;
      }
      const state: State = {
        capture,
        expected,
        channel,
        serial,
        current: options.isCurrent,
        phase: "PREPARING",
        tail: Promise.resolve(),
        abortRequested: false,
        active: 0,
        last: serial,
      };
      this.states.add(state);
      this.drafts.add(state);
      return this.task(state, async () => {
        await this.environment.ready(capture);
        this.ensure(state);
        const backend = this.environment.backend();
        if (!backend) fail("FINANCIAL_COLLATION_UNAVAILABLE");
        state.backend = backend;
        const prepared = await backend.prepare(json);
        if (prepared.state === "PREPARED") state.native = prepared.ticket;
        this.ensure(state);
        checkFinancialMetadata(prepared.metadata, expected);
        if (prepared.state === "UNAVAILABLE") {
          if (prepared.metadata.state !== "FINANCIAL_COLLATION_UNAVAILABLE")
            fail("INVALID_FINANCIAL_COLLATION_REPLY");
          const reason = financialReason(prepared.metadata.reason);
          state.phase = "CLOSED";
          this.states.delete(state);
          this.drafts.delete(state);
          return { state: "UNAVAILABLE", reason };
        }
        const meta = preparedMetadata(prepared.metadata);
        state.candidateDigest = meta.candidateDigest;
        state.total = meta.total;
        state.cached = meta.cachedVerifiedRanks;
        state.phase = "OPEN";
        const ticket = Object.freeze({}) as FinancialCollationTicket;
        this.tickets.set(ticket, state);
        return { state: "PREPARED", ticket, ...meta };
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  candidates(
    ticket: FinancialCollationTicket,
    options: { readonly after: number | null; readonly limit: number },
  ): Promise<FinancialCandidatePage> {
    try {
      const state = this.open(ticket);
      if (
        !options ||
        !(
          options.after === null ||
          (Number.isInteger(options.after) &&
            options.after >= 0 &&
            options.after <= limits.candidates)
        ) ||
        !Number.isInteger(options.limit) ||
        options.limit < 1 ||
        options.limit > limits.pageItems
      )
        fail("INVALID_FINANCIAL_COLLATION_CURSOR");
      const { after, limit } = options;
      return this.enqueue(state, async () => {
        const reply = await state.backend!.candidates(state.native!, after, limit);
        this.ensure(state);
        checkFinancialMetadata(reply, state.expected);
        if (reply.state !== "FINANCIAL_COLLATION_CANDIDATES" || !record(reply.page))
          fail("INVALID_FINANCIAL_COLLATION_REPLY");
        const page = reply.page,
          start = after ?? 0;
        if (
          page.total !== state.total ||
          page.candidateDigest !== state.candidateDigest ||
          !Array.isArray(page.candidates) ||
          page.candidates.length > limit ||
          page.candidates.some((s) => typeof s !== "string" || s.length > 300000)
        )
          fail("INVALID_FINANCIAL_COLLATION_REPLY");
        const end = start + page.candidates.length;
        if (
          start > state.total! ||
          end > state.total! ||
          (page.nextAfter === null
            ? end !== state.total
            : page.nextAfter !== end || end >= state.total! || page.candidates.length === 0)
        )
          fail("INVALID_FINANCIAL_COLLATION_REPLY");
        return {
          candidates: page.candidates as string[],
          nextAfter: page.nextAfter as number | null,
          total: state.total!,
          candidateDigest: state.candidateDigest!,
        };
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  finalize(
    ticket: FinancialCollationTicket,
    payload: FinancialRankPayload,
  ): Promise<FinancialCollationReceipt> {
    try {
      const state = this.open(ticket);
      if (
        !payload ||
        !record(payload) ||
        !(payload.kind === "NATIVE_CACHE" || payload.kind === "ORIGINAL_RANKS")
      )
        fail("INVALID_FINANCIAL_COLLATION_RANKS");
      const raw = payload.kind === "ORIGINAL_RANKS";
      if (raw) {
        checkedRawSourceString(payload.json, limits.rankBytes);
        if (this.rawFinalizing) fail("FINANCIAL_COLLATION_BUSY");
      } else if (!state.cached) fail("FINANCIAL_COLLATION_CACHE_UNAVAILABLE");
      if (
        !Object.hasOwn(payload, "kind") ||
        Object.keys(payload).some((key) => key !== "kind" && (key !== "json" || !raw)) ||
        Object.keys(payload).length !== (raw ? 2 : 1)
      )
        fail("INVALID_FINANCIAL_COLLATION_RANKS");
      state.phase = "FINALIZING";
      if (raw) this.rawFinalizing = state;
      const operation = this.enqueue(state, async () => {
        try {
          const result = await state.backend!.finalize(state.native!, payload);
          this.ensure(state);
          checkFinancialMetadata(result.metadata, state.expected);
          if (
            result.metadata.state !== "FINANCIAL_COLLATION_READY" ||
            result.metadata.candidateDigest !== state.candidateDigest ||
            !digest(result.metadata.digest)
          )
            fail("INVALID_FINANCIAL_COLLATION_REPLY");
          this.retainProofSlot();
          state.proof = result.proof;
          state.phase = "FINALIZED";
          state.last = this.next();
          this.drafts.delete(state);
          this.proofs.add(state);
          const receipt = Object.freeze({}) as FinancialCollationReceipt;
          this.receipts.set(receipt, state);
          return receipt;
        } finally {
          if (raw && this.rawFinalizing === state) this.rawFinalizing = undefined;
        }
      });
      // If a queued task was invalidated before invoking its body, release the
      // host permit only after its actual queue drain, not early rejection.
      if (raw)
        void state.tail.finally(() => {
          if (this.rawFinalizing === state) this.rawFinalizing = undefined;
        });
      return operation;
    } catch (error) {
      return Promise.reject(error);
    }
  }
  isCurrent(receipt: FinancialCollationReceipt): boolean {
    const state = this.receipts.get(receipt);
    return !!state && state.phase === "FINALIZED" && this.proofs.has(state) && this.current(state);
  }
  abort(ticket: FinancialCollationTicket): Promise<void> {
    const state = this.tickets.get(ticket);
    if (!state)
      return Promise.reject(new EngineTransportError("INVALID_FINANCIAL_COLLATION_TICKET"));
    this.close(state);
    return this.cleanup(state);
  }
  invalidate(ownerChanged: boolean): void {
    for (const state of [...this.states]) this.close(state);
    if (ownerChanged) this.channels.clear();
  }
  /** Internal job seam: pin through the whole details task, not only its ACK.
   * Native admission still rechecks whether its idle-LRU proof is retained. */
  async useProof<T>(
    receipt: FinancialCollationReceipt,
    invoke: (backend: FinancialCollationBackend, proof: BackendFinancialProof) => Promise<T>,
  ): Promise<T> {
    const state = this.receipts.get(receipt);
    if (!state || !this.isCurrent(receipt)) fail("STALE_FINANCIAL_COLLATION");
    state.last = this.next();
    state.active++;
    try {
      const value = await invoke(state.backend!, state.proof!);
      this.ensure(state);
      return value;
    } finally {
      state.active--;
    }
  }
  private retainProofSlot(): void {
    if (this.proofs.size < limits.proofs) return;
    const oldest = [...this.proofs]
      .filter((s) => s.active === 0)
      .sort((a, b) => a.last - b.last)[0];
    if (!oldest) fail("FINANCIAL_COLLATION_QUEUE_FULL");
    this.close(oldest);
  }
  private open(ticket: FinancialCollationTicket): State {
    const state = this.tickets.get(ticket);
    if (!state) fail("INVALID_FINANCIAL_COLLATION_TICKET");
    this.ensure(state);
    if (state.phase !== "OPEN") fail("FINANCIAL_COLLATION_TICKET_CLOSED");
    return state;
  }
  private ensure(state: State): void {
    if (!this.current(state)) fail("STALE_FINANCIAL_COLLATION");
  }
  private current(state: State): boolean {
    return (
      state.phase !== "CLOSED" &&
      this.environment.current(state.capture) &&
      this.hostCurrent(state.current) &&
      this.channels.get(state.expected.channel) === state.channel &&
      state.channel.revision === state.expected.revision &&
      state.channel.serial === state.serial
    );
  }
  private hostCurrent(check?: () => boolean): boolean {
    try {
      return !check || check();
    } catch {
      return false;
    }
  }
  private next(): number {
    if (this.sequence >= Number.MAX_SAFE_INTEGER) fail("FINANCIAL_COLLATION_SEQUENCE_EXHAUSTED");
    return ++this.sequence;
  }
  private enqueue<T>(state: State, invoke: () => Promise<T>): Promise<T> {
    const before = state.tail;
    const actual = before.then(async () => {
      await this.environment.ready(state.capture);
      this.ensure(state);
      return invoke();
    });
    state.tail = actual.then(
      () => {},
      () => {},
    );
    return this.task(state, () => actual);
  }
  private task<T>(state: State, invoke: () => Promise<T>): Promise<T> {
    if (this.pending.size >= 128) {
      this.close(state);
      return Promise.reject(new EngineTransportError("FINANCIAL_COLLATION_QUEUE_FULL"));
    }
    return new Promise((resolve, reject) => {
      const pending: Pending = { state, settled: false, reject };
      this.pending.add(pending);
      void (async () => {
        try {
          const value = await invoke();
          if (!pending.settled) {
            pending.settled = true;
            resolve(value);
          }
        } catch (error) {
          if (!pending.settled) {
            pending.settled = true;
            reject(
              error instanceof EngineTransportError
                ? error
                : new EngineTransportError("FINANCIAL_COLLATION_FAILED"),
            );
          }
          this.close(state);
        } finally {
          this.pending.delete(pending);
          if (state.phase === "CLOSED") void this.cleanup(state);
        }
      })();
    });
  }
  private close(state: State): void {
    state.phase = "CLOSED";
    this.states.delete(state);
    this.drafts.delete(state);
    this.proofs.delete(state);
    for (const pending of this.pending)
      if (pending.state === state && !pending.settled) {
        pending.settled = true;
        pending.reject(new EngineTransportError("STALE_FINANCIAL_COLLATION"));
      }
    void this.cleanup(state);
  }
  private cleanup(state: State): Promise<void> {
    if (state.aborting) return state.aborting;
    if (!state.backend || !state.native || state.abortRequested) return Promise.resolve();
    state.abortRequested = true;
    const backend = state.backend,
      ticket = state.native;
    const operation = Promise.resolve()
      .then(() => backend.abort(ticket))
      .catch(() => {
        /* The owning backend must never redirect a stale opaque ticket. */
      });
    state.aborting = operation;
    return operation;
  }
}
