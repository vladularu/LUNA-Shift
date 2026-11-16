import {
  checkedUtf8Length,
  checkedRawSourceString,
  EngineTransportError,
  parseTransportReply,
  TRANSPORT_LIMITS,
  type TransportReply,
} from "./protocol";

declare const backendTicket: unique symbol;
declare const hostTicket: unique symbol;
/** Backend implementations retain numeric native IDs privately, including pairs. */
export interface BackendSourceTicket {
  readonly [backendTicket]: true;
}
export interface SnapshotSourceTicket {
  readonly [hostTicket]: true;
}
export interface SnapshotSourceReceipt {
  readonly reply: TransportReply;
}
export interface SourceBackend {
  begin(headerJson: string): Promise<BackendSourceTicket>;
  source(ticket: BackendSourceTicket, headerJson: string, sourceJson: string): Promise<string>;
  seal(ticket: BackendSourceTicket): Promise<string>;
  abort(ticket: BackendSourceTicket): Promise<void>;
  candidates?(ticket: BackendSourceTicket, after: number | null, limit: number): Promise<string>;
  ranks?(ticket: BackendSourceTicket, ranksJson: string): Promise<string>;
  catalogCandidates?(
    ticket: BackendSourceTicket,
    after: number | null,
    limit: number,
  ): Promise<string>;
  catalogFinalize?(ticket: BackendSourceTicket, ranksJson: string): Promise<string>;
  profileClock?(ticket: BackendSourceTicket, observedEpochMilliseconds: number): Promise<string>;
}
interface HostFence {
  capture(): number;
  current(generation: number, check?: () => boolean): boolean;
  ready(generation: number): Promise<void>;
}
interface Assembly {
  readonly sequence: number;
  readonly generation: number;
  readonly current?: () => boolean;
  readonly backend: SourceBackend;
  readonly native: BackendSourceTicket;
  readonly pending: Set<Promise<TransportReply>>;
  state: "OPEN" | "SEALING" | "CLOSED";
  failed: boolean;
  aborted: boolean;
  tail: Promise<void>;
  submittedGroups: number;
  submittedCodeUnits: number;
}

/** Opaque source lifecycle. This class does not calculate or interpret sources. */
export class SnapshotSources {
  private sequence = 0;
  private active?: Assembly;
  private readonly tickets = new WeakMap<SnapshotSourceTicket, Assembly>();
  private readonly receipts = new WeakMap<SnapshotSourceReceipt, Assembly>();
  constructor(
    private readonly backend: () => SourceBackend | undefined,
    private readonly fence: HostFence,
  ) {}

  async begin(
    headerJson: string,
    options: { readonly isCurrent?: () => boolean } = {},
  ): Promise<SnapshotSourceTicket> {
    checkedUtf8Length(headerJson, 128 * 1024);
    if (this.sequence >= Number.MAX_SAFE_INTEGER)
      throw new EngineTransportError("SOURCE_SEQUENCE_EXHAUSTED");
    const sequence = ++this.sequence;
    const previous = this.active;
    this.active = undefined;
    if (previous) {
      previous.state = "CLOSED";
      void this.cleanup(previous);
    }
    const generation = this.fence.capture();
    await this.fence.ready(generation);
    this.ensureCurrent({ sequence, generation, current: options.isCurrent });
    const backend = this.backend();
    if (!backend) throw new EngineTransportError("SOURCE_BUILDER_UNAVAILABLE");
    let native: BackendSourceTicket;
    try {
      native = await backend.begin(headerJson);
    } catch {
      throw new EngineTransportError("SOURCE_BEGIN_FAILED");
    }
    // A reusable primitive ID must never become a host-facing builder ticket.
    if (!native || typeof native !== "object")
      throw new EngineTransportError("INVALID_SOURCE_TICKET");
    const assembly: Assembly = {
      sequence,
      generation,
      current: options.isCurrent,
      backend,
      native,
      pending: new Set(),
      state: "OPEN",
      failed: false,
      aborted: false,
      tail: Promise.resolve(),
      submittedGroups: 0,
      submittedCodeUnits: headerJson.length,
    };
    try {
      this.ensureCurrent(assembly);
    } catch (error) {
      await this.cleanup(assembly);
      throw error;
    }
    const ticket = Object.freeze({}) as SnapshotSourceTicket;
    this.tickets.set(ticket, assembly);
    this.active = assembly;
    return ticket;
  }

  source(
    ticket: SnapshotSourceTicket,
    headerJson: string,
    sourceJson: string,
  ): Promise<TransportReply> {
    let assembly: Assembly;
    try {
      assembly = this.open(ticket);
      checkedUtf8Length(headerJson, 128 * 1024);
      checkedRawSourceString(sourceJson, TRANSPORT_LIMITS.inputBytes);
      if (
        assembly.submittedGroups >= 128 ||
        assembly.submittedCodeUnits + headerJson.length + sourceJson.length >
          TRANSPORT_LIMITS.inputBytes
      )
        throw new EngineTransportError("SOURCE_QUEUE_LIMIT");
      assembly.submittedGroups++;
      assembly.submittedCodeUnits += headerJson.length + sourceJson.length;
    } catch (error) {
      return Promise.reject(error);
    }
    const operation = assembly.tail.then(async () => {
      try {
        await this.fence.ready(assembly.generation);
        this.ensureCurrent(assembly);
        if (assembly.failed) throw new EngineTransportError("SOURCE_ASSEMBLY_FAILED");
        if (this.closed(assembly)) throw new EngineTransportError("SOURCE_TICKET_CLOSED");
        const reply = parseTransportReply(
          await assembly.backend.source(assembly.native, headerJson, sourceJson),
        );
        this.ensureCurrent(assembly);
        if (this.closed(assembly) || !reply.ok)
          throw new EngineTransportError("SOURCE_GROUP_REJECTED");
        return reply;
      } catch (error) {
        assembly.failed = true;
        throw error instanceof EngineTransportError
          ? error
          : new EngineTransportError("SOURCE_GROUP_FAILED");
      }
    });
    // One raw operation per core. I/O may finish concurrently without flooding
    // native preparation queues or reparsing several large sources at once.
    assembly.tail = operation.then(
      () => {},
      () => {},
    );
    assembly.pending.add(operation);
    void operation.then(
      () => assembly.pending.delete(operation),
      () => assembly.pending.delete(operation),
    );
    return operation;
  }

  candidates(
    ticket: SnapshotSourceTicket,
    options: { readonly after: number | null; readonly limit: number },
  ): Promise<TransportReply> {
    if (
      !options ||
      !(
        options.after === null ||
        (Number.isInteger(options.after) && options.after >= 0 && options.after <= 0xffffffff)
      ) ||
      !Number.isInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > 1024
    )
      return Promise.reject(new EngineTransportError("INVALID_SOURCE_CURSOR"));
    const { after, limit } = options;
    return this.preflight(ticket, async (assembly) => {
      if (!assembly.backend.candidates)
        throw new EngineTransportError("SOURCE_PREFLIGHT_UNAVAILABLE");
      return assembly.backend.candidates(assembly.native, after, limit);
    });
  }
  ranks(ticket: SnapshotSourceTicket, ranksJson: string): Promise<TransportReply> {
    return this.bindRanks(ticket, ranksJson, false);
  }
  catalogCandidates(
    ticket: SnapshotSourceTicket,
    options: { readonly after: number | null; readonly limit: number },
  ): Promise<TransportReply> {
    if (
      !options ||
      !(
        options.after === null ||
        (Number.isInteger(options.after) && options.after >= 0 && options.after <= 0xffffffff)
      ) ||
      !Number.isInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > 1024
    )
      return Promise.reject(new EngineTransportError("INVALID_SOURCE_CURSOR"));
    const { after, limit } = options;
    return this.preflight(ticket, async (assembly) => {
      if (!assembly.backend.catalogCandidates)
        throw new EngineTransportError("SOURCE_CATALOG_UNAVAILABLE");
      return assembly.backend.catalogCandidates(assembly.native, after, limit);
    });
  }
  catalogFinalize(ticket: SnapshotSourceTicket, ranksJson: string): Promise<TransportReply> {
    return this.bindRanks(ticket, ranksJson, true);
  }
  profileClock(
    ticket: SnapshotSourceTicket,
    observedEpochMilliseconds: number,
  ): Promise<TransportReply> {
    if (!Number.isSafeInteger(observedEpochMilliseconds))
      return Promise.reject(new EngineTransportError("INVALID_PROFILE_CLOCK_INSTANT"));
    return this.preflight(ticket, async (assembly) => {
      if (!assembly.backend.profileClock)
        throw new EngineTransportError("SOURCE_PROFILE_CLOCK_UNAVAILABLE");
      return assembly.backend.profileClock(assembly.native, observedEpochMilliseconds);
    });
  }
  private bindRanks(
    ticket: SnapshotSourceTicket,
    ranksJson: string,
    catalog: boolean,
  ): Promise<TransportReply> {
    try {
      const assembly = this.open(ticket);
      checkedRawSourceString(ranksJson, TRANSPORT_LIMITS.inputBytes);
      if (assembly.submittedCodeUnits + ranksJson.length > TRANSPORT_LIMITS.inputBytes)
        throw new EngineTransportError("SOURCE_QUEUE_LIMIT");
      assembly.submittedCodeUnits += ranksJson.length;
    } catch (error) {
      return Promise.reject(error);
    }
    return this.preflight(ticket, async (assembly) => {
      if (catalog) {
        if (!assembly.backend.catalogFinalize)
          throw new EngineTransportError("SOURCE_CATALOG_UNAVAILABLE");
        return assembly.backend.catalogFinalize(assembly.native, ranksJson);
      }
      if (!assembly.backend.ranks) throw new EngineTransportError("SOURCE_PREFLIGHT_UNAVAILABLE");
      return assembly.backend.ranks(assembly.native, ranksJson);
    });
  }
  private preflight(
    ticket: SnapshotSourceTicket,
    invoke: (assembly: Assembly) => Promise<string>,
  ): Promise<TransportReply> {
    let assembly: Assembly;
    try {
      assembly = this.open(ticket);
      if (assembly.pending.size >= 128) throw new EngineTransportError("SOURCE_QUEUE_LIMIT");
    } catch (error) {
      return Promise.reject(error);
    }
    const operation = assembly.tail.then(async () => {
      try {
        await this.fence.ready(assembly.generation);
        this.ensureCurrent(assembly);
        if (assembly.failed || this.closed(assembly))
          throw new EngineTransportError("SOURCE_ASSEMBLY_FAILED");
        const reply = parseTransportReply(await invoke(assembly));
        this.ensureCurrent(assembly);
        if (this.closed(assembly) || !reply.ok)
          throw new EngineTransportError("SOURCE_PREFLIGHT_REJECTED");
        return reply;
      } catch (error) {
        assembly.failed = true;
        throw error instanceof EngineTransportError
          ? error
          : new EngineTransportError("SOURCE_PREFLIGHT_FAILED");
      }
    });
    assembly.tail = operation.then(
      () => {},
      () => {},
    );
    assembly.pending.add(operation);
    void operation.then(
      () => assembly.pending.delete(operation),
      () => assembly.pending.delete(operation),
    );
    return operation;
  }

  seal(ticket: SnapshotSourceTicket): Promise<SnapshotSourceReceipt> {
    let assembly: Assembly;
    try {
      assembly = this.open(ticket);
    } catch (error) {
      return Promise.reject(error);
    }
    // Fence later additions synchronously; earlier additions may finish normally.
    assembly.state = "SEALING";
    return (async () => {
      try {
        await Promise.all([...assembly.pending]);
        this.ensureCurrent(assembly);
        if (assembly.failed || assembly.state !== "SEALING")
          throw new EngineTransportError("SOURCE_ASSEMBLY_FAILED");
        const reply = parseTransportReply(await assembly.backend.seal(assembly.native));
        this.ensureCurrent(assembly);
        if (!reply.ok || reply.state !== "REGISTERED" || assembly.state !== "SEALING")
          throw new EngineTransportError("SOURCE_SEAL_REJECTED");
        const receipt = Object.freeze({ reply });
        this.receipts.set(receipt, assembly);
        assembly.state = "CLOSED";
        if (this.active === assembly) this.active = undefined;
        return receipt;
      } catch (error) {
        assembly.state = "CLOSED";
        await this.cleanup(assembly);
        throw error instanceof EngineTransportError
          ? error
          : new EngineTransportError("SOURCE_SEAL_FAILED");
      }
    })();
  }

  async abort(ticket: SnapshotSourceTicket): Promise<void> {
    const assembly = this.tickets.get(ticket);
    if (!assembly) throw new EngineTransportError("INVALID_SOURCE_TICKET");
    if (!this.fence.current(assembly.generation))
      throw new EngineTransportError("STALE_SOURCE_TICKET");
    if (assembly.state === "CLOSED") return;
    assembly.state = "CLOSED";
    if (this.active === assembly) this.active = undefined;
    await this.cleanup(assembly);
  }
  isCurrent(receipt: SnapshotSourceReceipt): boolean {
    const assembly = this.receipts.get(receipt);
    return (
      !!assembly &&
      assembly.sequence === this.sequence &&
      this.fence.current(assembly.generation, assembly.current)
    );
  }
  isCurrentTicket(ticket: SnapshotSourceTicket): boolean {
    const assembly = this.tickets.get(ticket);
    return (
      !!assembly &&
      assembly.state !== "CLOSED" &&
      assembly.sequence === this.sequence &&
      this.fence.current(assembly.generation, assembly.current)
    );
  }
  private open(ticket: SnapshotSourceTicket) {
    const assembly = this.tickets.get(ticket);
    if (!assembly) throw new EngineTransportError("INVALID_SOURCE_TICKET");
    this.ensureCurrent(assembly);
    if (assembly.state !== "OPEN") throw new EngineTransportError("SOURCE_TICKET_CLOSED");
    return assembly;
  }
  private closed(assembly: Assembly): boolean {
    return assembly.state === "CLOSED";
  }
  private ensureCurrent(assembly: {
    sequence: number;
    generation: number;
    current?: () => boolean;
  }) {
    if (
      assembly.sequence !== this.sequence ||
      !this.fence.current(assembly.generation, assembly.current)
    )
      throw new EngineTransportError("STALE_SOURCE_TICKET");
  }
  private async cleanup(assembly: Assembly) {
    if (assembly.aborted || !this.fence.current(assembly.generation)) return;
    assembly.aborted = true;
    // Backends must also validate their private incarnation-bound ticket.
    await assembly.backend.abort(assembly.native).catch(() => {});
  }
}
